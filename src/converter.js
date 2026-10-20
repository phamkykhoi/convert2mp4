'use strict';
// Toàn bộ phần làm việc với FFmpeg: quét file, đọc thông tin, chọn encoder, chuyển đổi.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Khi đóng gói, binary nằm trong app.asar.unpacked (xem "asarUnpack" trong package.json).
const FFMPEG = (process.env.FFMPEG_PATH || require('ffmpeg-static')).replace(
  `app.asar${path.sep}`,
  `app.asar.unpacked${path.sep}`
);

// Mặc định theo chuẩn phổ biến: H.264 + AAC, chất lượng tiêu chuẩn (~CRF 23).
const ENCODERS = {
  h264_nvenc: { pix: 'yuv420p', args: ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', '23', '-b:v', '0'] },
  h264_qsv: { pix: 'nv12', args: ['-c:v', 'h264_qsv', '-preset', 'medium', '-global_quality', '23'] },
  h264_amf: { pix: 'yuv420p', args: ['-c:v', 'h264_amf', '-quality', 'balanced', '-rc', 'cqp', '-qp_i', '21', '-qp_p', '23'] },
  h264_videotoolbox: { pix: 'yuv420p', args: ['-c:v', 'h264_videotoolbox', '-q:v', '60'] },
  libx264: { pix: 'yuv420p', args: ['-c:v', 'libx264', '-preset', 'fast', '-crf', '23'] }
};

const GPU_CANDIDATES = {
  win32: ['h264_nvenc', 'h264_qsv', 'h264_amf'],
  darwin: ['h264_videotoolbox'],
  linux: ['h264_nvenc']
};

const jobs = new Map(); // id -> { proc, killed, suspended }
const reserved = new Set(); // tên file đầu ra đang được dùng bởi job khác
const outputs = new Set(); // file MP4 app đã tạo (chỉ những file này mới được mở từ UI)

// ---------- tiện ích ----------

function parseDuration(text) {
  const m = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

function safeUnlink(p) {
  try { fs.unlinkSync(p); } catch { /* bỏ qua */ }
}

// Giới hạn số tiến trình ffmpeg chạy để đọc thông tin file cùng lúc.
let probing = 0;
const probeWaiting = [];
function withProbeSlot(fn) {
  return new Promise((resolve) => {
    const go = async () => {
      probing++;
      try { resolve(await fn()); } finally {
        probing--;
        const next = probeWaiting.shift();
        if (next) next();
      }
    };
    if (probing < 4) go(); else probeWaiting.push(go);
  });
}

// ---------- quét file ----------

function expandPaths(paths) {
  const result = [];
  const seen = new Set();
  const add = (p, size) => {
    const key = process.platform === 'win32' ? p.toLowerCase() : p;
    if (seen.has(key)) return;
    seen.add(key);
    result.push({ path: p, name: path.basename(p), size });
  };
  const walk = (dir, depth) => {
    if (depth > 5) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (e.isFile() && /\.webm$/i.test(e.name)) {
        try { add(full, fs.statSync(full).size); } catch { /* bỏ qua */ }
      }
    }
  };
  for (const p of paths) {
    if (typeof p !== 'string' || !p) continue;
    let st;
    try { st = fs.statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, 0);
    else if (st.isFile() && /\.webm$/i.test(p)) add(p, st.size);
  }
  return result;
}

function probe(file) {
  return withProbeSlot(() => new Promise((resolve) => {
    const proc = spawn(FFMPEG, ['-hide_banner', '-i', file], { windowsHide: true });
    let text = '';
    proc.stderr.on('data', (d) => {
      text += d;
      if (text.length > 100000) text = text.slice(-100000);
    });
    proc.on('error', () => resolve({ ok: false }));
    proc.on('close', () => {
      const v = /Video:.*?[ ,](\d{2,5})x(\d{2,5})\b/.exec(text);
      resolve({
        ok: Boolean(v),
        duration: parseDuration(text),
        width: v ? Number(v[1]) : null,
        height: v ? Number(v[2]) : null
      });
    });
  }));
}

// ---------- chọn encoder (GPU nếu chạy được, không thì CPU) ----------

function testEncoder(name) {
  return new Promise((resolve) => {
    const enc = ENCODERS[name];
    const args = [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=black:s=320x240:r=30:d=0.5',
      '-vf', `format=${enc.pix}`, ...enc.args, '-frames:v', '5', '-f', 'null', '-'
    ];
    const proc = spawn(FFMPEG, args, { windowsHide: true });
    const timer = setTimeout(() => proc.kill(), 15000);
    proc.on('error', () => { clearTimeout(timer); resolve(false); });
    proc.on('close', (code) => { clearTimeout(timer); resolve(code === 0); });
  });
}

let encoderPromise = null;
function detectEncoder() {
  if (!encoderPromise) {
    encoderPromise = (async () => {
      if (process.env.WEBM2MP4_CPU_ONLY) return 'libx264';
      for (const name of GPU_CANDIDATES[process.platform] || []) {
        if (await testEncoder(name)) return name;
      }
      return 'libx264';
    })();
  }
  return encoderPromise;
}

// ---------- chuyển đổi ----------

// 1080p / 720p tính theo cạnh ngắn (video dọc giữ đúng tỷ lệ), không phóng to video nhỏ.
// Kích thước luôn là số chẵn vì H.264 4:2:0 yêu cầu.
function scaleFilter(resolution) {
  const t = resolution === '720' ? 720 : resolution === 'source' ? 0 : 1080;
  if (!t) return 'scale=trunc(iw/2)*2:trunc(ih/2)*2';
  return `scale='if(gte(iw,ih),-2,trunc(min(${t},iw)/2)*2)':'if(gte(iw,ih),trunc(min(${t},ih)/2)*2,-2)'`;
}

function buildArgs(input, output, encoderName, resolution) {
  const enc = ENCODERS[encoderName];
  return [
    '-hide_banner', '-y',
    '-fflags', '+genpts',
    '-i', input,
    '-map', '0:v:0', '-map', '0:a:0?',
    '-vf', `${scaleFilter(resolution)},format=${enc.pix}`,
    ...enc.args,
    '-c:a', 'aac', '-b:a', '160k',
    '-movflags', '+faststart',
    '-progress', 'pipe:1', '-nostats',
    '-f', 'mp4', output
  ];
}

function uniqueOutput(dir, base) {
  let candidate = path.join(dir, `${base}.mp4`);
  let i = 1;
  while (fs.existsSync(candidate) || reserved.has(candidate)) {
    candidate = path.join(dir, `${base} (${i++}).mp4`);
  }
  reserved.add(candidate);
  return candidate;
}

function friendlyError(stderr) {
  if (/No space left/i.test(stderr)) return 'Ổ đĩa đã đầy';
  if (/No such file/i.test(stderr)) return 'Không tìm thấy file';
  if (/Permission denied|Access is denied/i.test(stderr)) return 'Không có quyền ghi vào thư mục';
  if (/Invalid data|EBML|corrupt|truncat/i.test(stderr)) return 'File bị hỏng, không đọc được';
  return 'Không chuyển được file';
}

function encode(id, input, output, encoderName, opts, onProgress) {
  return new Promise((resolve) => {
    const proc = spawn(FFMPEG, buildArgs(input, output, encoderName, opts.resolution), { windowsHide: true });
    const job = { proc, killed: false, suspended: false };
    jobs.set(id, job);

    let stderr = '';
    let duration = opts.duration || 0;
    let buf = '';
    const fields = {};

    proc.stderr.on('data', (d) => {
      stderr += d;
      if (stderr.length > 50000) stderr = stderr.slice(-50000);
      if (!duration) duration = parseDuration(stderr) || 0;
    });

    // -progress pipe:1 ghi các dòng key=value, mỗi khối kết thúc bằng progress=continue|end.
    proc.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        const eq = line.indexOf('=');
        if (eq < 0) continue;
        const key = line.slice(0, eq);
        fields[key] = line.slice(eq + 1);
        if (key !== 'progress') continue;
        const us = Number(fields.out_time_us || fields.out_time_ms);
        const time = Number.isFinite(us) && us > 0 ? us / 1e6 : 0;
        const pct = duration ? Math.min(99, (time / duration) * 100) : null;
        const speed = fields.speed && fields.speed !== 'N/A' ? fields.speed.trim() : '';
        onProgress({ pct, speed, time });
      }
    });

    let settled = false;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      resolve({ code, stderr, killed: job.killed });
    };
    proc.on('error', (err) => { stderr += String(err); finish(-1); });
    proc.on('close', (code) => finish(code));
  });
}

async function convert(id, input, opts, onProgress) {
  const encoder = await detectEncoder();
  const dir = opts.outputMode === 'custom' && opts.outputDir ? opts.outputDir : path.dirname(input);
  const base = path.basename(input).replace(/\.webm$/i, '');
  let output = null;
  let tmp = null;
  try {
    fs.mkdirSync(dir, { recursive: true });
    output = uniqueOutput(dir, base);
    tmp = `${output}.part`;

    let r = await encode(id, input, tmp, encoder, opts, onProgress);
    // GPU lỗi với file này → tự chạy lại bằng CPU.
    if (r.code !== 0 && !r.killed && encoder !== 'libx264') {
      safeUnlink(tmp);
      r = await encode(id, input, tmp, 'libx264', opts, onProgress);
    }
    if (r.killed) {
      safeUnlink(tmp);
      return { status: 'stopped' };
    }
    if (r.code !== 0) {
      safeUnlink(tmp);
      return { status: 'error', error: friendlyError(r.stderr), log: r.stderr.slice(-4000) };
    }
    fs.renameSync(tmp, output);
    outputs.add(output);
    return { status: 'done', output, size: fs.statSync(output).size };
  } catch (e) {
    if (tmp) safeUnlink(tmp);
    return { status: 'error', error: friendlyError(String(e)), log: String(e) };
  } finally {
    if (output) reserved.delete(output);
    jobs.delete(id);
  }
}

// ---------- điều khiển ----------

function cancel(ids) {
  for (const id of ids) {
    const job = jobs.get(id);
    if (!job) continue;
    job.killed = true;
    if (job.suspended) job.proc.kill('SIGCONT');
    job.proc.kill();
  }
}

// Windows không tạm dừng được tiến trình con một cách an toàn → dừng hẳn và cho file quay lại hàng chờ.
function pause(ids) {
  if (process.platform === 'win32') {
    cancel(ids);
    return 'requeue';
  }
  for (const id of ids) {
    const job = jobs.get(id);
    if (job && !job.suspended) {
      job.proc.kill('SIGSTOP');
      job.suspended = true;
    }
  }
  return 'suspended';
}

function resume(ids) {
  for (const id of ids) {
    const job = jobs.get(id);
    if (job && job.suspended) {
      job.proc.kill('SIGCONT');
      job.suspended = false;
    }
  }
}

function killAll() {
  cancel([...jobs.keys()]);
}

module.exports = {
  FFMPEG,
  expandPaths,
  probe,
  detectEncoder,
  convert,
  cancel,
  pause,
  resume,
  killAll,
  activeCount: () => jobs.size,
  isOutput: (p) => outputs.has(p),
  _internal: { buildArgs, scaleFilter, friendlyError }
};

'use strict';
// Kiểm tra nhanh phần chuyển đổi mà không cần mở giao diện:
//   npm test
// Tạo vài file .webm mẫu (ngang 1440p, dọc, nhỏ 720p), chuyển sang MP4 với mặc định 1080p
// rồi kiểm tra codec và độ phân giải của file kết quả.
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const conv = require('../src/converter');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webm2mp4-'));

function makeWebm(name, w, h, seconds) {
  const out = path.join(dir, name);
  const r = spawnSync(conv.FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `testsrc2=s=${w}x${h}:r=30:d=${seconds}`,
    '-f', 'lavfi', '-i', `sine=f=440:d=${seconds}`,
    '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '1M',
    '-c:a', 'libopus', '-shortest', out
  ]);
  if (r.status !== 0) throw new Error(`Không tạo được ${name}: ${r.stderr}`);
  return out;
}

function inspect(file) {
  const r = spawnSync(conv.FFMPEG, ['-hide_banner', '-i', file], { encoding: 'utf8' });
  const v = /Video: (\w+).*?[ ,](\d{2,5})x(\d{2,5})\b/.exec(r.stderr);
  const a = /Audio: (\w+)/.exec(r.stderr);
  return { vcodec: v && v[1], w: v && Number(v[2]), h: v && Number(v[3]), acodec: a && a[1] };
}

(async () => {
  const cases = [
    { name: 'ngang-1440p.webm', w: 2560, h: 1440, expect: [1920, 1080] },
    { name: 'doc-1080x1920.webm', w: 1080, h: 1920, expect: [1080, 1920] },
    { name: 'doc-1440x2560.webm', w: 1440, h: 2560, expect: [1080, 1920] },
    { name: 'nho-720p.webm', w: 1280, h: 720, expect: [1280, 720] },
    { name: 'le-1366x768.webm', w: 1366, h: 768, expect: [1366, 768] }
  ];
  console.log(`Encoder: ${await conv.detectEncoder()}`);
  let failed = 0;
  for (const c of cases) {
    const input = makeWebm(c.name, c.w, c.h, 2);
    const info = await conv.probe(input);
    let last = null;
    const r = await conv.convert(c.name, input, { resolution: '1080', outputMode: 'same', duration: info.duration }, (p) => { last = p; });
    if (r.status !== 'done') {
      failed++;
      console.log(`✗ ${c.name}: ${r.error}\n${r.log}`);
      continue;
    }
    const o = inspect(r.output);
    const ok = o.vcodec === 'h264' && o.acodec === 'aac' && o.w === c.expect[0] && o.h === c.expect[1];
    if (!ok) failed++;
    console.log(`${ok ? '✓' : '✗'} ${c.name} → ${path.basename(r.output)} ${o.w}x${o.h} ${o.vcodec}/${o.acodec} (tiến độ cuối: ${last ? Math.round(last.pct) : '?'}%)`);
  }

  // Trùng tên → tự đổi thành "ten (1).mp4"
  const again = await conv.convert('dup', path.join(dir, 'nho-720p.webm'), { resolution: '1080', outputMode: 'same' }, () => {});
  const dupOk = again.status === 'done' && path.basename(again.output) === 'nho-720p (1).mp4';
  if (!dupOk) failed++;
  console.log(`${dupOk ? '✓' : '✗'} trùng tên → ${again.output && path.basename(again.output)}`);

  // Windows: lưu thẳng vào gốc ổ đĩa (vd. D:\) — trước đây lỗi EPERM khi mkdir
  if (process.platform === 'win32') {
    const root = path.parse(dir).root;
    const rootRun = await conv.convert('root', path.join(dir, 'nho-720p.webm'), { resolution: '1080', outputMode: 'custom', outputDir: root }, () => {});
    const rootOk = rootRun.status === 'done' && path.dirname(rootRun.output) === path.dirname(path.join(root, 'x'));
    if (!rootOk) failed++;
    console.log(`${rootOk ? '✓' : '✗'} lưu vào gốc ổ đĩa ${root} → ${rootRun.output || rootRun.error + '\n' + rootRun.log}`);
    if (rootRun.output) fs.rmSync(rootRun.output, { force: true });
  }

  // File hỏng → báo lỗi dễ hiểu
  const broken = path.join(dir, 'hong.webm');
  fs.writeFileSync(broken, Buffer.from('day khong phai video'));
  const bad = await conv.convert('bad', broken, { resolution: '1080', outputMode: 'same' }, () => {});
  const badOk = bad.status === 'error' && !fs.readdirSync(dir).some((n) => n.endsWith('.part'));
  if (!badOk) failed++;
  console.log(`${badOk ? '✓' : '✗'} file hỏng → "${bad.error}"`);

  console.log(failed ? `\n${failed} kiểm tra thất bại` : '\nTất cả kiểm tra đều đạt');
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
})();

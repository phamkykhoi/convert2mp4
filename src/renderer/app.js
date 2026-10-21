'use strict';
(() => {
  const api = window.api;
  document.body.classList.add(api.platform);

  const CONCURRENCY = 2;
  const APP_TITLE = 'WebM → MP4';
  const RES_SHORT = { 1080: '1080p', 720: '720p', source: 'Độ phân giải gốc' };
  const RES_MENU = { 1080: 'Chuyển sang 1080p', 720: 'Chuyển sang 720p', source: 'Giữ nguyên độ phân giải' };

  const svg = (size, body, extra = '') =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${body}</svg>`;
  const ICON = {
    file: svg(20, '<path d="M6 3h8l4 4v14H6z"></path><path d="M10 11l4 2.5-4 2.5z"></path>', 'stroke-width="1.6"'),
    check: svg(16, '<path d="M5 12l5 5 9-10"></path>', 'stroke-width="2.2"'),
    checkLg: svg(20, '<path d="M5 12l5 5 9-10"></path>', 'stroke-width="2.4"'),
    err: svg(16, '<circle cx="12" cy="12" r="9"></circle><path d="M12 7v6M12 16.5h.01"></path>', 'stroke-width="2"'),
    errLg: svg(20, '<circle cx="12" cy="12" r="9"></circle><path d="M12 7v6M12 16.5h.01"></path>', 'stroke-width="2"'),
    x: svg(12, '<path d="M5 5l14 14M19 5L5 19"></path>', 'stroke-width="2"'),
    plus: svg(14, '<path d="M12 5v14M5 12h14"></path>', 'stroke-width="2"'),
    upload: svg(36, '<path d="M12 16V4"></path><path d="M7 9l5-5 5 5"></path><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"></path>', 'stroke-width="1.8"'),
    folder: svg(14, '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>', 'stroke-width="1.8"'),
    play: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4l13 8-13 8z"></path></svg>',
    chevron: svg(14, '<path d="M6 9l6 6 6-6"></path>', 'stroke-width="2"'),
    gear: svg(16, '<circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"></path>', 'stroke-width="1.8"')
  };

  // ---------- trạng thái ----------

  const S = {
    files: [], // { id, path, name, size, duration, status: waiting|running|done|error, pct, speed, time, out, outSize, error, log }
    settings: { resolution: '1080', outputMode: 'same', outputDir: '' },
    running: false,
    paused: false,
    pauseMode: null,
    finished: false,
    runRes: null,
    runIds: new Set(),
    startedAt: 0,
    pausedAt: 0,
    pausedTotal: 0,
    menuOpen: false
  };
  let nextId = 1;

  const mainEl = document.getElementById('main');
  const footerEl = document.getElementById('footer');
  const titleEl = document.getElementById('title');
  const overlayEl = document.getElementById('drag-overlay');
  const settingsEl = document.getElementById('settings');

  // ---------- định dạng ----------

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function fmtSize(b) {
    if (b == null) return '—';
    const mb = b / 1048576;
    if (mb >= 1024) return `${(mb / 1024).toFixed(2).replace('.', ',')} GB`;
    if (mb >= 100) return `${Math.round(mb)} MB`;
    return `${mb.toFixed(1).replace('.', ',')} MB`;
  }

  function fmtDur(sec) {
    if (!sec) return '—';
    const s = Math.round(sec);
    const pad = (n) => String(n).padStart(2, '0');
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
  }

  function fmtEta(sec) {
    if (!Number.isFinite(sec) || sec <= 0) return '';
    if (sec < 60) return 'Còn < 1 phút';
    return `Còn ~${Math.round(sec / 60)} phút`;
  }

  const baseName = (p) => p.split(/[\\/]/).filter(Boolean).pop() || p;

  function summary() {
    const s = S.settings;
    const where = s.outputMode === 'custom' && s.outputDir ? baseName(s.outputDir) : 'Cùng thư mục';
    return `MP4 · ${RES_SHORT[s.resolution]} · ${where}`;
  }

  function phase() {
    if (!S.files.length) return 'empty';
    if (S.running) return 'run';
    if (S.finished) return 'done';
    return 'queue';
  }

  const byId = (id) => S.files.find((f) => f.id === id);
  const waitingCount = () => S.files.filter((f) => f.status === 'waiting').length;

  // ---------- thêm / xoá file ----------

  async function pickFiles() {
    if (!settingsEl.hidden || !detailsEl.hidden) return;
    addPaths(await api.pickFiles());
  }

  async function addPaths(paths) {
    if (!paths || !paths.length) return;
    const items = await api.expandPaths(paths);
    if (!items.length) return;
    if (phase() === 'done') {
      S.files = [];
      S.finished = false;
    }
    const key = (p) => (api.platform === 'win32' ? p.toLowerCase() : p);
    const known = new Set(S.files.map((f) => key(f.path)));
    const added = [];
    for (const it of items) {
      const k = key(it.path);
      if (known.has(k)) continue; // file trùng tự bỏ qua
      known.add(k);
      const f = { id: nextId++, path: it.path, name: it.name, size: it.size, duration: null, status: 'waiting', pct: 0 };
      S.files.push(f);
      added.push(f);
    }
    render();
    if (S.running) pump();
    for (const f of added) {
      api.probe(f.path).then((info) => {
        if (info.duration) f.duration = info.duration;
        if (!info.ok && f.status === 'waiting') {
          f.status = 'error';
          f.error = info.error || 'Không đọc được file';
          f.log = info.log;
        }
        render();
      });
    }
  }

  function removeFile(id) {
    S.files = S.files.filter((f) => f.id !== id);
    render();
  }

  function clearAll() {
    S.files = [];
    S.finished = false;
    render();
  }

  // ---------- chuyển đổi ----------

  function start(res) {
    if (S.running || !waitingCount()) return;
    S.menuOpen = false;
    S.running = true;
    S.paused = false;
    S.finished = false;
    S.runRes = res || S.settings.resolution;
    S.runIds = new Set(S.files.filter((f) => f.status === 'waiting').map((f) => f.id));
    S.startedAt = Date.now();
    S.pausedTotal = 0;
    render();
    pump();
  }

  function pump() {
    if (!S.running || S.paused) return;
    let active = S.files.filter((f) => f.status === 'running').length;
    for (const f of S.files) {
      if (active >= CONCURRENCY) break;
      if (f.status !== 'waiting') continue;
      S.runIds.add(f.id);
      active++;
      runOne(f);
    }
    if (!S.files.some((f) => f.status === 'running' || f.status === 'waiting')) finish();
  }

  async function runOne(f) {
    Object.assign(f, { status: 'running', pct: 0, speed: '', time: 0, error: null });
    render();
    let r;
    try {
      r = await api.convert(f.id, f.path, {
        resolution: S.runRes,
        outputMode: S.settings.outputMode,
        outputDir: S.settings.outputDir,
        duration: f.duration || 0
      });
    } catch (e) {
      r = { status: 'error', error: 'Không chuyển được file', log: String(e) };
    }
    if (!S.files.includes(f)) return;
    if (r.status === 'done') Object.assign(f, { status: 'done', out: r.output, outSize: r.size, pct: 100 });
    else if (r.status === 'stopped') Object.assign(f, { status: 'waiting', pct: 0 });
    else Object.assign(f, { status: 'error', error: r.error, log: r.log });
    render();
    pump();
  }

  function finish() {
    S.running = false;
    S.paused = false;
    S.finished = true;
    const ok = S.files.filter((f) => f.status === 'done').length;
    const fail = S.files.filter((f) => f.status === 'error').length;
    api.setProgress(-1, false, APP_TITLE);
    api.notify('Đã chuyển xong', fail ? `${ok} file thành công, ${fail} file lỗi` : `${ok} file MP4 đã sẵn sàng`);
    render();
  }

  async function togglePause() {
    if (!S.running) return;
    const ids = S.files.filter((f) => f.status === 'running').map((f) => f.id);
    if (!S.paused) {
      S.paused = true;
      S.pausedAt = Date.now();
      render();
      S.pauseMode = await api.pause(ids);
    } else {
      S.paused = false;
      S.pausedTotal += Date.now() - S.pausedAt;
      if (S.pauseMode === 'suspended') await api.resume(ids);
      render();
      pump();
    }
  }

  async function cancelAll() {
    const ids = S.files.filter((f) => f.status === 'running').map((f) => f.id);
    S.running = false;
    S.paused = false;
    S.finished = false;
    api.setProgress(-1, false, APP_TITLE);
    render();
    await api.cancel(ids);
  }

  function retry(id) {
    const f = byId(id);
    if (!f || S.running) return;
    Object.assign(f, { status: 'waiting', error: null, pct: 0 });
    S.finished = false;
    start(S.runRes);
  }

  function overall() {
    let total = 0;
    let doneW = 0;
    let finished = 0;
    let count = 0;
    for (const f of S.files) {
      if (!S.runIds.has(f.id)) continue;
      count++;
      const w = Math.max(f.size || 0, 1);
      total += w;
      if (f.status === 'done' || f.status === 'error') {
        doneW += w;
        finished++;
      } else if (f.status === 'running' && f.pct != null) {
        doneW += (w * f.pct) / 100;
      }
    }
    return { p: total ? doneW / total : 0, finished, count };
  }

  // ---------- giao diện ----------

  function statusHtml(f) {
    if (f.status === 'done') return `<span class="status ok">${ICON.check}Xong</span>`;
    if (f.status === 'error') return errLink(f);
    if (f.status === 'running') {
      if (f.pct == null) {
        return `<div class="status-cell"><div class="bar indeterminate"><i></i></div><span class="pct">${f.time ? fmtDur(f.time) : ''}</span></div>`;
      }
      return `<div class="status-cell"><div class="bar"><i data-w="${f.pct.toFixed(1)}"></i></div><span class="pct">${Math.floor(f.pct)}%</span></div>`;
    }
    return `<span class="status wait">${S.paused ? 'Tạm dừng' : 'Đang chờ'}</span>`;
  }

  function errLink(f, short) {
    const text = short ? 'Lỗi' : f.error || 'Lỗi';
    return `<button class="err-link" data-action="details" data-id="${f.id}" title="${esc(f.error || 'Lỗi')} — bấm để xem chi tiết">` +
      `${ICON.err}<span>${esc(text)}</span></button>`;
  }

  function nameHtml(f) {
    return `<div class="name">${ICON.file}<span title="${esc(f.path)}">${esc(f.name)}</span></div>`;
  }

  function rowsHtml(ph) {
    return S.files.map((f) => {
      if (ph === 'queue') {
        let info = `<span class="right num">${fmtDur(f.duration)}</span>`;
        if (f.status === 'done') info = `<span class="status ok right">${ICON.check}Xong</span>`;
        if (f.status === 'error') info = `<span class="right">${errLink(f, true)}</span>`;
        return `<div class="row cols-queue">${nameHtml(f)}${info}<span class="right num">${fmtSize(f.size)}</span>` +
          `<button class="icon-btn" data-action="remove" data-id="${f.id}" aria-label="Xoá khỏi danh sách" title="Xoá khỏi danh sách">${ICON.x}</button></div>`;
      }
      if (ph === 'run') {
        return `<div class="row cols-run">${nameHtml(f)}<span class="right num">${fmtSize(f.size)}</span>${statusHtml(f)}</div>`;
      }
      // done
      if (f.status === 'done') {
        return `<div class="row cols-done">${nameHtml(f)}<span class="right num">${fmtSize(f.outSize)}</span>` +
          `<div class="status-cell"><span class="status ok">${ICON.check}Xong</span>` +
          `<button class="icon-btn" data-action="play" data-id="${f.id}" aria-label="Mở file" title="Mở file">${ICON.play}</button></div></div>`;
      }
      return `<div class="row cols-done err">${nameHtml(f)}<span class="right num">${fmtSize(f.size)}</span>` +
        `<div class="status-cell">${errLink(f)}<div class="row-actions">` +
        `<button class="btn ghost" data-action="details" data-id="${f.id}">Chi tiết</button>` +
        `<button class="btn" data-action="retry" data-id="${f.id}">Thử lại</button></div></div></div>`;
    }).join('');
  }

  const HEADS = {
    queue: '<div class="row head cols-queue"><span>Tên</span><span class="right">Thời lượng</span><span class="right">Dung lượng</span><span></span></div>',
    run: '<div class="row head cols-run"><span>Tên</span><span class="right">Dung lượng</span><span>Trạng thái</span></div>',
    done: '<div class="row head cols-done"><span>Tên</span><span class="right">Dung lượng</span><span>Trạng thái</span></div>'
  };

  // CSP không cho style nội tuyến trong HTML, nên độ rộng thanh tiến độ được gán bằng JS.
  function applyWidths(root) {
    root.querySelectorAll('[data-w]').forEach((el) => { el.style.width = `${el.dataset.w}%`; });
  }

  function renderMain(ph) {
    if (ph === 'empty') {
      mainEl.innerHTML =
        `<section class="drop"><div class="drop-icon">${ICON.upload}</div>` +
        '<h1>Kéo thả file .webm vào đây</h1>' +
        '<button class="btn primary lg" data-action="add" title="Ctrl+O">Chọn file</button></section>';
      return;
    }
    const oldRows = document.getElementById('rows');
    const scroll = oldRows ? oldRows.scrollTop : 0;
    let html = '';
    if (ph === 'queue') {
      html += `<div class="toolbar"><button class="btn" data-action="add" title="Ctrl+O">${ICON.plus}Thêm file</button>` +
        '<button class="btn ghost" data-action="clear">Xoá tất cả</button><span class="spacer"></span>' +
        `<span class="muted">${S.files.length} file</span></div>`;
    }
    if (ph === 'done') {
      const ok = S.files.filter((f) => f.status === 'done').length;
      html += ok
        ? `<section class="banner"><div class="badge ok">${ICON.checkLg}</div><h1>Xong ${ok}/${S.files.length} file</h1>` +
          `<button class="btn primary" data-action="open-folder">${ICON.folder}Mở thư mục</button></section>`
        : `<section class="banner"><div class="badge err">${ICON.errLg}</div><h1>Không chuyển được file nào</h1></section>`;
    }
    html += `<div class="table">${HEADS[ph]}<div class="rows" id="rows">${rowsHtml(ph)}</div></div>`;
    mainEl.innerHTML = html;
    applyWidths(mainEl);
    document.getElementById('rows').scrollTop = scroll;
  }

  const gearBtn = `<button class="icon-btn" data-action="settings" aria-label="Cài đặt" title="Cài đặt">${ICON.gear}</button>`;
  let footerKey = '';

  function renderFooter(ph) {
    const key = [ph, S.paused, S.menuOpen, waitingCount(), summary(), S.settings.resolution].join('|');
    if (key === footerKey) return;
    footerKey = key;

    if (ph === 'empty') {
      footerEl.innerHTML = `<span class="muted">${esc(summary())}</span>${gearBtn}<span class="spacer"></span>` +
        '<button class="btn primary lg" disabled>Chuyển đổi</button>';
    } else if (ph === 'queue') {
      const n = waitingCount();
      const menu = S.menuOpen
        ? `<div class="menu" role="menu">${['1080', '720', 'source']
          .filter((r) => r !== S.settings.resolution)
          .map((r) => `<button role="menuitem" data-action="start-res" data-res="${r}">${RES_MENU[r]} (chỉ lần này)</button>`)
          .join('')}</div>`
        : '';
      footerEl.innerHTML = `<span class="muted">${esc(summary())}</span>${gearBtn}<span class="spacer"></span>` +
        '<div class="split">' +
        `<button class="btn primary lg" data-action="start" title="Ctrl+Enter" ${n ? '' : 'disabled'}>${ICON.play}Chuyển đổi ${n} file</button>` +
        `<button class="btn primary lg split-arrow" data-action="menu" aria-label="Tuỳ chọn khác" aria-haspopup="menu" aria-expanded="${S.menuOpen}" ${n ? '' : 'disabled'}>${ICON.chevron}</button>` +
        `${menu}</div>`;
    } else if (ph === 'run') {
      footerEl.innerHTML =
        '<div class="progress-block"><div class="progress-line"><strong id="p-count"></strong><span class="muted" id="p-eta"></span></div>' +
        '<div class="bar lg"><i id="p-bar"></i></div></div><span class="spacer"></span>' +
        `<button class="btn lg" data-action="pause">${S.paused ? 'Tiếp tục' : 'Tạm dừng'}</button>` +
        '<button class="btn lg danger" data-action="cancel">Huỷ</button>';
    } else {
      footerEl.innerHTML = '<span class="spacer"></span><button class="btn lg" data-action="clear">Xoá danh sách</button>' +
        '<button class="btn primary lg" data-action="add" title="Ctrl+O">Thêm file</button>';
    }
  }

  function renderProgress() {
    if (phase() !== 'run') return;
    const rows = document.getElementById('rows');
    if (rows) {
      rows.innerHTML = rowsHtml('run');
      applyWidths(rows);
    }
    const { p, finished, count } = overall();
    const elapsed = (Date.now() - S.startedAt - S.pausedTotal - (S.paused ? Date.now() - S.pausedAt : 0)) / 1000;
    const eta = p > 0.03 ? (elapsed * (1 - p)) / p : NaN;
    const countEl = document.getElementById('p-count');
    if (countEl) countEl.textContent = `${finished}/${count} file`;
    const etaEl = document.getElementById('p-eta');
    if (etaEl) etaEl.textContent = S.paused ? 'Đã tạm dừng' : fmtEta(eta);
    const barEl = document.getElementById('p-bar');
    if (barEl) barEl.style.width = `${(p * 100).toFixed(1)}%`;
    const title = `${Math.round(p * 100)}% · ${APP_TITLE}`;
    titleEl.textContent = title;
    api.setProgress(p, S.paused, title);
  }

  function render() {
    const ph = phase();
    renderMain(ph);
    renderFooter(ph);
    if (ph === 'run') renderProgress();
    else titleEl.textContent = APP_TITLE;
  }

  let progressQueued = false;
  function scheduleProgress() {
    if (progressQueued) return;
    progressQueued = true;
    requestAnimationFrame(() => {
      progressQueued = false;
      renderProgress();
    });
  }

  // ---------- hộp thoại cài đặt ----------

  let draft = null;
  const sameRadio = settingsEl.querySelector('input[value="same"]');
  const customRadio = settingsEl.querySelector('input[value="custom"]');
  const customLabel = document.getElementById('custom-dir-label');

  function syncSettingsUI() {
    settingsEl.querySelectorAll('[data-res]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.res === draft.resolution)));
    sameRadio.checked = draft.outputMode === 'same';
    customRadio.checked = draft.outputMode === 'custom';
    customLabel.textContent = draft.outputDir || 'Chọn thư mục…';
    customLabel.title = draft.outputDir || '';
  }

  function openSettings() {
    if (S.running) return;
    S.menuOpen = false;
    draft = { ...S.settings };
    syncSettingsUI();
    settingsEl.hidden = false;
    const active = settingsEl.querySelector('[aria-pressed="true"]');
    if (active) active.focus();
  }

  function closeSettings() {
    settingsEl.hidden = true;
    draft = null;
  }

  async function saveSettings() {
    S.settings = await api.saveSettings(draft);
    closeSettings();
    render();
  }

  settingsEl.querySelectorAll('[data-res]').forEach((b) => b.addEventListener('click', () => {
    draft.resolution = b.dataset.res;
    syncSettingsUI();
  }));
  sameRadio.addEventListener('change', () => {
    draft.outputMode = 'same';
    syncSettingsUI();
  });
  customRadio.addEventListener('click', async () => {
    const dir = await api.pickFolder();
    if (dir) {
      draft.outputDir = dir;
      draft.outputMode = 'custom';
    } else if (!draft.outputDir) {
      draft.outputMode = 'same';
    }
    syncSettingsUI();
  });
  settingsEl.addEventListener('mousedown', (e) => {
    if (e.target === settingsEl) closeSettings();
  });

  // ---------- hộp thoại chi tiết lỗi ----------

  const detailsEl = document.getElementById('details');
  const copiedEl = document.getElementById('details-copied');
  let detailsText = '';

  function openDetails(id) {
    const f = byId(id);
    if (!f) return;
    S.menuOpen = false;
    document.getElementById('details-reason').textContent = f.error || 'Lỗi';
    document.getElementById('details-file').textContent = f.path;
    const log = (f.log || 'Không có log chi tiết.').trim();
    document.getElementById('details-log').textContent = log;
    detailsText = `${f.path}\n${f.error || 'Lỗi'}\n\n${log}`;
    copiedEl.hidden = true;
    detailsEl.hidden = false;
    const logEl = document.getElementById('details-log');
    logEl.scrollTop = logEl.scrollHeight; // dòng lỗi thường nằm cuối log
    detailsEl.querySelector('[data-action="details-close"]').focus();
  }

  function closeDetails() {
    detailsEl.hidden = true;
  }

  detailsEl.addEventListener('mousedown', (e) => {
    if (e.target === detailsEl) closeDetails();
  });

  // ---------- sự kiện ----------

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (S.menuOpen && (!el || (el.dataset.action !== 'menu' && el.dataset.action !== 'start-res'))) {
      S.menuOpen = false;
      render();
    }
    if (!el || el.disabled) return;
    const id = Number(el.dataset.id);
    switch (el.dataset.action) {
      case 'add': pickFiles(); break;
      case 'clear': clearAll(); break;
      case 'remove': removeFile(id); break;
      case 'start': start(); break;
      case 'menu': S.menuOpen = !S.menuOpen; render(); break;
      case 'start-res': start(el.dataset.res); break;
      case 'pause': togglePause(); break;
      case 'cancel': cancelAll(); break;
      case 'retry': retry(id); break;
      case 'play': { const f = byId(id); if (f && f.out) api.openFile(f.out); break; }
      case 'open-folder': { const f = S.files.find((x) => x.status === 'done' && x.out); if (f) api.showInFolder(f.out); break; }
      case 'details': openDetails(id); break;
      case 'details-close': closeDetails(); break;
      case 'details-copy': api.copyText(detailsText).then(() => { copiedEl.hidden = false; }); break;
      case 'settings': openSettings(); break;
      case 'settings-cancel': closeSettings(); break;
      case 'settings-save': saveSettings(); break;
      default: break;
    }
  });

  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape') {
      if (!detailsEl.hidden) closeDetails();
      else if (!settingsEl.hidden) closeSettings();
      else if (S.menuOpen) { S.menuOpen = false; render(); }
      return;
    }
    if (!settingsEl.hidden || !detailsEl.hidden) return;
    if (mod && e.key.toLowerCase() === 'o') {
      e.preventDefault();
      pickFiles();
    } else if (mod && e.key === 'Enter') {
      e.preventDefault();
      if (phase() === 'queue') start();
    }
  });

  // Kéo thả file hoặc thư mục vào bất kỳ đâu trong cửa sổ.
  let dragDepth = 0;
  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    overlayEl.hidden = false;
  });
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) overlayEl.hidden = true;
  });
  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    overlayEl.hidden = true;
    const paths = Array.from(e.dataTransfer.files)
      .map((f) => { try { return api.pathForFile(f); } catch { return ''; } })
      .filter(Boolean);
    addPaths(paths);
  });

  api.onProgress((p) => {
    const f = byId(p.id);
    if (!f || f.status !== 'running') return;
    f.pct = p.pct;
    f.speed = p.speed;
    f.time = p.time;
    scheduleProgress();
  });
  api.onOpenFiles((files) => addPaths(files));

  (async () => {
    S.settings = await api.getSettings();
    render();
    addPaths(await api.initialFiles());
  })();
})();

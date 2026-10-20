'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const conv = require('./converter');

const isMac = process.platform === 'darwin';
const RESOLUTIONS = ['1080', '720', 'source'];
const DEFAULT_SETTINGS = { resolution: '1080', outputMode: 'same', outputDir: '' };

let win = null;
let rendererReady = false;
let pendingFiles = [];
let quitting = false;

// File .webm truyền vào qua dòng lệnh (menu chuột phải trong Explorer, hoặc kéo file lên icon app).
function filesFromArgv(argv) {
  return argv.slice(1).filter((a) => /\.webm$/i.test(a) && fs.existsSync(a));
}

function openFiles(files) {
  if (!files.length) return;
  if (win && rendererReady) win.webContents.send('open-files', files);
  else pendingFiles.push(...files);
}

// ---------- cài đặt ----------

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try {
    return sanitizeSettings(JSON.parse(fs.readFileSync(settingsFile(), 'utf8')));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function sanitizeSettings(s) {
  const out = { ...DEFAULT_SETTINGS };
  if (s && RESOLUTIONS.includes(s.resolution)) out.resolution = s.resolution;
  if (s && (s.outputMode === 'same' || s.outputMode === 'custom')) out.outputMode = s.outputMode;
  if (s && typeof s.outputDir === 'string') out.outputDir = s.outputDir;
  if (out.outputMode === 'custom' && !out.outputDir) out.outputMode = 'same';
  return out;
}

// ---------- cửa sổ ----------

function createWindow() {
  win = new BrowserWindow({
    width: 1000,
    height: 680,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: 'WebM → MP4',
    backgroundColor: '#F3F3F3',
    titleBarStyle: 'hidden',
    // Windows/Linux: hệ điều hành tự vẽ nút thu nhỏ / phóng to / đóng trên nền thanh tiêu đề của app.
    titleBarOverlay: isMac ? undefined : { color: '#EBEEF3', symbolColor: '#1B1B1B', height: 40 },
    trafficLightPosition: { x: 14, y: 13 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  });

  win.once('ready-to-show', () => win.show());
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  win.on('close', (e) => {
    if (quitting || conv.activeCount() === 0) return;
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: ['Thoát', 'Ở lại'],
      defaultId: 1,
      cancelId: 1,
      title: 'WebM → MP4',
      message: 'Đang chuyển đổi. Thoát sẽ huỷ các file chưa xong.'
    });
    if (choice === 1) {
      e.preventDefault();
      return;
    }
    quitting = true;
    conv.killAll();
  });

  win.on('closed', () => {
    win = null;
    rendererReady = false;
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

// ---------- IPC ----------

const lastProgressSent = new Map();

function registerIpc() {
  ipcMain.handle('initial-files', () => {
    rendererReady = true;
    const files = pendingFiles;
    pendingFiles = [];
    return files;
  });

  ipcMain.handle('get-settings', () => loadSettings());

  ipcMain.handle('save-settings', (_e, s) => {
    const clean = sanitizeSettings(s);
    try {
      fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
      fs.writeFileSync(settingsFile(), JSON.stringify(clean, null, 2));
    } catch { /* vẫn dùng được trong phiên này */ }
    return clean;
  });

  ipcMain.handle('pick-files', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Chọn file WebM',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Video WebM', extensions: ['webm'] }]
    });
    return r.canceled ? [] : r.filePaths;
  });

  ipcMain.handle('pick-folder', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Chọn thư mục lưu file MP4',
      properties: ['openDirectory', 'createDirectory']
    });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('expand-paths', (_e, paths) => (Array.isArray(paths) ? conv.expandPaths(paths) : []));

  ipcMain.handle('probe', (_e, file) => (typeof file === 'string' ? conv.probe(file) : { ok: false }));

  ipcMain.handle('convert', (e, id, input, opts) => {
    const sender = e.sender;
    if (typeof input !== 'string') return { status: 'error', error: 'Không tìm thấy file' };
    const clean = { ...sanitizeSettings(opts), duration: Number(opts && opts.duration) || 0 };
    return conv.convert(id, input, clean, (p) => {
      const now = Date.now();
      if (now - (lastProgressSent.get(id) || 0) < 250) return;
      lastProgressSent.set(id, now);
      if (!sender.isDestroyed()) sender.send('progress', { id, ...p });
    }).then((r) => {
      lastProgressSent.delete(id);
      return r;
    });
  });

  ipcMain.handle('cancel', (_e, ids) => conv.cancel(ids));
  ipcMain.handle('pause', (_e, ids) => conv.pause(ids));
  ipcMain.handle('resume', (_e, ids) => conv.resume(ids));

  // Chỉ cho mở những file MP4 do app tạo ra.
  ipcMain.handle('open-file', (_e, p) => {
    if (conv.isOutput(p)) shell.openPath(p);
  });
  ipcMain.handle('show-in-folder', (_e, p) => {
    if (conv.isOutput(p)) shell.showItemInFolder(p);
  });

  // Tiến độ trên icon ở thanh Taskbar (Windows) / Dock (macOS) và trên tiêu đề cửa sổ.
  ipcMain.on('set-progress', (_e, fraction, paused, title) => {
    if (!win) return;
    if (typeof fraction === 'number' && fraction >= 0) {
      win.setProgressBar(Math.min(1, fraction), { mode: paused ? 'paused' : 'normal' });
    } else {
      win.setProgressBar(-1);
    }
    if (typeof title === 'string') win.setTitle(title);
  });

  ipcMain.on('notify', (_e, title, body) => {
    if (!win || win.isFocused() || !Notification.isSupported()) return;
    const n = new Notification({ title: String(title), body: String(body) });
    n.on('click', () => {
      if (!win) return;
      if (win.isMinimized()) win.restore();
      win.focus();
    });
    n.show();
  });
}

// ---------- khởi động ----------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  pendingFiles = filesFromArgv(process.argv);

  // Chọn nhiều file rồi chuột phải → Explorer mở nhiều tiến trình; gom hết vào cửa sổ đang mở.
  app.on('second-instance', (_e, argv) => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
    openFiles(filesFromArgv(argv));
  });

  app.on('open-file', (e, file) => {
    e.preventDefault();
    if (/\.webm$/i.test(file)) openFiles([file]);
  });

  if (process.platform === 'win32') app.setAppUserModelId('com.concrete.webm2mp4');

  app.whenReady().then(() => {
    registerIpc();
    createWindow();
    conv.detectEncoder(); // dò GPU sẵn trong lúc người dùng chọn file
  });

  app.on('before-quit', () => {
    quitting = true;
    conv.killAll();
  });

  app.on('window-all-closed', () => app.quit());
}

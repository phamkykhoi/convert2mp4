# WebM → MP4

App desktop (ưu tiên Windows) chuyển một hoặc nhiều file `.webm` sang `.mp4`.
Electron + FFmpeg đóng gói sẵn, người dùng không cần cài thêm gì.

## Chạy thử khi phát triển

Cần Node.js 20 trở lên.

```bash
npm install        # tải Electron và FFmpeg cho máy đang dùng
npm start          # mở app
npm test           # kiểm tra phần chuyển đổi (không mở giao diện)
```

## Đóng gói file cài đặt .exe cho Windows

FFmpeg được tải theo hệ điều hành lúc `npm install`, nên **bản .exe phải build trên Windows**:

- Trên máy Windows: `npm install` rồi `npm run dist:win` → file cài nằm trong `dist/`.
- Hoặc dùng GitHub Actions: tab Actions → **Build Windows installer** → **Run workflow**. Khoảng 5–10 phút sau,
  tải file `.exe` trong mục Artifacts của lần chạy đó. Đẩy tag `v*` (vd. `v1.0.1`) cũng tự build.

Trình cài đặt cũng thêm mục **"Chuyển sang MP4"** vào menu chuột phải của file `.webm` trong File Explorer.

## Hành vi mặc định (người dùng không cần chọn)

| Hạng mục | Mặc định |
| --- | --- |
| Định dạng | MP4 · H.264 + AAC 160 kbps · `faststart` |
| Độ phân giải | 1080p tính theo cạnh ngắn; video nhỏ hơn giữ nguyên, không phóng to; video dọc giữ tỷ lệ |
| Chất lượng | Tiêu chuẩn (tương đương CRF 23) |
| Tăng tốc | Tự dùng GPU NVIDIA / Intel / AMD nếu chạy được, không thì CPU. GPU lỗi với một file → tự chạy lại bằng CPU |
| Song song | 2 file cùng lúc |
| Nơi lưu | Cùng thư mục với file gốc; trùng tên → `ten (1).mp4` |
| Trong lúc chạy | Ghi ra `ten.mp4.part`, xong mới đổi tên, nên không bao giờ để lại file MP4 dở dang |

Người dùng chỉ đổi được 2 thứ trong ⚙ Cài đặt: độ phân giải (1080p / 720p / Giữ nguyên) và nơi lưu.
Nút ▾ cạnh **Chuyển đổi** cho chọn độ phân giải khác chỉ cho lần đó. Cài đặt lưu ở `settings.json`
trong thư mục dữ liệu của app.

Phím tắt: `Ctrl+O` thêm file · `Ctrl+Enter` bắt đầu · `Esc` đóng hộp thoại.

## Cấu trúc

```
src/
  main.js          cửa sổ, hộp thoại chọn file, IPC, tiến độ Taskbar, thông báo, mở 1 phiên duy nhất
  preload.js       cầu nối an toàn giữa giao diện và tiến trình chính
  converter.js     FFmpeg: quét thư mục, đọc thông tin, dò GPU, chuyển đổi, tạm dừng/huỷ
  renderer/        giao diện (HTML/CSS/JS thuần) theo 5 màn hình đã thiết kế
build/installer.nsh   thêm/xoá menu chuột phải "Chuyển sang MP4"
scripts/test-convert.js
```

## Lưu ý

- **Tạm dừng trên Windows**: Windows không tạm dừng được FFmpeg an toàn, nên các file đang chạy sẽ dừng
  và quay lại hàng chờ, khi bấm Tiếp tục sẽ chuyển lại từ đầu. Trên macOS/Linux thì tạm dừng thật.
- **File quay màn hình từ trình duyệt** thường không ghi thời lượng; khi đó thanh tiến độ của file
  chạy dạng "đang xử lý" và hiện thời gian đã chuyển thay cho phần trăm.
- **Bản quyền FFmpeg**: gói `ffmpeg-static` dùng bản FFmpeg có libx264 (giấy phép GPL). Dùng nội bộ thì
  không vấn đề; nếu phát hành thương mại, cần xem lại điều khoản GPL.
- Icon app: `build/icon.ico` (Windows, có sẵn bản nhỏ 16–48 px chỉ dùng mặt mèo cho dễ nhìn) và `build/icon.png` (macOS).

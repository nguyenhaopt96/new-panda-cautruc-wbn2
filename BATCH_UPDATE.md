# Cập nhật dựng hàng loạt và chạy nền

## Chức năng mới

- Dán liên tiếp 1–100 bài; mỗi dòng `Cấu trúc:` mở đầu một bài mới.
- Chấp nhận cả nội dung bị mất toàn bộ xuống dòng. App tự tách bằng các mốc
  `BÀI`, `Cấu trúc:`, `Nghĩa:`/`Giải thích:`, số thứ tự và dấu `→`, sau đó
  chuyển về định dạng chuẩn trước khi dựng; không gọi AI và không tốn API.
- Kiểm tra từng bài phải có đúng 3 cặp Việt–Anh trước khi cho gửi.
- Chọn ngẫu nhiên footage cho từng bài và chỉ tải mỗi clip được chọn một lần.
- Gửi toàn bộ lô vào hàng đợi phía máy chủ; FFmpeg dựng tuần tự để tránh tranh
  CPU/RAM.
- Lưu mã lô trong trình duyệt. Khi tab được mở lại, tải lại trang hoặc app trở
  về foreground, giao diện tự nối lại tiến độ.
- Một bài lỗi không làm dừng các bài sau.
- Tải riêng từng MP4 hoặc tải tất cả video thành một tệp ZIP.
- Trạng thái và output được giữ 6 giờ; trạng thái còn có thể hồi phục nếu tiến
  trình Node khởi động lại mà thư mục tạm của máy vẫn còn.
- Tiêu đề cấu trúc dài tự xuống tối đa 2 dòng và tự giảm cỡ chữ để tránh lỗi
  dừng render như `Add + something + to + something`.

## Điều kiện để chuyển sang app khác

Sau khi bấm dựng, chờ giao diện hiện:

> Đã vào hàng đợi máy chủ

Từ thời điểm đó, trình duyệt không còn phải tự khởi động bài tiếp theo. Server
tự chạy hết lô, kể cả khi hệ điều hành tạm đóng băng tab nền.

Nếu chuyển app khi footage vẫn đang tải lên, trình duyệt/điện thoại vẫn có thể
ngắt request trước khi server nhận đủ dữ liệu.

## Cấu hình PandaStack

File `pandastack.json` bắt buộc PandaStack chạy source bằng Node full-stack:

- Install command: `npm ci`
- Build command: `npm run build`
- Start command: `npm start`

Trong cấu hình PandaStack App, đặt `auto_hibernate: false` và
`max_instances: 1`, sau đó redeploy. Nếu để auto-hibernate mặc định, app có thể
ngủ sau cửa sổ không có traffic; nếu bật nhiều instance, request trạng thái có
thể đi sang máy không giữ lô hiện tại.

## Kiểm tra đã chạy

- `npm ci`
- `npm run lint`
- `npm run build`
- Parser hai bài và parser báo lỗi bài thiếu cặp
- API health, API trạng thái lô, kiểm tra validation upload
- Hàng đợi trả HTTP 202 trước rồi tiếp tục xử lý độc lập
- Khởi động lại tiến trình Node vẫn đọc lại đúng trạng thái lô từ workspace
- ZIP tạo bằng chế độ STORE và vượt qua `unzip -t`

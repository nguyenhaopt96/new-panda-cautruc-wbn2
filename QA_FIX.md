# QA bản sửa

Ngày kiểm tra gần nhất: 2026-09-06

- TypeScript: đạt (npm run lint).
- Production build: đạt (npm run build).
- Cài đặt khóa dependency: đạt (npm ci --dry-run).
- Máy chủ production và /api/health: đạt.
- Font DejaVu Sans Regular/Bold được copy vào dist/fonts khi build.
- Frame mẫu 720×1280: dấu tiếng Việt hiển thị đúng, không có ô vuông.
- Câu Anh dài được đo theo pixel, tự xuống tối đa hai dòng và căn giữa.
- Parser nhận đúng một hoặc nhiều bài bị dính thành một dòng, gồm nhãn `Nghĩa:`
  và cặp Việt–Anh phân cách bằng dấu `→`; không cần AI/API.
- Cấu trúc `Add + something + to + something` render thành công, tự xuống hai
  dòng thay vì báo lỗi giới hạn một dòng ở 32 px.
- Chữ khung cam: 44 px / 29 px, tương ứng tăng 30% từ 34 px / 22 px.
- CTA: 38 px (tăng thêm 30% từ 29 px), in đậm, không viết hoa toàn bộ.
- Giao diện mobile-first từ 320 px; navigation, nội dung và modal không phụ
  thuộc chế độ Desktop site.
- Replit: có sẵn `.replit`, port 3000 → 80, build `npm run build` và run
  `npm start`.
- metadata không yêu cầu Gemini API; không có API key hoặc secret bắt buộc.

Ảnh kiểm tra: qa/frame-preview.jpg.

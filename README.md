# CSKH VIP CMS

Bàn làm việc cho API `CSKH_VIP_AI_API`. Trình duyệt gọi đăng nhập, nhân sự và ca làm. Cookie `cskh_session` do API đặt, JavaScript không đọc cookie. Mã CSRF lấy từ đăng nhập hoặc `GET /api/v1/auth/me`, chỉ giữ trong bộ nhớ và gửi bằng header `X-CSRF-Token` khi tạo hoặc sửa.

Sau khi đăng nhập là khung CMS tối. Cột trái có việc của tôi, hàng chờ, ca làm, nhân sự, hội viên và chiến dịch khi tài khoản có quyền. Ca làm là lưới tháng theo từng nhân viên, ô trống là đang đi làm. Giờ ca vẫn là một ca cho cả team. Bấm Cài đặt thì cột thứ hai mở ra, tiêu đề Cài đặt hệ thống, gồm hậu đài (mã trang và nhân viên chăm sóc), tin nhắn SMS theo đài, IP không bị chặn và bot Telegram. Nhật ký nằm ở nhóm Khác. Đổi mật khẩu mở từ chân menu.

## Chạy

Địa chỉ API nằm ở `VITE_API_PROXY_TARGET` trong `.env`. Dev server chuyển `/api`, `/health` và `/ready` về địa chỉ đó. Trình duyệt vẫn gọi cùng origin với CMS để cookie phiên được gửi.

```bash
cp .env.example .env
npm install
npm run dev
```

`npm run dev` dừng tiến trình đang nghe cổng 5174 rồi khởi động lại dev server. Mở `http://localhost:5174`.

Khi đưa lên máy chủ, phục vụ file tĩnh và proxy ba đường trên về API. Cookie là `SameSite=Lax`, không dùng được nếu CMS và API khác site mà API chưa bật CORS.

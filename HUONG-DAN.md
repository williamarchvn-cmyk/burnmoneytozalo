# Burn Money: dữ liệu dùng chung trên Vercel Blob

Ai có link đều xem, thêm, sửa, xóa trên cùng một bộ dữ liệu, không cần đăng nhập. Dữ liệu nằm trong một file JSON ở **Vercel Blob (loại Private)**. App kết nối tới Blob bằng **OIDC**, nên anh không phải copy token nào.

## Cấu trúc thư mục

```
burn-money/
├── index.html      giao diện (giữ nguyên như bản cũ, thêm phần đồng bộ)
├── sw.js           giúp app mở được khi mất mạng (lưu sẵn giao diện)
├── package.json    khai báo thư viện @vercel/blob
├── package-lock.json
├── .gitignore
└── api/
    ├── sync.js     đọc/ghi dữ liệu dùng chung  → /api/sync
    ├── status.js   link kiểm tra dữ liệu        → /api/status
    └── _store.js   phần dùng chung của 2 file trên (dấu "_" nên không thành link)
```

---

## Bước 1: Đưa file lên GitHub

1. Giải nén file zip trên máy tính.
2. Vào github.com, bấm **New repository**, đặt tên (ví dụ `burn-money`), chọn **Private** rồi **Create repository**.
3. Bấm **uploading an existing file**. Kéo **toàn bộ nội dung bên trong** thư mục `burn-money` vào (gồm `index.html`, `sw.js`, `package.json`, `package-lock.json`, `.gitignore` và cả thư mục `api`). Đừng kéo nguyên thư mục cha, và đừng tải file zip lên.
4. Bấm **Commit changes**. Kiểm tra trên GitHub thấy `api/sync.js` nằm đúng trong thư mục `api`.

> File `.gitignore` bắt đầu bằng dấu chấm nên có thể bị ẩn trên máy. Thiếu file này cũng không sao.

**Đang có bản Burn Money cũ trên một repo khác?** Xem trước mục **"Chuyển dữ liệu cũ"** bên dưới.

## Bước 2: Tạo project trên Vercel

1. Vào vercel.com → **Add New… → Project** → chọn repo `burn-money` → **Import**.
2. Mục **Framework Preset** chọn **Other**. Để trống Build Command và Output Directory.
3. Bấm **Deploy**. Lúc này app đã mở được, nhưng chưa có kho dữ liệu nên chấm trên nút ⚙ sẽ đỏ. Đây là bình thường.

## Bước 3: Tạo Blob store loại Private và kết nối với project

1. Trong project vừa tạo, mở tab **Storage** → **Create Database / Create Storage** → chọn **Blob** → **Continue**.
2. Đặt tên store (ví dụ `burn-money-data`) và **bắt buộc chọn Access: Private**.
3. Ở bước kết nối, tick đủ **Production, Preview, Development** rồi bấm **Connect**.
   - Project mới mặc định kết nối bằng OIDC. Vercel tự thêm biến `BLOB_STORE_ID`, anh không cần copy token.
   - Nếu dùng store tạo từ trước: vào **Storage → store → tab Projects**, bấm dấu ⋯ cạnh project, chọn **Upgrade to OIDC**.
4. **Quan trọng: Redeploy.** Biến môi trường chỉ có hiệu lực ở lần deploy mới. Vào tab **Deployments**, bấm ⋯ ở bản trên cùng, chọn **Redeploy**.

## Bước 4: Kiểm tra sau khi deploy

1. Mở `https://<tên-app>.vercel.app/api/status`
   - Thấy `"trang_thai": "Kết nối Blob OK..."` là kết nối được.
   - Dòng `"xac_thuc_blob"` nên ghi **OIDC**.
2. Mở **một lần** `https://<tên-app>.vercel.app/api/status?test=write`
   - Phần `thu_ghi` phải có 3 lần ghi `ok: true`, và `ghi_voi_etag_cu_bi_tu_choi: true` (chống ghi đè đang hoạt động).
   - Lần thử này tốn 4 lượt ghi, nên đừng mở thường xuyên.
3. Mở app trên điện thoại, nhập thử 1 khoản rồi đợi khoảng 5 giây: **chấm trên nút ⚙ chuyển xanh**.
4. Mở cùng link trên máy thứ hai. Khoản vừa nhập phải xuất hiện.
5. Mở lại `/api/status`, phần `khoan_chi_gan_nhat` sẽ có khoản đó.

**Link xem dữ liệu trên máy chủ:**

| Link | Nội dung |
|---|---|
| `/api/status` | Tóm tắt: kết nối, phiên bản, số lượng, ngân sách, 10 khoản gần nhất |
| `/api/status?full=1` | Toàn bộ file dữ liệu |
| `/api/status?test=write` | Thử ghi 3 lần liên tiếp (tốn 4 lượt ghi) |

Trong app: **⚙ → Dữ liệu dùng chung → Xem trên máy chủ**.

---

## Chuyển dữ liệu cũ (quan trọng)

Dữ liệu của bản cũ nằm trong trình duyệt và **gắn với địa chỉ web** anh đã dùng. Lần đầu bản mới được mở **ở đúng địa chỉ đó**, nó tự đưa toàn bộ dữ liệu cũ lên máy chủ. Burn Money không có dữ liệu mẫu, nên không có gì phải bỏ qua.

- **Bản cũ đang chạy trên Vercel (ví dụ `burn-money.vercel.app`)**: cập nhật **đúng repo/project cũ** đó. Thay file bằng bộ file mới, rồi làm Bước 3 cho project đó. Mở app trên điện thoại cũ là dữ liệu tự lên máy chủ.
- **Bản mới ở địa chỉ khác** (project mới, hoặc trước đây anh mở file trực tiếp): bản mới **không đọc được** dữ liệu cũ. Làm như sau:
  1. Mở bản cũ → ⚙ → **Xuất file**.
  2. Mở bản mới → ⚙ → **Nhập file** → chọn file vừa xuất.

---

## Hạn mức miễn phí (Vercel Hobby)

| Hạn mức / tháng | Thao tác của app tốn hạn mức này | Ước tính 2 người dùng |
|---|---|---|
| **2.000** Advanced ops (ghi) | mỗi lần gửi thay đổi = 1 lần ghi | ~600–700 |
| **10.000** Simple ops (đọc) | mỗi lần gửi = 2; mỗi lần mở app = 1; khi đang mở xem: ~1/phút | ~2.500–3.500 |

**Cách app tiết kiệm hạn mức:**

- **Gom thay đổi:** app đợi 4 giây không thao tác (tối đa 20 giây) rồi mới gửi một lần. Bấm "Hoàn tác" ngay sau khi ghi thì không tốn lượt ghi nào.
- **Bỏ qua lượt ghi thừa:** thay đổi không làm dữ liệu khác đi thì máy chủ không ghi.
- **Tạm ngừng kiểm tra:** sau 5 phút không ai chạm màn hình, app ngừng kiểm tra cập nhật. Nhờ vậy, để app mở cả ngày cũng không đốt hạn mức.

> ⚠️ Gói Hobby **không tính tiền khi vượt hạn mức**, nhưng Blob sẽ **bị khóa đến hết 30 ngày**. Hãy theo dõi ở Vercel → **Usage** (hoặc **Observability → Blob**). Mỗi lần bấm xem Blob store trong dashboard cũng bị tính là thao tác.

## Cách đồng bộ hoạt động

- **Lưu ngay trên máy:** mọi thao tác được lưu trên máy trước, nên mất mạng vẫn dùng bình thường. Có mạng lại thì app tự gửi lên.
- **Khi nào thấy thay đổi của người khác:** ngay khi mở app hoặc quay lại app, và trong lúc đang mở thì sau tối đa khoảng 1–2 phút.
- **Hai người sửa cùng lúc:** mỗi trường (số tiền, nội dung…) có mốc thời gian riêng. Anh sửa số tiền, người kia sửa nội dung của cùng một khoản thì giữ cả hai. Cùng sửa một trường thì bản sửa sau cùng được giữ.
- **Chống ghi đè:** máy chủ chỉ ghi khi file chưa bị ai đổi (so ETag lấy từ `head()`). Nếu bị ghi xen vào giữa chừng, máy chủ đọc lại, gộp, rồi ghi lại.
- **Chấm trên nút ⚙:**
  - xanh: đã đồng bộ
  - cam nhấp nháy: đang chờ gửi
  - xám: mất mạng
  - đỏ: lỗi (xem chi tiết ở ⚙ → Dữ liệu dùng chung)

**Lưu ý:**

- Không có đăng nhập, nên **ai có link đều sửa/xóa được**. Chỉ gửi link cho người tin cậy.
- **"Xóa toàn bộ dữ liệu"** và **"Nhập file"** tác động lên dữ liệu chung của mọi người. Nên **Xuất file** sao lưu trước.
- App không có tải ảnh hay kéo để sắp xếp, nên phần lưu ảnh không áp dụng.

---

## Lỗi thường gặp

| Hiện tượng | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| `/api/status` báo **404** | Thư mục `api` không lên GitHub, hoặc nằm sai chỗ | Trên GitHub phải thấy `api/sync.js` ngay ở gốc repo. Framework Preset phải là **Other**. |
| `No blob credentials found` | Chưa kết nối store, hoặc **chưa Redeploy** | Làm lại Bước 3, nhớ **Redeploy**. |
| `OIDC is enabled for this project, but not for the … environment` | Store chưa bật cho môi trường đó | Storage → store → Projects → bật đủ Production/Preview/Development → Redeploy. |
| `Cannot use public access on a private store` hoặc báo sai loại store | Store đang là **Public** | Tạo store mới loại **Private**, ngắt store cũ khỏi project, kết nối store mới, Redeploy. |
| `Blob store đang bị tạm khóa` (BlobStoreSuspended) | Vượt hạn mức Hobby trong tháng | Đợi hết chu kỳ 30 ngày, hoặc nâng gói. App vẫn chạy và lưu trên máy, khi Blob mở lại sẽ tự gửi. |
| Function lỗi `Cannot use import statement outside a module` | Thiếu `package.json` hoặc thiếu `"type": "module"` | Tải lại đúng `package.json` trong bộ file. |
| Chấm **đỏ**, ghi "Máy chủ trả lỗi 500" | Lỗi phía Blob | Mở `/api/status` để xem `goi_y`. Xem log ở Vercel → Deployment → **Functions / Logs**. |
| Chấm **cam** mãi không xanh | Mạng chập chờn, hoặc máy chủ lỗi | ⚙ → **Đồng bộ ngay**. Nếu vẫn vậy, mở `/api/status`. |
| Máy kia chưa thấy thay đổi | Bộ nhớ đệm đọc của Vercel giữ bản cũ tối đa ~60 giây | Đợi 1–2 phút, hoặc đóng mở lại app (mở app luôn đọc bản mới nhất). |
| Bản mới không có dữ liệu cũ | Bản mới chạy ở địa chỉ khác bản cũ | Xem mục **Chuyển dữ liệu cũ**: Xuất file ở bản cũ → Nhập file ở bản mới. |
| Mất mạng không mở được app | Chưa mở app lần nào khi có mạng (sw.js chưa kịp lưu) | Mở app 1 lần khi có mạng; từ lần sau mất mạng vẫn mở được. |
| Sửa code xong deploy nhưng điện thoại vẫn hiện bản cũ | Điện thoại đang mở bản đã lưu sẵn | Đóng hẳn app rồi mở lại khi có mạng (app luôn ưu tiên lấy bản mới khi có mạng). |

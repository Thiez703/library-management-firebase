# 📚 LibSpace — Hệ Thống Quản Lý Thư Viện Sách

![HTML](https://img.shields.io/badge/HTML5-E34F26?style=flat&logo=html5&logoColor=white)
![TailwindCSS](https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=flat&logo=tailwind-css&logoColor=white)
![Firebase](https://img.shields.io/badge/Firebase-FFCA28?style=flat&logo=firebase&logoColor=black)
![Firestore](https://img.shields.io/badge/Firestore-039BE5?style=flat&logo=firebase&logoColor=white)
![Cloud Functions](https://img.shields.io/badge/Cloud_Functions-4285F4?style=flat&logo=google-cloud&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-ES_Modules-F7DF1E?style=flat&logo=javascript&logoColor=black)
![License](https://img.shields.io/badge/License-MIT-green?style=flat)

> **LibSpace** là ứng dụng web quản lý thư viện toàn diện, được xây dựng hoàn toàn trên nền tảng Firebase (Firestore, Authentication, Storage, Cloud Functions) kết hợp Vanilla JavaScript (ES Modules) và Tailwind CSS. Hệ thống hỗ trợ đầy đủ vòng đời mượn/trả sách, xác minh danh tính 3 lớp, hệ thống điểm uy tín động, quản lý phạt & tài chính, và tự động hóa qua Cloud Functions.

---

## 📋 Mục lục

1. [Tổng quan hệ thống](#1-tổng-quan-hệ-thống)
2. [Công nghệ sử dụng](#2-công-nghệ-sử-dụng)
3. [Kiến trúc & Cấu trúc thư mục](#3-kiến-trúc--cấu-trúc-thư-mục)
4. [Các chức năng đã hoàn thành](#4-các-chức-năng-đã-hoàn-thành)
5. [Cấu trúc dữ liệu Firestore](#5-cấu-trúc-dữ-liệu-firestore)
6. [Bảo mật hệ thống](#6-bảo-mật-hệ-thống)
7. [Cloud Functions & Tự động hóa](#7-cloud-functions--tự-động-hóa)
8. [Hướng dẫn cài đặt & chạy](#8-hướng-dẫn-cài-đặt--chạy)
9. [Cấu hình Email](#9-cấu-hình-email)
10. [Quy ước phát triển](#10-quy-ước-phát-triển)
11. [Lộ trình thực hiện](#11-lộ-trình-thực-hiện)

---

## 1. Tổng quan hệ thống

### Mục tiêu
Xây dựng hệ thống quản lý thư viện số cho phép:
- **Độc giả** tìm kiếm, đặt mượn sách trực tuyến và theo dõi trạng thái phiếu mượn
- **Thủ thư (Librarian)** quản lý phiếu mượn, duyệt/trả/gia hạn, quản lý phạt
- **Quản trị viên (Admin)** toàn quyền quản lý hệ thống, cấu hình chính sách và xem báo cáo tài chính

### Phạm vi chức năng

| Nhóm | Chức năng |
|------|-----------|
| Xác thực & phân quyền | Đăng ký, đăng nhập Email/Google, phân quyền 3 cấp |
| Xác minh danh tính | Xác minh CCCD + SĐT, điểm uy tín động, kiểm tra điều kiện mượn |
| Quản lý sách | CRUD sách, upload ảnh, quản lý danh mục, tìm kiếm, lọc |
| Mượn & trả sách | Giỏ mượn, đặt phiếu, duyệt, trả, gia hạn, hủy — toàn bộ dùng Transaction |
| Quản lý phạt | Tính phạt tự động, thu tiền, miễn phạt, biểu phí động |
| Quản lý độc giả | Danh sách, tìm kiếm, lọc, khóa/mở khóa, nâng cấp quyền, xuất Excel |
| Tài chính | Dashboard tài chính, biểu đồ theo tháng, định giá sách, lịch sử giao dịch, xuất CSV |
| Cài đặt hệ thống | 6 nhóm cài đặt động lưu Firestore, cache 5 phút |
| Tự động hóa | Cloud Functions: hủy phiếu hết hạn, cảnh báo/nhắc hạn trả qua email |
| Thông báo email | EmailJS (xác nhận mã phiếu, phê duyệt) + Trigger Email Extension (Cloud) |

---

## 2. Công nghệ sử dụng

| Lớp | Công nghệ | Phiên bản / Ghi chú |
|-----|-----------|----------------------|
| **Giao diện** | HTML5, Tailwind CSS | CDN — utility-first |
| **Biểu tượng** | Phosphor Icons | `ph ph-...` class |
| **JavaScript** | Vanilla JS — ES Modules | Không bundler, CDN trực tiếp |
| **Cơ sở dữ liệu** | Firebase Firestore (NoSQL) | Web SDK `10.0.0` modular |
| **Xác thực** | Firebase Authentication | Email/Password + Google OAuth2 |
| **Lưu trữ** | Firebase Storage | Ảnh bìa sách tại `/covers/` |
| **Automation** | Firebase Cloud Functions | Node.js 18, `firebase-functions ^4.3.1` |
| **Hosting** | Firebase Hosting | |
| **Email (client)** | EmailJS | Gửi ngay sau hành động người dùng |
| **Email (server)** | Firebase Trigger Email Extension | Hàng đợi qua collection `mail` |
| **Xuất dữ liệu** | SheetJS (XLSX) | Xuất danh sách độc giả ra Excel |

---

## 3. Kiến trúc & Cấu trúc thư mục

### Kiến trúc tổng quan

```
┌─────────────────────────────────────────────────────────────┐
│                      CLIENT (Browser)                       │
│  ┌──────────────┐  ┌──────────────────────────────────────┐ │
│  │  user/*.html │  │         admin/*.html                 │ │
│  │  (Độc giả)   │  │  (Admin / Thủ thư)                   │ │
│  └──────┬───────┘  └──────────────────┬──────────────────┘ │
│         │                             │                     │
│         └─────────────┬───────────────┘                     │
│                       │  ES Modules (assets/js/)            │
│       ┌───────────────▼────────────────────────────┐       │
│       │  firebase-config.js  →  db / auth / storage │       │
│       └───────────────┬────────────────────────────┘       │
└───────────────────────┼─────────────────────────────────────┘
                        │  Firebase Web SDK v10 (CDN)
          ┌─────────────▼────────────────────┐
          │         FIREBASE BACKEND          │
          │  ┌──────────┐  ┌───────────────┐ │
          │  │Firestore │  │Authentication │ │
          │  ├──────────┤  ├───────────────┤ │
          │  │ Storage  │  │Cloud Functions│ │
          │  └──────────┘  └───────────────┘ │
          └───────────────────────────────────┘
```

**Kiểu render:** Client-Side Rendering (CSR) hoàn toàn — không có server-side render, không có build step.

### Cấu trúc thư mục chi tiết

```
library-management-firebase/
│
├── index.html                      # Redirect → user/index.html
├── 404.html                        # Trang lỗi 404
│
├── admin/                          # Giao diện quản trị (Staff/Admin only)
│   ├── index.html                  # Dashboard: thống kê real-time + hoạt động gần đây
│   ├── books.html                  # Quản lý sách + danh mục (layout 2 cột)
│   ├── loans.html                  # Quản lý phiếu mượn (4 tab: chờ/đang/quá hạn/đã trả)
│   ├── readers.html                # Quản lý độc giả (lọc nâng cao + chi tiết uy tín)
│   ├── fines.html                  # Quản lý phiếu phạt (thu tiền / miễn phạt)
│   ├── finance.html                # Tài chính: dashboard, biểu phí, định giá sách, giao dịch
│   ├── reports.html                # Báo cáo tổng hợp
│   ├── settings.html               # Cài đặt hệ thống (6 nhóm, lưu Firestore)
│   ├── admin.html                  # Quản lý tài khoản Admin/Staff
│   └── seed.html                   # Công cụ tạo dữ liệu mẫu (chỉ dùng lúc dev)
│
├── user/                           # Giao diện người dùng (Độc giả)
│   ├── index.html                  # Trang chủ — sách nổi bật, banner
│   ├── catalog.html                # Danh mục sách (tìm kiếm, lọc, phân trang)
│   ├── book-detail.html            # Chi tiết sách + nút thêm vào giỏ
│   ├── cart.html                   # Giỏ mượn + form đặt phiếu
│   ├── borrow-history.html         # Lịch sử & trạng thái phiếu mượn cá nhân
│   ├── favorites.html              # Sách yêu thích
│   ├── notifications.html          # Thông báo cá nhân (real-time)
│   ├── profile.html                # Hồ sơ + xác minh danh tính (CCCD/SĐT)
│   ├── login.html                  # Đăng nhập (Email / Google)
│   ├── register.html               # Đăng ký tài khoản mới
│   ├── about.html                  # Giới thiệu thư viện
│   └── rules.html                  # Nội quy thư viện
│
├── assets/
│   ├── images/                     # Ảnh tĩnh (placeholder, logo, v.v.)
│   └── js/                         # Toàn bộ logic nghiệp vụ (ES Modules)
│       │
│       │  ── CORE / SHARED ──
│       ├── firebase-config.js      # Khởi tạo app, export: db, auth, storage
│       ├── auth.js                 # Login/logout, Google Auth, navbar, cache user
│       ├── notify.js               # Toast notification & confirm dialog (UI helper)
│       ├── admin-guard.js          # Route guard: chỉ Staff/Admin mới được vào admin/
│       ├── admin-shell.js          # Sidebar & layout chung admin pages
│       │
│       │  ── IDENTITY & REPUTATION ──
│       ├── identity.js             # Xác minh CCCD/SĐT (SHA-256), điểm uy tín, borrow eligibility
│       │
│       │  ── USER FEATURES ──
│       ├── public-books.js         # Catalog sách công khai (search, filter, phân trang)
│       ├── books.js                # CRUD sách + upload ảnh Storage + quản lý danh mục
│       ├── cart.js                 # Quản lý giỏ mượn (localStorage)
│       ├── cart-page.js            # UI giỏ mượn + checkout form
│       ├── borrow.js               # Luồng mượn/trả/gia hạn/hủy (Firestore Transaction)
│       ├── borrow-history.js       # Lịch sử phiếu mượn của độc giả
│       ├── favorites.js            # Logic yêu thích (localStorage)
│       ├── favorites-page.js       # UI trang yêu thích
│       ├── profile.js              # Hồ sơ cá nhân + form xác minh + đổi SĐT
│       ├── notifications.js        # Thông báo real-time cho độc giả
│       │
│       │  ── ADMIN FEATURES ──
│       ├── admin.js                # Dashboard: thống kê, hoạt động gần đây, top sách
│       ├── admin-loans.js          # Quản lý phiếu mượn (duyệt/trả/gia hạn/tạo trực tiếp)
│       ├── admin-fines.js          # Quản lý phiếu phạt (thu tiền, miễn phạt)
│       ├── admin-finance.js        # Tài chính: dashboard, biểu phí, định giá, giao dịch, xuất CSV
│       ├── admin-settings.js       # Cài đặt hệ thống (6 nhóm, cache 5 phút, export settings)
│       ├── readers.js              # Quản lý độc giả (metrics, filters, lock, promote, export Excel)
│       ├── reports.js              # Báo cáo & thống kê tổng hợp
│       ├── slips.js                # In phiếu mượn
│       │
│       │  ── EMAIL & NOTIFICATIONS ──
│       ├── email-service.js        # Gửi email qua Firebase Trigger Email Extension
│       ├── emailjs-service.js      # Gửi email qua EmailJS (client-side)
│       │
│       │  ── DEV TOOLS ──
│       └── seeder.js               # Script tạo dữ liệu mẫu (chỉ dùng lúc dev)
│
├── functions/                      # Cloud Functions (Node.js 18)
│   ├── index.js                    # autoCleanup: hủy phiếu hết hạn, cảnh báo quá hạn
│   └── package.json                # firebase-admin ^11.8.0, firebase-functions ^4.3.1
│
├── firebase.json                   # Cấu hình: Hosting, Firestore rules/indexes, Storage, Functions
├── firestore.rules                 # Security Rules cho tất cả collections
├── firestore.indexes.json          # Composite index: books(categoryId ASC, createdAt DESC)
├── storage.rules                   # Storage: chỉ Admin ghi, authenticated users đọc
├── package.json                    # { "dependencies": { "firebase": "^12.11.0" } }
├── GEMINI.md / CLAUDE.md           # Context file cho AI assistants
└── .gitignore
```

---

## 4. Các chức năng đã hoàn thành

### 4.1 Xác thực & Phân quyền

**✅ Đăng ký tài khoản**
- Form đăng ký với email, mật khẩu và họ tên
- Tạo document `users/{uid}` trong Firestore với role mặc định là `user`
- Khởi tạo các trường: `reputationScore: 100`, `isVerified: false`, `status: active`

**✅ Đăng nhập Email & Password**
- Xử lý lỗi chi tiết theo error code Firebase: sai thông tin, tài khoản vô hiệu, quá nhiều lần sai
- Kiểm tra trạng thái tài khoản (`banned`/`permanent_ban`) — tự động đăng xuất nếu bị khóa vĩnh viễn

**✅ Đăng nhập Google (OAuth2)**
- Thử popup trước, tự động fallback sang redirect nếu popup bị chặn
- Tự động tạo document `users/{uid}` nếu lần đầu đăng nhập Google

**✅ Cache người dùng**
- Thông tin user được cache vào `localStorage` (key: `lib_user`) ngay sau đăng nhập
- Giảm thiểu Firestore read khi chuyển trang
- Cache bao gồm: `uid`, `email`, `displayName`, `photoURL`, `role`, `isVerified`, `reputationScore`

**✅ Phân quyền 3 cấp**

| Role | Quyền truy cập |
|------|----------------|
| `admin` | Toàn quyền: quản lý sách, phiếu mượn, phạt, tài chính, cài đặt, quản lý user |
| `librarian` | Quản lý phiếu mượn, phạt, xem danh sách độc giả — không truy cập được trang user |
| `user` | Duyệt sách, đặt phiếu mượn, xem lịch sử cá nhân |

- `admin-guard.js` bảo vệ toàn bộ trang admin: redirect về `login.html` nếu chưa đăng nhập, redirect về `user/index.html` nếu không phải Staff
- Thủ thư bị chặn truy cập trang user — tự động redirect về `admin/index.html`

---

### 4.2 Xác minh danh tính 3 lớp (`identity.js`)

**✅ Lớp 1 — UID là neo**
- Điểm uy tín và quyền mượn gắn vĩnh viễn với Firebase Auth UID
- Không thể chuyển danh tính giữa các tài khoản

**✅ Lớp 2 — Unique index**
- Mỗi số điện thoại (10 số, bắt đầu bằng 0) chỉ được đăng ký cho **1 tài khoản duy nhất**
- Mỗi CCCD (12 số) chỉ được đăng ký cho **1 tài khoản duy nhất**
- Thực hiện qua Firestore collections `phones/{phone}` và `cccds/{cccdHash}` làm inverted index
- Toàn bộ xác minh chạy trong **Firestore Transaction** — loại bỏ race condition khi 2 người đăng ký cùng lúc

**✅ Lớp 3 — Khóa cứng**
- Các field `phone`, `cccdHash`, `isVerified` chỉ được ghi bởi Staff thông qua Firestore Security Rules
- User không thể tự sửa role hoặc điểm uy tín

**✅ Hash CCCD không lưu plain text**
- Sử dụng Web Crypto API (không cần thư viện ngoài): `crypto.subtle.digest('SHA-256', ...)`
- Thêm salt cố định: `libspace_cccd_salt_v1::${cccd}` để ngăn rainbow table attack
- Chỉ lưu chuỗi hex 64 ký tự trong Firestore

**✅ Đổi số điện thoại có kiểm soát**
- Yêu cầu nhập lại CCCD để xác nhận danh tính trước khi đổi
- Cooldown 60 ngày (cấu hình được) — tránh lạm dụng việc thay SĐT

---

### 4.3 Hệ thống điểm uy tín (Reputation System)

**✅ Bảng hạng uy tín**

| Điểm | Hạng | Số sách tối đa được mượn |
|------|------|--------------------------|
| ≥ 80 | Tốt | 5 cuốn |
| 70–79 | Khá | 4 cuốn |
| 60–69 | Trung bình | 3 cuốn |
| 50–59 | Dưới trung bình | 2 cuốn |
| 40–49 | Thấp | 1 cuốn |
| < 40 | Kém | Bị khóa quyền mượn |

**✅ Biến động điểm khi trả sách (cập nhật trong cùng Transaction)**

| Hành vi | Điểm thay đổi |
|---------|---------------|
| Trả đúng hạn | +2 |
| Trả muộn 1–3 ngày | −5 |
| Trả muộn 4–7 ngày | −20 |
| Trả muộn > 7 ngày | −100 + khóa tài khoản |
| Sách bẩn/hư nhẹ (ghi chú "bẩn") | −20 thêm |
| Mất sách (ghi chú "mất sách") | −40 thêm |
| Không vi phạm trong 6 tháng | +20 bonus khi trả sách tiếp theo |

**✅ Live Score**
- Điểm uy tín được tính lại real-time khi kiểm tra điều kiện mượn (`getLiveReputationScore`)
- Tránh stale data từ Firestore field — tính dựa trên: sách quá hạn đang mượn + phạt chưa thanh toán

**✅ Đồng bộ ngược**
- Trang quản lý độc giả đồng bộ `reputationScore` về Firestore nếu phát hiện sai lệch (chống vòng lặp vô hạn bằng `syncedScores` Map)

---

### 4.4 Quản lý Sách & Danh mục (`books.js`)

**✅ CRUD sách đầy đủ**
- Thêm sách: tên, tác giả, danh mục, tổng số lượng, ảnh bìa, giá sách (dùng tính phạt mất sách)
- Sửa sách: cập nhật thông tin, thay ảnh bìa
- Xóa sách: kiểm tra ràng buộc (không xóa nếu đang có phiếu mượn)
- Hai trường số lượng tách biệt: `quantity` (tổng) và `availableQuantity` (còn khả dụng)

**✅ Upload ảnh bìa lên Firebase Storage**
- Path: `/covers/{filename}`
- Preview ảnh trước khi upload
- Thay thế ảnh cũ khi cập nhật

**✅ Quản lý danh mục**
- CRUD danh mục trong cùng trang với sách (layout 2 cột)
- Danh mục được denormalize vào field `categoryName` trong mỗi document sách (tránh JOIN trong NoSQL)

**✅ Tìm kiếm & lọc**
- Tìm theo tên sách và tên tác giả (client-side filtering, normalize dấu tiếng Việt)
- Lọc theo danh mục
- Phân trang với Firestore cursor (`startAfter`)

---

### 4.5 Giỏ mượn & Đặt phiếu (User)

**✅ Giỏ mượn**
- Lưu trữ trong `localStorage` — không mất dữ liệu khi reload trang
- Chỉ thêm sách còn khả dụng (`availableQuantity > 0`)
- Hiển thị số lượng giỏ real-time trên navbar

**✅ Quy trình đặt phiếu mượn (`handleCheckout`)**
1. Kiểm tra đăng nhập và role (Thủ thư không được mượn)
2. Kiểm tra xác minh danh tính (`isVerified === true`)
3. Kiểm tra trạng thái tài khoản (không bị ban/lock)
4. Kiểm tra phiếu phạt chưa thanh toán (chặn nếu còn nợ)
5. Kiểm tra đã có phiếu đang chờ/đang mượn (một phiếu hoạt động tại một thời điểm)
6. Kiểm tra số lượng sách không vượt hạn mức theo điểm uy tín
7. Tạo phiếu trong **Firestore Transaction**: giảm `availableQuantity` các sách + tạo document `borrowRecords`
8. Gửi email xác nhận mã phiếu qua EmailJS

**✅ Sửa phiếu đang chờ**
- Độc giả có thể thay đổi danh sách sách trong phiếu `pending` trước khi Admin duyệt
- Dùng Transaction để hoàn lại số lượng sách cũ và trừ số lượng sách mới

**✅ Hủy phiếu đang chờ**
- Độc giả tự hủy phiếu `pending` — hoàn lại số lượng nguyên tử trong Transaction

---

### 4.6 Quản lý Phiếu mượn — Admin (`admin-loans.js`)

**✅ Giao diện 4 tab với thống kê động**
- **Chờ duyệt (pending):** danh sách phiếu chờ, hiển thị thời gian chờ từ lúc đặt
- **Đang mượn (borrowing):** theo dõi ngày mượn, ngày hết hạn, số ngày còn lại
- **Quá hạn (overdue):** số ngày trễ, phí phạt tạm tính theo biểu phí hiện hành
- **Đã trả (returned):** tổng phạt thực thu (quá hạn + hư hỏng)

**✅ Duyệt phiếu (`approveTicket`)**
- Chuyển trạng thái `pending` → `borrowing` trong Transaction
- Tự động tính `dueDate` dựa trên `borrowDurationDays` từ cài đặt hệ thống
- Gửi email thông báo duyệt + ngày hết hạn qua EmailJS

**✅ Trả sách (`returnTicket`)**
- Tính phạt quá hạn theo biểu phí động từ `system/feeSchedule`
- Nhập thêm phí hư hỏng thủ công
- Hoàn lại số lượng sách trong Transaction
- Tự động tạo document `fines/{recordDocId}` nếu có phạt (ID cố định = idempotent khi retry)
- Cập nhật điểm uy tín người dùng trong cùng Transaction

**✅ Gia hạn phiếu (`extendTicket`)**
- Giới hạn số lần gia hạn tối đa (mặc định 3 lần, cấu hình được)
- Nếu phiếu đã quá hạn, tính thêm `extraDays` từ hôm nay thay vì từ `dueDate` gốc
- Ghi nhận `extensionCount` trong Firestore

**✅ Tạo phiếu mượn trực tiếp (Admin)**
- Admin tạo phiếu thay độc giả không cần qua giỏ
- Cảnh báo nếu độc giả đang có phạt chưa thanh toán (không chặn — Admin có quyền override)
- Phiếu được đánh dấu `createdBy: 'admin'`

**✅ Modal chi tiết phiếu với timeline**
- Hiển thị 4 bước trạng thái: Đăng ký → Duyệt → Đang mượn → Hoàn trả
- Xem danh sách sách kèm ảnh bìa

**✅ Phân trang & tìm kiếm**
- Tìm theo mã phiếu, tên, SĐT, CCCD
- Phân trang client-side với kiểu hiển thị "..." khi nhiều trang

**✅ Tự động hủy phiếu hết giờ giữ (client-side)**
- Khi load danh sách phiếu, phát hiện các phiếu `pending` quá 24h → gọi `markCancelledAndRestore` (Transaction)

---

### 4.7 Quản lý Phiếu phạt (`admin-fines.js`)

**✅ Xem phiếu phạt theo tab**
- Tab: Chưa thanh toán / Đã thanh toán / Đã miễn
- Tìm kiếm theo tên độc giả hoặc mã phiếu phạt

**✅ Thu tiền phạt**
- Cập nhật `status: 'paid'` + ghi `paidAt`
- Tự động mở khóa tài khoản nếu người dùng đang bị khóa và đây là khoản phạt cuối cùng

**✅ Miễn phạt (waive)**
- Yêu cầu nhập lý do tối thiểu 10 ký tự
- Ghi nhận: `status: 'waived'`, `waivedReason`, `waivedBy` (UID admin), `waivedAt`

**✅ Dashboard tổng quan phạt**
- Tổng tiền chưa thu / Số phiếu chưa thu
- Tổng phiếu đã xử lý (thu + miễn)

---

### 4.8 Quản lý Độc giả (`readers.js`)

**✅ Danh sách với metrics tổng hợp**
- Kết hợp real-time data từ 3 collections: `users`, `borrowRecords`, `fines`
- Debounce 60ms để gom nhiều snapshot updates thành 1 lần render

**✅ Thống kê tổng quan**
- Tổng độc giả, tổng đang hoạt động, tổng đang bị khóa, tổng số thủ thư, tổng nợ phạt toàn hệ thống

**✅ Lọc đa tiêu chí**
- Lọc theo: Tất cả / Thành viên / Vãng lai / Thủ thư / Đang mượn / Có nợ phạt / Nguy cơ cao

**✅ Tô màu theo rủi ro**
- Hàng nền đỏ nhạt: tài khoản bị khóa hoặc điểm uy tín < 40
- Hàng nền vàng nhạt: còn phiếu phạt chưa thanh toán
- Hàng trắng bình thường

**✅ Modal chi tiết độc giả**
- Thông tin cơ bản, điểm uy tín (thanh tiến trình + badge hạng)
- Timeline lịch sử uy tín (hiển thị tối đa 10 sự kiện gần nhất)
- Danh sách sách đang mượn với số ngày còn lại / quá hạn
- Lịch sử phiếu phạt

**✅ Khóa/Mở khóa tài khoản**
- Cập nhật `status: 'locked'` hoặc `status: 'active'`

**✅ Sửa thông tin độc giả**
- Cập nhật: tên hiển thị, SĐT, email

**✅ Thu nợ nhanh**
- Nút thu nợ trực tiếp từ danh sách — đánh dấu tất cả phiếu phạt `unpaid` của người đó thành `paid` bằng writeBatch

**✅ Nâng cấp thành Thủ thư**
- Tìm kiếm user từ dropdown, chọn quyền hạn, ghi `role: 'librarian'` + `permissions` + `promotedAt`

**✅ Thêm độc giả vãng lai**
- Tạo tài khoản không có Firebase Auth (chỉ Firestore), đánh dấu `accountType: 'guest'`

**✅ Xuất Excel**
- Dùng SheetJS — xuất toàn bộ danh sách gồm: tên, mã, email, SĐT, vai trò, số đang mượn, nợ phạt, điểm uy tín, trạng thái, ngày tạo

---

### 4.9 Tài chính (`admin-finance.js`)

**✅ Tab Dashboard tài chính**
- Thống kê: tổng nợ chưa thu, số phiếu chưa thu; thu trong tháng, số phiếu đã thu; tổng đã miễn; tỷ lệ thu hồi
- Biểu đồ cột 6 tháng gần nhất (số tiền thu theo tháng — tự vẽ bằng CSS, không cần Chart.js)
- Top 5 con nợ lớn nhất
- 10 phiếu phạt mới nhất

**✅ Tab Biểu phí động**
- Cấu hình biểu phí quá hạn multi-tier: `[{ maxDays: 7, ratePerDay: 1000 }, { maxDays: 30, ratePerDay: 2000 }, { maxDays: null, ratePerDay: 5000 }]`
- Thêm/xóa bậc phí linh hoạt
- Cấu hình mức phạt hư hỏng (nhẹ/vừa/nặng)
- Hệ số phạt mất sách (mặc định 1.5x giá bìa)
- Tùy chọn phí gia hạn
- Lưu vào `system/feeSchedule` — áp dụng ngay cho tất cả tính toán phạt

**✅ Tab Định giá sách**
- Xem và cập nhật giá bìa từng cuốn sách
- Thống kê: tổng giá trị kho sách, số sách đã/chưa có giá
- Lọc: tất cả / có giá / chưa có giá
- Tìm kiếm theo tên sách/tác giả
- Phân trang (15 sách/trang)

**✅ Tab Lịch sử giao dịch**
- Toàn bộ phiếu phạt với bộ lọc: tên/mã phiếu, trạng thái, loại phạt (trễ hạn/hư hỏng/mất sách), khoảng ngày

**✅ Xuất CSV**
- Xuất theo tab đang xem (giao dịch hoặc định giá sách)
- Tự động thêm BOM UTF-8 để Excel mở đúng tiếng Việt

---

### 4.10 Dashboard Admin (`admin.js`)

**✅ Thống kê real-time với `onSnapshot`**
- Tổng số sách trong kho
- Số phiếu đang cho mượn
- Tổng số độc giả
- Tổng số danh mục

**✅ Hoạt động gần đây**
- 10 phiếu mượn mới nhất (mượn + trả), hiển thị: tên người, tên sách (+x cuốn), thời gian

**✅ Top 5 sách mượn nhiều**
- Sắp xếp theo `totalQuantity`, hiển thị thanh tiến trình tương đối

---

### 4.11 Cài đặt hệ thống (`admin-settings.js`)

**✅ 6 nhóm cài đặt lưu Firestore (`system/settings`)**

| Nhóm | Các tham số |
|------|-------------|
| **Chung** | Tên thư viện, địa chỉ, điện thoại, email liên hệ |
| **Giao diện** | Dark mode, màu chủ đề (xanh/tím/đỏ/cam) |
| **Thư viện** | Thời hạn mượn (ngày), số sách tối đa/phiếu, số lần gia hạn, số ngày gia hạn mỗi lần, giờ hết hạn giữ chỗ, phí phạt/ngày, cho phép gia hạn, chỉ 1 phiếu cùng lúc |
| **Uy tín** | Điểm mặc định, điểm tối thiểu để mượn, điểm phạt/ngày, bonus không vi phạm, thời gian bonus |
| **Thông báo** | Bật/tắt email mượn sách, cảnh báo quá hạn, thành viên mới |
| **Bảo mật** | 2FA (config), cooldown đổi SĐT, yêu cầu xác minh danh tính, tự động khóa khi quá hạn |

**✅ Cache 5 phút**
- Tất cả modules (`borrow.js`, `identity.js`, `cart.js`) dùng `getSystemSettings()` — không đọc Firestore thừa

**✅ Đổi mật khẩu Admin**
- Re-authenticate bằng mật khẩu hiện tại trước khi cập nhật mật khẩu mới

---

### 4.12 Lịch sử mượn sách (User — `borrow-history.js`)

**✅ Hiển thị trạng thái đầy đủ**
- Danh sách tất cả phiếu mượn của người dùng hiện tại
- Trạng thái: Chờ duyệt / Đang mượn / Quá hạn / Đã trả / Đã hủy
- Ngày mượn, ngày hết hạn, số ngày còn lại / quá hạn
- Phí phạt nếu có

**✅ Nút hủy/sửa phiếu đang chờ**
- Độc giả tự hủy phiếu `pending` của mình
- Độc giả chỉnh sửa danh sách sách trong phiếu `pending`

---

### 4.13 Hồ sơ & Xác minh (User — `profile.js`)

**✅ Xem và cập nhật thông tin cá nhân**
- Tên hiển thị, email, ảnh đại diện

**✅ Form xác minh danh tính**
- Nhập SĐT + CCCD → hash CCCD → chạy Transaction (kiểm tra unique → ghi)
- Sau khi xác minh: hiển thị trạng thái đã xác minh + hạng uy tín hiện tại

**✅ Đổi số điện thoại**
- Nhập SĐT mới + CCCD để xác nhận danh tính
- Kiểm tra cooldown 60 ngày

---

### 4.14 Catalog sách & Trang chủ (User — `public-books.js`)

**✅ Catalog công khai**
- Không cần đăng nhập để xem
- Tìm kiếm theo tên sách/tác giả (normalize dấu tiếng Việt)
- Lọc theo danh mục
- Phân trang Firestore (`startAfter`)
- Hiển thị trạng thái: Còn sách / Hết sách

**✅ Trang chi tiết sách**
- Thông tin đầy đủ: tên, tác giả, danh mục, số lượng khả dụng, ảnh bìa
- Nút thêm vào giỏ (disabled nếu hết sách)

---

### 4.15 Tính năng phụ trợ

**✅ Yêu thích sách**
- Lưu vào `localStorage` — không cần Firestore
- Hiển thị số lượng yêu thích trên navbar

**✅ Thông báo real-time**
- `onSnapshot` lắng nghe collection `notifications` của user

**✅ In phiếu mượn**
- `slips.js` tạo bản in từ dữ liệu phiếu mượn

**✅ Seeder dữ liệu mẫu**
- `seeder.js` tạo sách, danh mục, phiếu mượn mẫu để phục vụ demo/test

---

## 5. Cấu trúc dữ liệu Firestore

### `books/{bookId}`
```javascript
{
  title: string,
  author: string,
  categoryId: string,          // FK tới categories/{catId}
  categoryName: string,        // Denormalized — tránh JOIN trong NoSQL
  quantity: number,            // Tổng số lượng sách (không đổi khi mượn)
  availableQuantity: number,   // Số lượng khả dụng (thay đổi khi mượn/trả)
  status: "available" | "out_of_stock",
  coverUrl: string,            // URL Firebase Storage path: /covers/
  price: number,               // Giá bìa (VNĐ) — dùng tính phạt mất sách
  createdAt: Timestamp
}
```

### `categories/{categoryId}`
```javascript
{
  name: string,
  createdAt: Timestamp
}
```

### `users/{uid}`
```javascript
{
  email: string,
  displayName: string,
  photoURL: string | null,
  role: "admin" | "librarian" | "user",
  status: "active" | "locked" | "banned" | "permanently_banned",
  isVerified: boolean,         // true: đã xác minh SĐT + CCCD
  phone: string | null,        // SĐT đã xác minh (10 số)
  cccdHash: string | null,     // SHA-256 hex hash của CCCD (64 ký tự)
  reputationScore: number,     // 0–100, khởi tạo = 100
  trustScore: number,          // Alias của reputationScore (backward compat)
  accountType: "guest" | undefined,  // Guest: tạo bởi Admin, không có Auth
  permissions: string[],       // Danh sách quyền (dành cho Librarian)
  phoneChangedAt: Timestamp | null,
  lastPenaltyAt: Timestamp | null,
  verifiedAt: Timestamp | null,
  promotedAt: Timestamp | null,
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

### `borrowRecords/{docId}`
```javascript
{
  recordId: string,            // "LIB-XXXXXX" — 6 ký tự từ charset an toàn
  userId: string,              // Firebase Auth UID của độc giả
  userDetails: {
    fullName: string,
    phone: string,
    cccd: string,              // cccdHash — không lưu CCCD plain text
    email: string
  },
  books: [{
    bookId: string,
    title: string,
    author: string,
    coverUrl: string,
    price: number,
    quantity: number           // Số cuốn được mượn trong 1 phiếu
  }],
  status: "pending" | "borrowing" | "returned" | "cancelled",
  requestDate: Timestamp,      // Thời điểm đặt phiếu
  borrowDate: Timestamp | null,   // Thời điểm Admin duyệt
  dueDate: Timestamp | null,      // Ngày phải trả
  returnDate: Timestamp | null,   // Ngày thực tế trả
  fineOverdue: number,         // Phạt quá hạn (VNĐ)
  fineDamage: number,          // Phạt hư hỏng (VNĐ)
  extensionCount: number,      // Số lần đã gia hạn
  isOverdue: boolean,
  lastWarningDate: Timestamp | null,  // Lần cảnh báo quá hạn gần nhất
  lastReminderDate: Timestamp | null, // Lần nhắc sắp đến hạn gần nhất
  adminNote: string,
  createdBy: "admin" | undefined,  // Phiếu do Admin tạo trực tiếp
  cancelledAt: Timestamp | null,
  updatedAt: Timestamp
}
```

### `fines/{fineId}` *(fineId = recordDocId — đảm bảo idempotent)*
```javascript
{
  fineId: string,              // "F-XXXXXX"
  recordId: string,            // Mã phiếu mượn liên quan (LIB-XXXXXX)
  userId: string,
  userName: string,
  bookTitles: string[],
  dueDate: Timestamp,
  returnDate: Timestamp,
  daysLate: number,
  amount: number,              // Tổng phạt = overdueAmount + damageAmount
  overdueAmount: number,
  damageAmount: number,
  status: "unpaid" | "paid" | "waived",
  paidAt: Timestamp | null,
  waivedAt: Timestamp | null,
  waivedReason: string | null,
  waivedBy: string | null,     // UID của Admin miễn phạt
  createdAt: Timestamp
}
```

### `phones/{phoneNumber}` — Inverted Index (chống trùng SĐT)
```javascript
{ uid: string, createdAt: Timestamp }
```

### `cccds/{cccdHash}` — Inverted Index (chống trùng CCCD)
```javascript
{ uid: string, createdAt: Timestamp }
```

### `identityAuditLog/{logId}` — Nhật ký xác minh
```javascript
{ uid: string, action: string, details: object, createdAt: Timestamp }
```

### `system/{docId}` — Cấu hình hệ thống
- `system/settings` — Cài đặt (library, reputation, security, ui, notifications, general)
- `system/feeSchedule` — Biểu phí phạt động (`lateFees`, `damageLevels`, `lostBookMultiplier`)

### `mail/{mailId}` — Hàng đợi email (Trigger Email Extension)
```javascript
{ to: string, message: { subject: string, html: string } }
```

### `reservations/{resId}` — Đặt trước sách (khi hết)
```javascript
{ userId: string, bookId: string, status: string, createdAt: Timestamp }
```

---

## 6. Bảo mật hệ thống

### Firestore Security Rules (`firestore.rules`)

**3 helper functions:**
- `isSignedIn()` — đã xác thực Firebase Auth
- `isStaff()` — role là `admin` hoặc `librarian`
- `isAdmin()` — role là `admin`
- `isOwner(uid)` — `request.auth.uid == uid`

| Collection | Quyền đọc | Quyền ghi |
|---|---|---|
| `books` | Public (không cần đăng nhập) | Staff only |
| `categories` | Public | Staff only |
| `users` | Chủ TK hoặc Staff | Chủ TK (không sửa `role`/`reputationScore`/`isVerified`/`cccdHash`), Staff |
| `borrowRecords` | Chủ phiếu hoặc Staff | Đăng nhập (tạo cho mình), Staff (sửa/xóa) |
| `fines` | Chủ phiếu phạt hoặc Staff | Staff only |
| `phones` / `cccds` | Staff only | Đăng nhập (chỉ tạo), Staff (sửa/xóa) |
| `identityAuditLog` | Admin only | Đăng nhập (tạo, không sửa/xóa) |
| `system` | Đăng nhập | Admin only |
| `mail` | Admin only | Đăng nhập (tạo, không sửa/xóa) |
| `reservations` | Chủ hoặc Staff | Đăng nhập (tạo cho mình), Chủ/Staff (sửa/xóa) |

### Storage Rules (`storage.rules`)
- `/covers/**`: authenticated users đọc, **chỉ Admin ghi**
- Các path khác: authenticated users đọc, Admin ghi

### Composite Index (`firestore.indexes.json`)
```json
books: [categoryId ASC, createdAt DESC]
```
Phục vụ query lọc theo danh mục + sắp xếp theo ngày thêm.

---

## 7. Cloud Functions & Tự động hóa

### `autoCleanup` — Scheduled Function
- **Runtime:** Node.js 18
- **Lịch:** `0 8 * * *` (08:00 sáng hàng ngày, múi giờ `Asia/Ho_Chi_Minh`)
- **Scope:** Xử lý tất cả phiếu có `status in ['pending', 'borrowing']`

**Hành vi 1: Hủy phiếu hết hạn giữ chỗ**
```
Điều kiện: status === 'pending' VÀ requestDate + 24h < now
→ Dùng Batch Write (nguyên tử):
   - Tất cả sách trong phiếu: availableQuantity += quantity, cập nhật status
   - Phiếu: status = 'cancelled', adminNote = 'Hệ thống tự huỷ sau 24 giờ'
→ Gửi email thông báo hủy cho độc giả (sau khi batch commit thành công)
```

**Hành vi 2: Cảnh báo sách quá hạn trả**
```
Điều kiện: status === 'borrowing' VÀ dueDate < now
→ Nếu lastWarningDate < 24h trước:
   - Tính daysLate, calculateFineAmount(daysLate, feeSchedule)
   - Gửi email cảnh báo "quá X ngày, phạt dự kiến Y đồng"
   - Cập nhật lastWarningDate, isOverdue: true
```

**Hành vi 3: Nhắc sắp đến hạn**
```
Điều kiện: status === 'borrowing' VÀ -2 <= daysLate <= 0
(còn 0, 1 hoặc 2 ngày)
→ Nếu lastReminderDate < 24h trước:
   - Gửi email nhắc nhở với thông tin số ngày còn lại
   - Cập nhật lastReminderDate
```

**Tính năng bổ sung:**
- Load `feeSchedule` từ Firestore 1 lần cho toàn bộ job (tránh đọc thừa)
- Mỗi record được wrap trong `try-catch` riêng — 1 lỗi không crash toàn bộ job
- Log tổng số record đã xử lý sau khi hoàn thành

---

## 8. Hướng dẫn cài đặt & chạy

### Yêu cầu
- **Node.js** v18+ (Cloud Functions yêu cầu Node 18)
- **Firebase CLI:** `npm install -g firebase-tools`
- Tài khoản [Firebase](https://firebase.google.com/) và một project được tạo sẵn

### Bước 1: Clone repo
```bash
git clone https://github.com/Thiez703/library-management-firebase.git
cd library-management-firebase
```

### Bước 2: Cấu hình Firebase
File `assets/js/firebase-config.js` đã được cấu hình cho project `library-management-6a7ac`.

Nếu tạo Firebase project riêng, thay thế giá trị tương ứng:
```javascript
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-auth.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.firebasestorage.app",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app, `gs://${firebaseConfig.storageBucket}`);
```

> Lấy config tại: **Firebase Console → Project Settings → Your apps (Web)**

### Bước 3: Cài dependencies Cloud Functions
```bash
cd functions
npm install
cd ..
```

### Bước 4: Đăng nhập và liên kết project
```bash
firebase login
firebase use library-management-6a7ac
# Hoặc với project mới:
firebase use --add
```

### Bước 5: Chạy local với Emulator
```bash
firebase emulators:start
```

| URL | Mô tả |
|-----|-------|
| `http://localhost:5000` | Ứng dụng web |
| `http://localhost:4000` | Firebase Emulator UI |

---

## 9. Deploy lên Firebase

**Deploy toàn bộ:**
```bash
firebase deploy
```

**Deploy từng phần:**
```bash
firebase deploy --only hosting       # Chỉ web app
firebase deploy --only functions     # Chỉ Cloud Functions
firebase deploy --only firestore     # Chỉ Firestore rules + indexes
firebase deploy --only storage       # Chỉ Storage rules
```

**URL Production:** `https://library-management-6a7ac.web.app`

---

## 10. Cấu hình Email

### 10.1 EmailJS (gửi client-side, tức thì)
Dùng cho: xác nhận mã phiếu mượn + thông báo phiếu được duyệt.

Cấu hình trong `assets/js/emailjs-service.js`:
```javascript
CONFIG: {
    SERVICE_ID: 'YOUR_SERVICE_ID',
    PUBLIC_KEY: 'YOUR_PUBLIC_KEY',
    TEMPLATES: {
        BORROW_CODE: 'template_borrow_code',
        APPROVED: 'template_approved'
    }
}
```

Template variables:
- `BORROW_CODE`: `user_name`, `record_id`, `book_count`, `reader_email`
- `APPROVED`: `user_name`, `record_id`, `due_date`, `reader_email`

### 10.2 Firebase Trigger Email Extension (gửi server-side, từ Cloud Functions)
Dùng cho: cảnh báo quá hạn, nhắc sắp đến hạn, hủy phiếu tự động.

**Cài đặt:**
1. Vào Firebase Console → Extensions → Install "Trigger Email from Firestore"
2. Cấu hình:
   - **Email documents collection:** `mail`
   - **SMTP Connection URI:** `smtps://your-email@gmail.com:app-password@smtp.gmail.com:465`
   - Hoặc dùng OAuth2 Refresh Token

Khi Cloud Function ghi document vào `mail`, extension tự động gửi email đến `to`.

---

## 11. Quy ước phát triển

### Firebase SDK
- Dùng **modular Web SDK v10** qua CDN: `https://www.gstatic.com/firebasejs/10.0.0/...`
- **Không** dùng compat SDK

### Naming Collections
| Collection | Mô tả |
|---|---|
| `books` | Kho sách |
| `categories` | Danh mục sách |
| `users` | Tài khoản (Auth + profile) |
| `borrowRecords` | Phiếu mượn |
| `fines` | Phiếu phạt |
| `phones` | Unique index SĐT |
| `cccds` | Unique index CCCD (đã hash) |
| `identityAuditLog` | Nhật ký xác minh |
| `system` | Cài đặt hệ thống |
| `mail` | Hàng đợi email |
| `reservations` | Đặt trước sách |

### Mã phiếu mượn
- Format: `LIB-XXXXXX` (6 ký tự từ charset `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`)
- Loại bỏ các ký tự dễ nhầm lẫn: `I`, `O`, `0`, `1`

### Database Safety
- **Bắt buộc dùng Firestore Transaction** cho tất cả thao tác: mượn, trả, duyệt, hủy, gia hạn
- **Pattern đọc-ghi Transaction:** đọc tất cả docs trong phase 1, ghi tất cả trong phase 2 — tránh lỗi "read after write"
- **Batch write** cho cleanup hàng loạt (tối đa 499 operations/batch)

### State Management
- User info: `localStorage` key `lib_user`
- System settings: module-level cache 5 phút (`getSystemSettings()`)
- Fee schedule: module-level cache 5 phút (`getActiveFeeSchedule()`)
- Giỏ mượn: `localStorage` key `lib_cart`

### UI Components
- Tailwind CSS utility classes — không viết CSS thủ công
- Phosphor Icons: `<i class="ph ph-icon-name"></i>`
- Toast: `showToast(message, type)` từ `notify.js`
- Confirm dialog: `showConfirm(message, options)` từ `notify.js`

---

## 12. Lộ trình thực hiện

| Tuần | Thời gian | Nội dung |
|------|-----------|----------|
| **Tuần 1** | 31/03 – 06/04 | Thiết kế hệ thống, setup Firebase, xây dựng UI cơ bản (trang chủ, catalog, đăng nhập) |
| **Tuần 2** | 07/04 – 13/04 | Auth + phân quyền, CRUD sách + upload ảnh, luồng mượn/trả cơ bản (Transaction) |
| **Tuần 3** | 14/04 – 20/04 | Hệ thống xác minh danh tính 3 lớp (CCCD hash, unique index), điểm uy tín động, Cloud Functions, quản lý phạt & tài chính |
| **Tuần 4** | 21/04+ | Cài đặt hệ thống động, báo cáo, xuất Excel/CSV, kiểm thử toàn diện và deploy production |

---

## 👥 Nhóm phát triển

Dự án học tập — Nhóm 7 thành viên.

---

*Tài liệu được cập nhật lần cuối: 21/04/2026*

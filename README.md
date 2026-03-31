# library-management-firebase
# 📚 Hệ Thống Quản Lý Thư Viện Sách

![HTML](https://img.shields.io/badge/HTML5-E34F26?style=flat&logo=html5&logoColor=white)
![TailwindCSS](https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=flat&logo=tailwind-css&logoColor=white)
![Firebase](https://img.shields.io/badge/Firebase-FFCA28?style=flat&logo=firebase&logoColor=black)
![Firestore](https://img.shields.io/badge/Firestore-039BE5?style=flat&logo=firebase&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green?style=flat)

Ứng dụng web quản lý sách và mượn/trả sách cho thư viện, xây dựng bằng Firebase và Tailwind CSS. Dự án học tập của nhóm 7 thành viên.

---

## ✨ Tính năng chính

- 🔐 **Đăng ký / Đăng nhập** — Xác thực bằng Email & Password qua Firebase Auth
- 👤 **Phân quyền** — Admin toàn quyền quản lý; User chỉ xem và đăng ký mượn sách
- 📖 **Quản lý kho sách (CRUD)** — Thêm, sửa, xóa sách kèm upload ảnh bìa lên Firebase Storage
- 🔄 **Mượn / Trả sách** — Xử lý an toàn bằng Firestore Transaction, tránh race condition
- 🔍 **Tìm kiếm & lọc** — Tìm theo tên sách hoặc tác giả; lọc theo thể loại
- 📄 **Phân trang** — Firestore cursor (`startAfter`) tránh load quá nhiều dữ liệu cùng lúc
- 📋 **Lịch sử mượn sách** — Xem trạng thái đang mượn / đã trả theo từng người dùng

---

## 🛠️ Công nghệ sử dụng

| Lớp | Công nghệ |
|-----|-----------|
| Giao diện | HTML5, Tailwind CSS |
| Cơ sở dữ liệu | Firebase Firestore (NoSQL) |
| Xác thực | Firebase Authentication |
| Lưu trữ ảnh | Firebase Storage |
| Triển khai | Firebase Hosting |

---

## 📁 Cấu trúc thư mục

```
library-management-firebase/
├── index.html              # Trang chủ — danh sách sách (User)
├── admin.html              # Dashboard quản trị (Admin)
├── login.html              # Đăng nhập / Đăng ký
├── book-detail.html        # Chi tiết sách
├── borrow-history.html     # Lịch sử mượn sách
├── assets/
│   └── js/
│       ├── firebase-config.js   # Cấu hình Firebase (không commit)
│       ├── auth.js              # Đăng nhập, đăng ký, phân quyền
│       ├── books.js             # CRUD sách + upload ảnh
│       ├── borrow.js            # Logic mượn/trả — Firestore Transaction
│       └── admin.js             # Tính năng dành riêng Admin
├── .env.example            # Mẫu biến môi trường
├── .gitignore
├── firebase.json           # Cấu hình Firebase Hosting
└── README.md
```

---

## ⚙️ Cài đặt và chạy local

### Yêu cầu
- [Node.js](https://nodejs.org/) v16 trở lên
- Tài khoản [Firebase](https://firebase.google.com/)
- Firebase CLI: `npm install -g firebase-tools`

### Các bước

**1. Clone repo**
```bash
git clone https://github.com/ten-ban/library-management-firebase.git
cd library-management-firebase
```

**2. Tạo file cấu hình Firebase**

Tạo file `assets/js/firebase-config.js` theo mẫu `.env.example`:

```javascript
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-auth.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);
```

> Lấy thông tin tại: **Firebase Console → Project Settings → Your apps**

**3. Chạy local với Firebase Emulator**
```bash
firebase login
firebase init emulators
firebase emulators:start
```

Mở trình duyệt tại `http://localhost:5000`

---

## 🗂️ Cấu trúc dữ liệu Firestore

```
books/{bookId}
  ├── title: string
  ├── author: string
  ├── categoryName: string   # Lưu thẳng tên thể loại (NoSQL — không JOIN)
  ├── quantity: number
  ├── coverUrl: string
  └── createdAt: timestamp

users/{uid}
  ├── email: string
  ├── displayName: string
  └── role: "admin" | "user"

borrowRecords/{recordId}
  ├── userId: string
  ├── bookId: string
  ├── bookTitle: string      # Lưu thẳng tên sách để tránh query thêm
  ├── borrowDate: timestamp
  ├── returnDate: timestamp | null
  └── status: "borrowing" | "returned"

categories/{categoryId}
  └── name: string
```

---

## 🚀 Deploy lên Firebase Hosting

```bash
firebase login
firebase init hosting
firebase deploy --only hosting
```

Sau khi deploy, website có link dạng `https://ten-project.web.app`

---

## 📅 Lộ trình thực hiện

| Tuần | Thời gian | Nội dung |
|------|-----------|----------|
| Tuần 1 | 31/03 – 06/04 | Thiết kế hệ thống, setup Firebase, xây dựng UI cơ bản |
| Tuần 2 | 07/04 – 13/04 | Auth, CRUD sách, logic mượn/trả bằng Transaction |
| Tuần 3 | 14/04 – 20/04 | Tìm kiếm, phân trang, kiểm thử, tối ưu và deploy |

---

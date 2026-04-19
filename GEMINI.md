# GEMINI.md - Project Context

## Project Overview
A web-based Library Management System built using Firebase services and Tailwind CSS. The application supports user authentication, role-based access control (Admin/User), book inventory management (CRUD), and book borrowing/returning logic using Firestore transactions.

- **Primary Technologies:** HTML5, Tailwind CSS, JavaScript (ES Modules).
- **Backend Services:** Firebase Authentication, Firestore (NoSQL), Firebase Storage (Images), and Firebase Hosting.
- **Architecture:** Client-side rendered (CSR) using Vanilla JS and Firebase Web SDK (v10+).

## Directory Structure
- `admin/`: Contains HTML views for administrative tasks (book management, categories, loans, etc.).
- `user/`: Contains HTML views for regular users (catalog, book details, borrow history, login/register).
- `assets/js/`: Core application logic.
    - `firebase-config.js`: Firebase initialization and exported service instances (`db`, `auth`, `storage`).
    - `auth.js`: Handles user registration, login (Email/Password & Google), and role-based UI rendering.
    - `books.js`: CRUD operations for books and category management.
    - `borrow.js`: Logic for borrowing and returning books with transaction support.
    - `admin-loans.js`: Management of loan records for administrators.
- `firebase.json`: Configuration for Firebase Hosting, Firestore indexes, and Storage rules.

## Building and Running
### Prerequisites
- [Node.js](https://nodejs.org/) v16+
- Firebase CLI: `npm install -g firebase-tools`

### Local Development
1. **Firebase Configuration:** Ensure `assets/js/firebase-config.js` is correctly populated with your Firebase project credentials.
2. **Login to Firebase:**
   ```powershell
   firebase login
   ```
3. **Run with Emulators (Recommended):**
   ```powershell
   firebase emulators:start
   ```
   The application will be available at `http://localhost:5000` (by default).

### Deployment
To deploy the application to Firebase Hosting:
```powershell
firebase deploy --only hosting
```

## Development Conventions
- **Firebase SDK:** Use the modular Web SDK (v10+). Imports should use CDN links (e.g., `https://www.gstatic.com/firebasejs/10.0.0/...`) or be managed via `package.json` if using a bundler. Currently, the project uses direct CDN imports in JS files.
- **State Management:** User data and roles are cached in `localStorage` under the key `lib_user` to minimize Firestore reads.
- **Database Safety:** All borrow/return operations **must** use Firestore Transactions to ensure data integrity (handling quantity updates and record creation atomically).
- **Naming Conventions:**
    - Collections: `books`, `users`, `borrowRecords`, `categories`.
    - Roles: `admin`, `user`.
- **UI:** Utility-first styling with Tailwind CSS. Icons are provided by Phosphor Icons (`ph ph-...`).
- **Email Notifications:** Implemented via the **Firebase "Trigger Email" Extension**.
    - **Trigger Collection:** `mail`
    - **Trigger Points:**
        - `handleCheckout`: Sends borrow code and confirmation after registration.
        - `approveTicket`: Sends approval notification with due date when admin approves.
        - `autoCleanup`: Sends warnings for expired codes (after 24h) and books due within 2 days or overdue.
    - **Configuration (Firebase Console):**
        - Install "Trigger Email" extension.
        - Set `Email documents collection` to `mail`.
        - **SMTP Connection URI:** `smtps://your-email@gmail.com@smtp.gmail.com:465` (Use OAuth2).
        - Use the provided **Refresh Token** in the SMTP configuration.

## Firestore Data Schema
- **books**: `{ title, author, categoryName, quantity, coverUrl, createdAt }`
- **users**: `{ email, displayName, role, status, createdAt }`
- **borrowRecords**: `{ userId, bookId, bookTitle, borrowDate, returnDate, status }`
- **categories**: `{ name }`

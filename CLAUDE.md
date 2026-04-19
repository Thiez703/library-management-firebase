# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**LibSpace v2.0** — A Firebase-based library management system (quản lý thư viện) with a dual-mode UI: a public reader interface (`/user/`) and an admin dashboard (`/admin/`). Built with vanilla JavaScript (ES6 modules), Tailwind CSS via CDN, and Firebase as the full backend.

Firebase project ID: `library-management-6a7ac`

## Commands

### Firebase Local Development
```bash
# Serve locally with Firebase emulators
firebase emulators:start

# Deploy everything
firebase deploy

# Deploy only hosting
firebase deploy --only hosting

# Deploy only Firestore rules
firebase deploy --only firestore:rules

# Deploy only Cloud Functions
firebase deploy --only functions

# View Cloud Function logs
firebase functions:log
```

### Cloud Functions (inside `/functions/`)
```bash
cd functions
npm install
npm run serve        # Start functions emulator
npm run shell        # Interactive functions shell
npm run deploy       # Deploy functions only
```

There is no build step — this is a static HTML + vanilla JS project served directly.

## Architecture

### Directory Structure
- `/user/` — Reader-facing pages (catalog, book detail, cart, borrow history, auth)
- `/admin/` — Admin dashboard pages (books CRUD, loans, readers, fines, reports)
- `/assets/js/` — All JavaScript modules, one file per feature domain
- `/functions/` — Firebase Cloud Functions (Node.js 18)

### JavaScript Module Pattern
All JS files are ES6 modules loaded via `<script type="module">`. Each page imports the relevant module(s). There is no bundler — Firebase SDK and other libraries (Tailwind, Phosphor Icons, Turbo.js) are loaded from CDN.

Key module responsibilities:
- `firebase-config.js` — Initializes Firebase app, exports `db`, `auth`, `storage` refs
- `auth.js` — Auth state management, user session, role checks
- `admin-guard.js` — Redirects non-admins away from `/admin/` pages
- `books.js` — Book CRUD with image upload to Firebase Storage
- `borrow.js` — Borrow/return transactions using Firestore `runTransaction()` to prevent race conditions
- `cart.js` — Cart state in `localStorage` (key: `libcart`); user cache in `localStorage` (key: `lib_user`)
- `identity.js` — Phone + CCCD (national ID) verification with SHA-256 hashing
- `notify.js` — Global toast (`showToast()`) and confirmation dialog (`showConfirm()`)
- `admin-loans.js` / `admin-fines.js` — Admin-side loan and fine management

### Firestore Data Model
Collections: `books`, `users`, `borrowRecords`, `categories`, `fines`, `reservations`, `phones`, `cccds`, `identityAuditLog`, `system`, `mail`

- `borrowRecords` statuses: `pending` → `borrowed` → `returned` (or `overdue`, `cancelled`)
- `users.role`: `"user"` or `"admin"`
- `fines` are created automatically when books are returned late
- `mail` collection is consumed by the Firebase Trigger Email Extension

### Real-time Data
Most list views use Firestore `onSnapshot()` listeners for live updates. One-time reads use `getDocs()` / `getDoc()`.

### Cloud Functions
`functions/index.js` contains a single scheduled function `autoCleanup` that runs daily at 08:00 Vietnam time (Asia/Ho_Chi_Minh). It auto-cancels pending borrow codes older than 24 hours, sends overdue warnings, and sends due-date reminders via the Trigger Email Extension.

### Navigation
Turbo.js is used for SPA-like page transitions without full reloads across the user-facing pages.

## Firestore Security Rules

Rules are in `firestore.rules`. Key helpers:
- `isSignedIn()` — user is authenticated
- `isAdmin()` — user document has `role == "admin"`
- `isOwner(uid)` — authenticated user matches the uid

Users cannot modify their own `role`, `reputationScore`, `isVerified`, or `cccdHash` fields directly.

## Firebase Config

`assets/js/firebase-config.js` contains the Firebase client config (API key, project ID, etc.). This is intentional for web apps — security is enforced via Firestore rules and Storage rules, not by hiding the config.

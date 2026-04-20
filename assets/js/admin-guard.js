/**
 * admin-guard.js
 * Module bảo vệ các trang Admin & Librarian.
 * Import và gọi `requireAdmin()` ở đầu mỗi file JS dành cho staff.
 *
 * Luồng hoạt động:
 *  1. Đọc cache từ localStorage (hiển thị nhanh, không chờ mạng).
 *  2. Đồng thời lắng nghe Firebase Auth để xác minh thực sự.
 *  3. Nếu không phải admin/librarian → redirect ngay sang trang login.
 */

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.0.0/firebase-auth.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js';

const LOGIN_URL = '../user/login.html';
const CACHE_KEY = 'lib_user';
const STAFF_ROLES = ['admin', 'librarian'];

/**
 * Lấy role từ localStorage cache (fast path).
 * @returns {'admin'|'user'|null}
 */
const getCachedRole = () => {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        return raw ? JSON.parse(raw)?.role ?? null : null;
    } catch {
        return null;
    }
};

/**
 * Chặn toàn bộ nội dung trang bằng overlay loading
 * để tránh flash nội dung admin trước khi xác thực xong.
 */
const showLoadingOverlay = () => {
    const overlay = document.createElement('div');
    overlay.id = '__admin_guard_overlay__';
    overlay.style.cssText = [
        'position:fixed', 'inset:0', 'z-index:99999',
        'background:#f8fafc', 'display:flex',
        'align-items:center', 'justify-content:center',
        'flex-direction:column', 'gap:12px'
    ].join(';');
    overlay.innerHTML = `
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none"
             xmlns="http://www.w3.org/2000/svg" class="animate-spin"
             style="animation:spin 1s linear infinite">
            <circle cx="12" cy="12" r="10" stroke="#e2e8f0" stroke-width="3"/>
            <path d="M12 2a10 10 0 0 1 10 10" stroke="#2563eb" stroke-width="3" stroke-linecap="round"/>
        </svg>
        <p style="font-size:14px;color:#64748b;font-family:sans-serif">Đang xác thực...</p>
        <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
    `;
    document.body.appendChild(overlay);
    return overlay;
};

const removeOverlay = () => {
    document.getElementById('__admin_guard_overlay__')?.remove();
};

/**
 * Gọi function này ở đầu mỗi trang admin.
 * Nếu người dùng không phải admin, redirect về trang login.
 *
 * @param {Function} [onReady] - Callback được gọi khi đã xác nhận là admin.
 *                               Nếu không truyền, các module tự init như bình thường.
 */
export const requireAdmin = (onReady) => {
    // Fast path: nếu cache cho thấy không phải staff → redirect ngay
    const cachedRole = getCachedRole();
    if (cachedRole !== null && !STAFF_ROLES.includes(cachedRole)) {
        window.location.replace(LOGIN_URL);
        return;
    }

    showLoadingOverlay();

    onAuthStateChanged(auth, async (firebaseUser) => {
        if (!firebaseUser) {
            // Không có session → chuyển về login
            localStorage.removeItem(CACHE_KEY);
            window.location.replace(LOGIN_URL);
            return;
        }

        try {
            // Xác minh role từ Firestore (source of truth)
            const userSnap = await getDoc(doc(db, 'users', firebaseUser.uid));
            const userData = userSnap.exists() ? userSnap.data() : null;
            const role = userData?.role ?? 'user';

            if (!STAFF_ROLES.includes(role)) {
                // User thật nhưng không có quyền staff
                localStorage.removeItem(CACHE_KEY);
                window.location.replace(LOGIN_URL);
                return;
            }

            // ✅ Hợp lệ — cập nhật cache và cho phép vào
            const cached = {
                uid: firebaseUser.uid,
                email: firebaseUser.email,
                displayName: userData?.displayName || firebaseUser.displayName || firebaseUser.email,
                photoURL: userData?.photoURL || firebaseUser.photoURL,
                role: role
            };
            localStorage.setItem(CACHE_KEY, JSON.stringify(cached));

            removeOverlay();
            if (typeof onReady === 'function') onReady(firebaseUser, userData);

        } catch (err) {
            console.error('[admin-guard] Lỗi xác thực:', err);
            // Lỗi mạng → không cho qua dựa trên cache vì cache có thể bị giả mạo.
            // Redirect về login để user đăng nhập lại khi có mạng.
            localStorage.removeItem(CACHE_KEY);
            window.location.replace(LOGIN_URL);
        }
    });
};

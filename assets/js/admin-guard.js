import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.0.0/firebase-auth.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js';

const CACHE_KEY = 'lib_user';
const AVATAR_PLACEHOLDER = '../assets/images/avatar-placeholder.svg';

const getCachedRole = () => {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        return raw ? JSON.parse(raw)?.role ?? null : null;
    } catch { return null; }
};

const showLoadingOverlay = (message = "Đang xác thực...") => {
    let overlay = document.getElementById('__admin_guard_overlay__');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = '__admin_guard_overlay__';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#f8fafc;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px';
        document.body.appendChild(overlay);
    }
    overlay.innerHTML = `
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="animation:spin 1s linear infinite">
            <circle cx="12" cy="12" r="10" stroke="#e2e8f0" stroke-width="3"/>
            <path d="M12 2a10 10 0 0 1 10 10" stroke="#2563eb" stroke-width="3" stroke-linecap="round"/>
        </svg>
        <p style="font-size:14px;color:#64748b;font-family:sans-serif">${message}</p>
        <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
    `;
    return overlay;
};

const removeOverlay = () => document.getElementById('__admin_guard_overlay__')?.remove();

// Cập nhật UI Admin linh hoạt cho mọi trang
const updateAdminUI = (user, userData) => {
    const displayName = userData?.displayName || user.displayName || user.email;
    const photoURL = userData?.photoURL || user.photoURL || AVATAR_PLACEHOLDER;

    // 1. Cập nhật Tên Admin
    const nameEl = document.getElementById('adminName');
    if (nameEl) nameEl.innerText = displayName;

    // 2. Cập nhật mọi Avatar có trong trang (Sidebar, Topbar)
    // Tận dụng class và tag để tìm tất cả
    document.querySelectorAll('aside img, header img, #adminAvatar').forEach(img => {
        img.src = photoURL;
        img.onerror = () => { img.src = AVATAR_PLACEHOLDER; };
    });

    // 3. Gắn sự kiện Đăng xuất (Cho mọi nút logout trong admin)
    const logoutBtns = document.querySelectorAll('#adminLogoutBtn, [id$="LogoutBtn"]');
    logoutBtns.forEach(btn => {
        if (!btn.dataset.bound) {
            btn.dataset.bound = 'true';
            btn.onclick = async (e) => {
                e.preventDefault();
                const { signOutUser } = await import('./auth.js');
                signOutUser();
            };
        }
    });

    // 4. Chuông thông báo - Giờ đây sẽ hiện thông báo khi nhấn
    const bellBtns = document.querySelectorAll('header button[aria-label="Thông báo"], header button[title="Thông báo"]');
    bellBtns.forEach(btn => {
        if (!btn.dataset.bound) {
            btn.dataset.bound = 'true';
            btn.title = "Xem các báo cáo quan trọng";
            btn.onclick = () => {
                const { showToast } = import('./auth.js').then(m => {
                    m.showToast("Đang chuyển đến trang thống kê...", "info");
                    setTimeout(() => window.location.href = 'reports.html', 500);
                });
            };
        }
    });
};

export const requireAdmin = (onReady) => {
    const cachedRole = getCachedRole();
    const LOGIN_URL = '../user/login.html';

    if (cachedRole === 'user' || cachedRole === 'reader') {
        window.location.replace(LOGIN_URL);
        return;
    }

    showLoadingOverlay();
    let isResolved = false;

    onAuthStateChanged(auth, async (user) => {
        if (isResolved) return;

        if (!user) {
            isResolved = true;
            window.location.replace(LOGIN_URL);
            return;
        }

        try {
            const userSnap = await getDoc(doc(db, 'users', user.uid));
            const userData = userSnap.exists() ? userSnap.data() : null;
            const role = userData?.role || 'user';

            if (role !== 'admin') {
                isResolved = true;
                window.location.replace('../user/index.html');
                return;
            }

            isResolved = true;
            updateAdminUI(user, userData);
            removeOverlay();
            if (typeof onReady === 'function') onReady(user, userData);
        } catch (err) {
            console.error("[Guard] Auth Error:", err);
            window.location.replace(LOGIN_URL);
        }
    });
};

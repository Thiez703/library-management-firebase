import { auth, db } from './firebase-config.js';
import { 
    signOut, 
    onAuthStateChanged, 
    GoogleAuthProvider, 
    signInWithPopup,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-auth.js";
import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";
import { initFavoriteFeature } from './favorites.js';
import { showToast as notifyToast, showConfirm } from './notify.js';

const googleProvider = new GoogleAuthProvider();
const AVATAR_PLACEHOLDER = '../assets/images/avatar-placeholder.svg';

export const showToast = (message, type = 'success') => notifyToast(message, type);

const saveUserCache = (user, userData) => {
    if (!user) return;
    const cacheData = { 
        uid: user.uid, 
        email: user.email, 
        role: userData?.role || 'user', 
        displayName: userData?.displayName || user.displayName || user.email.split('@')[0],
        photoURL: userData?.photoURL || user.photoURL || AVATAR_PLACEHOLDER
    };
    localStorage.setItem('lib_user', JSON.stringify(cacheData));
};

const getCachedUser = () => {
    try {
        const cached = localStorage.getItem('lib_user');
        return cached ? JSON.parse(cached) : null;
    } catch { return null; }
};

const applyMainNavActiveState = () => {
    const navLinks = document.querySelectorAll('#site-navbar a[href]');
    const currentPath = window.location.pathname;
    const pageName = currentPath.split('/').pop() || 'index.html';

    navLinks.forEach((link) => {
        const href = link.getAttribute('href');
        if (!href || href.startsWith('http')) return;
        const isIndex = href === 'index.html' || href === './';
        const isActive = isIndex ? (pageName === 'index.html' || pageName === '') : href.includes(pageName);

        if (isActive) {
            link.classList.add('text-primary-600', 'border-b-2', 'border-primary-600');
            link.classList.remove('text-slate-500');
        } else {
            link.classList.remove('text-primary-600', 'border-b-2', 'border-primary-600');
            link.classList.add('text-slate-500');
        }
    });
};

const initPasswordToggle = () => {
    document.querySelectorAll('[id^="togglePassword"]').forEach(btn => {
        btn.onclick = () => {
            const input = btn.parentElement.querySelector('input');
            if (input) {
                const isPassword = input.type === 'password';
                input.type = isPassword ? 'text' : 'password';
                const icon = btn.querySelector('i');
                if (icon) icon.className = isPassword ? 'ph ph-eye' : 'ph ph-eye-slash';
            }
        };
    });
};

const renderAuthUI = (userLike) => {
    const slot = document.querySelector('[data-auth-slot]');
    if (!slot) return;

    if (userLike) {
        const avatarUrl = userLike.photoURL || AVATAR_PLACEHOLDER;
        slot.innerHTML = `
            <div class="flex items-center gap-3">
                <div class="text-right hidden lg:block">
                    <p class="text-sm font-bold text-slate-800">${userLike.displayName}</p>
                    <p class="text-[10px] text-slate-500 uppercase font-bold">${userLike.role === 'admin' ? 'Quản trị' : 'Độc giả'}</p>
                </div>
                <div class="relative group">
                    <button class="w-10 h-10 rounded-xl overflow-hidden border-2 border-white shadow-sm">
                        <img src="${avatarUrl}" onerror="this.src='${AVATAR_PLACEHOLDER}'" class="w-full h-full object-cover">
                    </button>
                    <div class="absolute right-0 mt-2 w-48 bg-white rounded-2xl shadow-xl border border-slate-100 py-2 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                        ${userLike.role === 'admin' ? `<a href="../admin/admin.html" class="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 font-medium">Quản trị</a>` : ''}
                        <a href="borrow-history.html" class="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 font-medium">Lịch sử mượn</a>
                        <hr class="my-2 border-slate-100">
                        <button id="logoutBtn" class="w-full text-left px-4 py-2 text-sm text-rose-600 font-bold hover:bg-rose-50">Đăng xuất</button>
                    </div>
                </div>
            </div>`;
        document.getElementById('logoutBtn')?.addEventListener('click', signOutUser);
    } else {
        slot.innerHTML = `
            <a href="login.html" class="text-slate-600 font-bold text-sm hover:text-primary-600 transition-colors">Đăng nhập</a>
            <a href="register.html" class="px-5 py-2.5 bg-primary-600 text-white font-bold text-sm rounded-xl shadow-lg hover:bg-primary-700 transition-all">Đăng ký</a>
        `;
    }
};

const getLoginUrl = () => window.location.pathname.includes('/admin/') ? '../user/login.html' : 'login.html';
const getIndexUrl = () => window.location.pathname.includes('/admin/') ? '../user/index.html' : 'index.html';

const navigateToTarget = (role) => {
    const isAuthPage = window.location.pathname.includes('login.html') || window.location.pathname.includes('register.html');
    if (!isAuthPage) return;
    window.location.replace(role === 'admin' ? '../admin/admin.html' : 'index.html');
};

export const signIn = async (email, password) => {
    try {
        const res = await signInWithEmailAndPassword(auth, email, password);
        const userDoc = await getDoc(doc(db, "users", res.user.uid));
        if (userDoc.exists()) {
            saveUserCache(res.user, userDoc.data());
            showToast(`Chào mừng ${userDoc.data().displayName || 'bạn'} trở lại! ✨`);
            setTimeout(() => navigateToTarget(userDoc.data().role), 800);
        }
    } catch (e) { showToast("Email hoặc mật khẩu không chính xác!", "error"); }
};

export const signUp = async (email, password, displayName) => {
    try {
        const res = await createUserWithEmailAndPassword(auth, email, password);
        const userData = { email, displayName, role: 'user', status: 'active', createdAt: serverTimestamp() };
        await setDoc(doc(db, "users", res.user.uid), userData);
        saveUserCache(res.user, userData);
        showToast('Tạo tài khoản thành công! 🚀');
        setTimeout(() => window.location.replace('index.html'), 1000);
    } catch (e) { showToast("Lỗi đăng ký: " + e.message, "error"); }
};

export const signInWithGoogle = async () => {
    try {
        const result = await signInWithPopup(auth, googleProvider);
        const userRef = doc(db, "users", result.user.uid);
        const userDoc = await getDoc(userRef);
        let userData = userDoc.exists() ? userDoc.data() : { 
            email: result.user.email, displayName: result.user.displayName, photoURL: result.user.photoURL, 
            role: 'user', status: 'active', createdAt: serverTimestamp() 
        };
        if (!userDoc.exists()) await setDoc(userRef, userData);
        saveUserCache(result.user, userData);
        showToast(`Đăng nhập Google thành công! Chào ${userData.displayName} 👋`);
        setTimeout(() => navigateToTarget(userData.role), 800);
    } catch (e) { console.error("Google Auth Error", e); }
};

export const signOutUser = async () => {
    const ok = await showConfirm('Xác nhận đăng xuất?', { type: 'warning' });
    if (!ok) return;
    localStorage.removeItem('lib_user');
    await signOut(auth);
    showToast('Hẹn gặp lại bạn nhé! 👋');
    setTimeout(() => {
        window.location.replace(getLoginUrl());
    }, 800);
};

const initAuth = () => {
    applyMainNavActiveState();
    renderAuthUI(getCachedUser());
    initFavoriteFeature();
    initPasswordToggle();

    onAuthStateChanged(auth, async (user) => {
        if (user) {
            const userDoc = await getDoc(doc(db, "users", user.uid));
            if (userDoc.exists()) {
                const userData = userDoc.data();
                saveUserCache(user, userData);
                renderAuthUI(getCachedUser());
            }
        } else {
            renderAuthUI(null);
        }
    });

    document.getElementById('googleLoginBtn')?.addEventListener('click', (e) => { e.preventDefault(); signInWithGoogle(); });
    document.getElementById('googleRegisterBtn')?.addEventListener('click', (e) => { e.preventDefault(); signInWithGoogle(); });

    const lForm = document.getElementById('authForm');
    if (lForm) {
        lForm.onsubmit = (e) => {
            e.preventDefault();
            signIn(document.getElementById('email').value, document.getElementById('password').value);
        };
    }

    const rForm = document.getElementById('registerForm');
    if (rForm) {
        rForm.onsubmit = (e) => {
            e.preventDefault();
            signUp(document.getElementById('email').value, document.getElementById('password').value, document.getElementById('fullname').value);
        };
    }
};

document.addEventListener('DOMContentLoaded', initAuth);
document.addEventListener('turbo:load', initAuth);

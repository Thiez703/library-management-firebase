import { auth, db } from './firebase-config.js';
import { signOut, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-auth.js";
import { doc, setDoc, getDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

const googleProvider = new GoogleAuthProvider();
const getAuthSlot = () => document.querySelector('[data-auth-slot]');

// --- LOGIC THANH ĐIỀU HƯỚNG (NAVBAR) ---
const applyMainNavActiveState = () => {
    const navLinks = document.querySelectorAll('#site-navbar a[href]');
    if (!navLinks.length) return;

    const currentPath = window.location.pathname;
    
    navLinks.forEach((link) => {
        const href = link.getAttribute('href');
        if (!href || href.startsWith('http') || href.startsWith('#')) return;

        // Xử lý so khớp đường dẫn chính xác hơn
        const isIndex = href === 'index.html' || href === './' || href === '';
        const isActive = isIndex 
            ? (currentPath.endsWith('/') || currentPath.endsWith('index.html'))
            : currentPath.endsWith(href);

        if (isActive) {
            link.classList.add('text-primary-600', 'border-b-2', 'border-primary-600');
            link.classList.remove('text-slate-500');
        } else {
            link.classList.remove('text-primary-600', 'border-b-2', 'border-primary-600');
            link.classList.add('text-slate-500');
        }
    });
};

// --- THÔNG BÁO (TOAST) ---
export const showToast = (message, type = 'success') => {
    let toast = document.getElementById('auth-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'auth-toast';
        document.body.appendChild(toast);
    }
    const bgColor = type === 'success' ? '#10b981' : '#f43f5e';
    toast.style.cssText = `position: fixed; top: 24px; right: 24px; background: ${bgColor}; color: white; padding: 16px 24px; border-radius: 12px; z-index: 99999; font-family: 'Inter', sans-serif; font-weight: 600; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1); transition: all 0.4s; opacity: 1; display: flex; align-items: center; gap: 12px;`;
    toast.innerHTML = `<span>${type === 'success' ? '✨' : '⚠️'}</span> <span>${message}</span>`;
    
    setTimeout(() => { toast.style.opacity = '0'; }, 3000);
    setTimeout(() => { if (toast.parentNode) toast.style.display = 'none'; }, 3400);
    toast.style.display = 'flex';
};

// --- LOGIC TÀI KHOẢN ---
export const checkAuthState = (callback) => {
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            const userDoc = await getDoc(doc(db, "users", user.uid));
            let userData = null;
            if (userDoc.exists()) {
                userData = userDoc.data();
                saveUserCache(user, userData);
            }
            if (callback) callback(user, userData);
        } else {
            localStorage.removeItem('lib_user');
            if (callback) callback(null, null);
        }
    });
};

const getCachedUser = () => {
    const cached = localStorage.getItem('lib_user');
    try { return cached ? JSON.parse(cached) : null; } catch { return null; }
};

const saveUserCache = (user, userData) => {
    if (!user) return;
    const cacheData = {
        uid: user.uid,
        email: user.email,
        displayName: userData?.displayName || user.displayName || user.email,
        photoURL: userData?.photoURL || user.photoURL,
        role: userData?.role || 'user'
    };
    localStorage.setItem('lib_user', JSON.stringify(cacheData));
};

const renderAuthUI = (userLike) => {
    const slot = getAuthSlot();
    if (!slot) return;

    if (userLike) {
        const avatarUrl = userLike.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(userLike.displayName)}&background=random`;
        slot.innerHTML = `
            <div class="flex items-center gap-3">
                <div class="text-right hidden lg:block">
                    <p class="text-sm font-bold text-slate-800 truncate max-w-[150px]">${userLike.displayName}</p>
                    <p class="text-[10px] text-slate-500 uppercase font-bold tracking-tight">${userLike.role === 'admin' ? 'Quản trị viên' : 'Độc giả'}</p>
                </div>
                <div class="relative group">
                    <button class="w-10 h-10 rounded-xl border-2 border-white shadow-sm overflow-hidden focus:ring-2 focus:ring-primary-500/20 transition-all">
                        <img src="${avatarUrl}" class="w-full h-full object-cover">
                    </button>
                    <div class="absolute right-0 mt-2 w-48 bg-white rounded-2xl shadow-xl border border-slate-100 py-2 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                        ${userLike.role === 'admin' ? `<a href="../admin/admin.html" class="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 font-medium"><i class="ph ph-layout mr-2"></i>Quản trị</a>` : ''}
                        <a href="borrow-history.html" class="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 font-medium"><i class="ph ph-clock-counter-clockwise mr-2"></i>Lịch sử mượn</a>
                        <hr class="my-2 border-slate-100">
                        <button id="logoutBtn" class="w-full text-left px-4 py-2 text-sm text-rose-600 hover:bg-rose-50 font-bold transition-colors">
                            <i class="ph ph-sign-out mr-2"></i>Đăng xuất
                        </button>
                    </div>
                </div>
            </div>`;
        document.getElementById('logoutBtn')?.addEventListener('click', signOutUser);
    } else {
        slot.innerHTML = `
            <a href="login.html" class="text-slate-600 font-bold text-sm hover:text-primary-600 transition-colors">Đăng nhập</a>
            <a href="register.html" class="px-5 py-2.5 bg-primary-600 text-white font-bold text-sm rounded-xl shadow-lg shadow-primary-500/20 hover:bg-primary-700 transition-all active:scale-95">Đăng ký</a>
        `;
    }
};

export const signInWithGoogle = async () => {
    try {
        const result = await signInWithPopup(auth, googleProvider);
        const userDoc = await getDoc(doc(db, "users", result.user.uid));
        let userData = userDoc.exists() ? userDoc.data() : { email: result.user.email, displayName: result.user.displayName, photoURL: result.user.photoURL, role: 'user', status: 'active', createdAt: serverTimestamp() };
        if (!userDoc.exists()) await setDoc(doc(db, "users", result.user.uid), userData);
        saveUserCache(result.user, userData);
        showToast('Chào mừng ' + userData.displayName + '! ✨');
        setTimeout(() => {
            window.location.href = userData.role === 'admin' ? '../admin/admin.html' : 'index.html';
        }, 1000);
    } catch (e) { 
        showToast("Lỗi đăng nhập Google", "error"); 
    }
};

export const signIn = async (email, password) => {
    try {
        const res = await signInWithEmailAndPassword(auth, email, password);
        const userDoc = await getDoc(doc(db, "users", res.user.uid));
        if (userDoc.exists()) {
            const userData = userDoc.data();
            saveUserCache(res.user, userData);
            showToast('Đăng nhập thành công! ✨');
            setTimeout(() => {
                window.location.href = userData.role === 'admin' ? '../admin/admin.html' : 'index.html';
            }, 1000);
        }
    } catch (e) { 
        showToast("Email hoặc mật khẩu không đúng!", "error"); 
    }
};

export const signUp = async (email, password, displayName) => {
    try {
        const res = await createUserWithEmailAndPassword(auth, email, password);
        const userData = { email, displayName, role: 'user', status: 'active', createdAt: serverTimestamp() };
        await setDoc(doc(db, "users", res.user.uid), userData);
        saveUserCache(res.user, userData);
        showToast('Đăng ký thành công! 🚀');
        setTimeout(() => {
            window.location.href = 'index.html';
        }, 1500);
    } catch (e) { 
        showToast("Lỗi đăng ký tài khoản!", "error"); 
    }
};

export const signOutUser = async () => {
    if(!confirm("Bạn muốn đăng xuất?")) return;
    localStorage.removeItem('lib_user');
    await signOut(auth);
    showToast('Hẹn gặp lại bạn nhé! 👋');
    setTimeout(() => {
        window.location.href = 'login.html';
    }, 1000);
};

// --- KHỞI TẠO ---
const initAuth = () => {
    applyMainNavActiveState();
    renderAuthUI(getCachedUser());

    // Password Toggle Logic
    const togglePasswordBtn = document.getElementById('togglePassword');
    const passwordInput = document.getElementById('password');
    if (togglePasswordBtn && passwordInput) {
        togglePasswordBtn.addEventListener('click', () => {
            const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
            passwordInput.setAttribute('type', type);
            
            const icon = togglePasswordBtn.querySelector('i');
            if (icon) {
                icon.classList.toggle('ph-eye');
                icon.classList.toggle('ph-eye-slash');
            }
        });
    }

    const lForm = document.getElementById('authForm');
    if (lForm) lForm.onsubmit = (e) => { e.preventDefault(); signIn(document.getElementById('email').value, document.getElementById('password').value); };

    const rForm = document.getElementById('registerForm');
    if (rForm) rForm.onsubmit = (e) => { e.preventDefault(); signUp(document.getElementById('email').value, document.getElementById('password').value, document.getElementById('fullname').value); };

    // Google Login/Register Buttons
    document.getElementById('googleLoginBtn')?.addEventListener('click', (e) => { e.preventDefault(); signInWithGoogle(); });
    document.getElementById('googleRegisterBtn')?.addEventListener('click', (e) => { e.preventDefault(); signInWithGoogle(); });

    onAuthStateChanged(auth, async (user) => {
        if (user) {
            const userDoc = await getDoc(doc(db, "users", user.uid));
            if (userDoc.exists()) {
                saveUserCache(user, userDoc.data());
                renderAuthUI(getCachedUser());
            }
        } else {
            localStorage.removeItem('lib_user');
            renderAuthUI(null);
        }
    });
};

document.addEventListener('turbo:load', initAuth);
document.addEventListener('turbo:render', initAuth);
if (document.readyState !== 'loading') initAuth();
else document.addEventListener('DOMContentLoaded', initAuth);

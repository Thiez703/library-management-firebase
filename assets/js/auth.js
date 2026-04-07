import { 
    auth, 
    db 
} from './firebase-config.js';
import { 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword, 
    signOut, 
    onAuthStateChanged,
    GoogleAuthProvider,
    signInWithPopup
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-auth.js";
import { 
    doc, 
    setDoc, 
    getDoc, 
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

const googleProvider = new GoogleAuthProvider();

// --- TOAST NOTIFICATION ---
export const showToast = (message, type = 'success') => {
    let toast = document.getElementById('auth-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'auth-toast';
        document.body.appendChild(toast);
    }
    const bgColor = type === 'success' ? '#10b981' : '#f43f5e';
    toast.style.cssText = `position:fixed; top:20px; right:20px; background:${bgColor}; color:white; padding:12px 24px; border-radius:8px; z-index:10000; font-family:sans-serif; font-weight:bold; transition:all 0.3s; box-shadow:0 4px 12px rgba(0,0,0,0.15); opacity:1;`;
    toast.innerText = message;
    setTimeout(() => { toast.style.opacity = '0'; }, 3000);
};

// --- HÀM KIỂM TRA TRẠNG THÁI ---
export const checkAuthState = (callback) => {
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            try {
                const userDoc = await getDoc(doc(db, "users", user.uid));
                const userData = userDoc.exists() ? userDoc.data() : null;
                callback(user, userData);
            } catch (error) {
                console.error("Lỗi lấy thông tin user:", error);
                callback(user, null);
            }
        } else {
            callback(null, null);
        }
    });
};

// --- LOGIC CẬP NHẬT GIAO DIỆN NAVBAR ---
const updateNavbarUI = (user, userData) => {
    const authContainer = document.querySelector('.hidden.sm\\:flex.items-center.gap-3');
    if (user && authContainer) {
        authContainer.innerHTML = `
            <div class="flex items-center gap-3">
                <div class="text-right hidden md:block">
                    <p class="text-xs text-slate-500 font-medium">Xin chào,</p>
                    <p class="text-sm font-bold text-slate-900">${userData?.displayName || user.email}</p>
                </div>
                <div class="relative group">
                    <button class="w-10 h-10 rounded-full bg-primary-100 text-primary-600 flex items-center justify-center border-2 border-white shadow-sm overflow-hidden">
                        <img src="https://ui-avatars.com/api/?name=${userData?.displayName || user.email}&background=0D8ABC&color=fff" alt="Avatar">
                    </button>
                    <!-- Dropdown -->
                    <div class="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-xl border border-slate-100 py-2 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-[100]">
                        <a href="borrow-history.html" class="flex items-center gap-2 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors">
                            <i class="ph ph-clock-counter-clockwise"></i> Lịch sử mượn
                        </a>
                        <div class="h-px bg-slate-100 my-1"></div>
                        <button id="logoutBtnHeader" class="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors">
                            <i class="ph ph-sign-out"></i> Đăng xuất
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.getElementById('logoutBtnHeader')?.addEventListener('click', (e) => {
            e.preventDefault();
            signOutUser();
        });
    }
};

// --- LOGIC ĐIỀU HƯỚNG ---
const handleRouting = async (user) => {
    const path = window.location.pathname;
    const isAuthPage = path.includes('login.html') || path.includes('register.html');

    if (user) {
        console.log("👤 Đã đăng nhập:", user.email);
        try {
            const userDoc = await getDoc(doc(db, "users", user.uid));
            const userData = userDoc.exists() ? userDoc.data() : null;
            
            // Cập nhật giao diện nếu có container
            updateNavbarUI(user, userData);

            if (isAuthPage) {
                const role = userData?.role || 'user';
                const root = path.includes('/library-management-firebase/') ? '/library-management-firebase/' : '/';
                window.location.href = root + (role === 'admin' ? 'admin/admin.html' : 'user/index.html');
            }
        } catch (e) {
            console.error("❌ Lỗi Firestore:", e);
        }
    } else {
        if (!isAuthPage) {
            const publicPages = ['about.html', 'rules.html', 'catalog.html', 'index.html', 'book-detail.html'];
            const isPublicPage = publicPages.some(page => path.includes(page));

            if (!isPublicPage) {
                console.log("🔒 Chưa đăng nhập -> Chuyển về Login");
                const root = path.includes('/library-management-firebase/') ? '/library-management-firebase/' : '/';
                window.location.href = root + 'user/login.html';
            }
        }
    }
};

// --- ACTIONS ---
export const signInWithGoogle = async () => {
    try {
        const result = await signInWithPopup(auth, googleProvider);
        const user = result.user;
        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (!userDoc.exists()) {
            await setDoc(doc(db, "users", user.uid), {
                email: user.email,
                displayName: user.displayName,
                photoURL: user.photoURL,
                role: 'user',
                status: 'active',
                createdAt: serverTimestamp()
            });
        }
        showToast('👋 Đăng nhập Google thành công!');
    } catch (e) {
        console.error("Lỗi Google Auth:", e);
        if (e.code !== 'auth/popup-closed-by-user') {
            showToast('Lỗi đăng nhập Google!', 'error');
        }
    }
};

export const signUp = async (email, password, data) => {
    try {
        const res = await createUserWithEmailAndPassword(auth, email, password);
        await setDoc(doc(db, "users", res.user.uid), {
            email, role: 'user', status: 'active', createdAt: serverTimestamp(), ...data
        });
        showToast('🚀 Đăng ký thành công!');
    } catch (e) {
        showToast('Lỗi: ' + e.code, 'error');
    }
};

export const signIn = async (email, password) => {
    try {
        await signInWithEmailAndPassword(auth, email, password);
        showToast('👋 Đăng nhập thành công!');
    } catch (e) {
        showToast('Sai Email hoặc Mật khẩu!', 'error');
    }
};

export const signOutUser = async () => {
    await signOut(auth);
    const root = window.location.pathname.includes('/library-management-firebase/') ? '/library-management-firebase/' : '/';
    window.location.href = root + 'user/login.html';
};

// --- KHỞI TẠO ---
document.addEventListener('DOMContentLoaded', () => {
    const lForm = document.getElementById('authForm');
    if (lForm) lForm.addEventListener('submit', e => {
        e.preventDefault();
        signIn(document.getElementById('email').value, document.getElementById('password').value);
    });

    const rForm = document.getElementById('registerForm');
    if (rForm) rForm.addEventListener('submit', e => {
        e.preventDefault();
        signUp(document.getElementById('email').value, document.getElementById('password').value, { 
            displayName: document.getElementById('fullname').value 
        });
    });

    const loBtn = document.getElementById('logoutBtn');
    if (loBtn) loBtn.addEventListener('click', e => { e.preventDefault(); signOutUser(); });

    const googleBtn = document.getElementById('googleLoginBtn');
    if (googleBtn) googleBtn.addEventListener('click', e => { e.preventDefault(); signInWithGoogle(); });

    onAuthStateChanged(auth, handleRouting);
});

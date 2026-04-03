import { 
    auth, 
    db 
} from './firebase-config.js';
import { 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword, 
    signOut, 
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-auth.js";
import { 
    doc, 
    setDoc, 
    getDoc, 
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

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

// --- HÀM KIỂM TRA TRẠNG THÁI (MỚI BỔ SUNG) ---
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

// --- LOGIC ĐIỀU HƯỚNG ---
const handleRouting = async (user) => {
    const path = window.location.pathname;
    const isAuthPage = path.includes('login.html') || path.includes('register.html');

    if (!user) {
        if (!isAuthPage) {
            console.log("🔒 Chưa đăng nhập -> Chuyển về Login");
            const root = path.includes('/library-management-firebase/') ? '/library-management-firebase/' : '/';
            window.location.href = root + 'user/login.html';
        }
    } else {
        try {
            console.log("👤 Đã đăng nhập:", user.email);
            const userDoc = await getDoc(doc(db, "users", user.uid));
            const role = userDoc.exists() ? userDoc.data().role : 'user';

            if (isAuthPage) {
                console.log("🚀 Đang vào hệ thống với quyền:", role);
                const root = path.includes('/library-management-firebase/') ? '/library-management-firebase/' : '/';
                window.location.href = root + (role === 'admin' ? 'admin/admin.html' : 'user/index.html');
            }
        } catch (e) {
            console.error("❌ Lỗi Firestore:", e);
        }
    }
};

// --- ACTIONS ---
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

    onAuthStateChanged(auth, handleRouting);
});

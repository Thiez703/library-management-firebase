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

// --- HELPER: VIỆT HÓA LỖI THÂN THIỆN ---
const getErrorMessage = (errorCode) => {
    switch (errorCode) {
        case 'auth/email-already-in-use':
            return 'Email này đã có người sử dụng rồi bạn ơi! Bạn thử dùng email khác hoặc đăng nhập nhé.';
        case 'auth/invalid-email':
            return 'Địa chỉ email này có vẻ không đúng định dạng rồi, bạn kiểm tra lại giúp mình nha.';
        case 'auth/weak-password':
            return 'Mật khẩu hơi ngắn nè, bạn hãy đặt từ 6 ký tự trở lên để bảo mật hơn nhé.';
        case 'auth/user-disabled':
            return 'Tài khoản này hiện đang bị tạm khóa. Bạn vui lòng liên hệ quản trị viên nha.';
        case 'auth/user-not-found':
        case 'auth/wrong-password':
        case 'auth/invalid-credential':
            return 'Hình như email hoặc mật khẩu chưa đúng rồi, bạn kiểm tra lại một chút nhé.';
        case 'auth/popup-closed-by-user':
            return 'Bạn vừa đóng cửa sổ đăng nhập mất rồi, thử lại nhé!';
        case 'auth/network-request-failed':
            return 'Kết nối mạng không ổn định, bạn kiểm tra lại wifi/4G rồi thử lại nha.';
        case 'auth/too-many-requests':
            return 'Bạn thao tác nhanh quá! Đợi một lát rồi thử lại giúp mình nhé.';
        default:
            return 'Ôi, có lỗi nhỏ xảy ra rồi. Bạn thử lại sau vài giây hoặc báo cho mình biết nha.';
    }
};

// --- HELPER: LƯU CACHE TINH GỌN ---
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

// --- TOAST NOTIFICATION ---
export const showToast = (message, type = 'success') => {
    let toast = document.getElementById('auth-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'auth-toast';
        document.body.appendChild(toast);
    }
    
    const bgColor = type === 'success' ? '#10b981' : '#f43f5e';
    toast.style.cssText = `
        position: fixed; 
        top: 24px; 
        right: 24px; 
        background: ${bgColor}; 
        color: white; 
        padding: 16px 24px; 
        border-radius: 12px; 
        z-index: 99999; 
        font-family: 'Inter', sans-serif; 
        font-weight: 600; 
        box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
        transform: translateY(0);
        transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        opacity: 1;
        display: flex;
        align-items: center;
        gap: 12px;
    `;
    
    const icon = type === 'success' ? '✨' : '⚠️';
    toast.innerHTML = `<span style="font-size: 20px;">${icon}</span> <span>${message}</span>`;
    
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-20px)';
    }, 4000);
};

// --- LOGIC CẬP NHẬT GIAO DIỆN NAVBAR ---
const updateNavbarUI = (cachedUser) => {
    const authContainer = document.querySelector('.hidden.sm\\:flex.items-center.gap-3');
    if (cachedUser && authContainer) {
        const name = cachedUser.displayName;
        authContainer.innerHTML = `
            <div class="flex items-center gap-3">
                <div class="text-right hidden md:block">
                    <p class="text-xs text-slate-500 font-medium">Chào mừng bạn,</p>
                    <p class="text-sm font-bold text-slate-900">${name}</p>
                </div>
                <div class="relative group">
                    <button class="w-10 h-10 rounded-full bg-primary-100 text-primary-600 flex items-center justify-center border-2 border-white shadow-sm overflow-hidden">
                        <img src="https://ui-avatars.com/api/?name=${name}&background=0D8ABC&color=fff" alt="Avatar">
                    </button>
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
    const root = path.includes('/library-management-firebase/') ? '/library-management-firebase/' : '/';

    if (user) {
        const cached = localStorage.getItem('lib_user');
        if (cached) updateNavbarUI(JSON.parse(cached));
        else updateNavbarUI({ displayName: user.displayName || user.email });

        try {
            const userDoc = await getDoc(doc(db, "users", user.uid));
            if (userDoc.exists()) {
                const userData = userDoc.data();
                saveUserCache(user, userData);
                updateNavbarUI(JSON.parse(localStorage.getItem('lib_user')));
                
                if (isAuthPage) {
                    setTimeout(() => {
                        window.location.href = root + (userData.role === 'admin' ? 'admin/admin.html' : 'user/index.html');
                    }, 1000);
                }
            }
        } catch (e) {
            console.error("❌ Lỗi Firestore:", e);
        }
    } else {
        localStorage.removeItem('lib_user');
        if (!isAuthPage) {
            const publicPages = ['about.html', 'rules.html', 'catalog.html', 'index.html', 'book-detail.html'];
            const isPublicPage = publicPages.some(page => path.includes(page));
            if (!isPublicPage) window.location.href = root + 'user/login.html';
        }
    }
};

// --- ACTIONS ---
export const signInWithGoogle = async () => {
    try {
        const result = await signInWithPopup(auth, googleProvider);
        const user = result.user;
        const userDoc = await getDoc(doc(db, "users", user.uid));
        let userData;
        
        if (!userDoc.exists()) {
            userData = {
                email: user.email,
                displayName: user.displayName,
                photoURL: user.photoURL,
                role: 'user',
                status: 'active',
                createdAt: serverTimestamp()
            };
            await setDoc(doc(db, "users", user.uid), userData);
        } else {
            userData = userDoc.data();
        }

        saveUserCache(user, userData);
        showToast('Tuyệt quá! Chào mừng ' + userData.displayName + ' đã quay trở lại nhé! ✨');
        
        const root = window.location.pathname.includes('/library-management-firebase/') ? '/library-management-firebase/' : '/';
        setTimeout(() => {
            window.location.href = root + (userData.role === 'admin' ? 'admin/admin.html' : 'user/index.html');
        }, 1500);
        
    } catch (e) {
        showToast(getErrorMessage(e.code), 'error');
    }
};

export const signUp = async (email, password, data) => {
    if (!email || !password || !data.displayName) {
        showToast('Bạn đừng quên nhập đầy đủ thông tin để mình đăng ký tài khoản nha!', 'error');
        return;
    }
    try {
        const res = await createUserWithEmailAndPassword(auth, email, password);
        const userData = { email, role: 'user', status: 'active', createdAt: serverTimestamp(), ...data };
        await setDoc(doc(db, "users", res.user.uid), userData);
        saveUserCache(res.user, userData);
        showToast('Chúc mừng bạn đã gia nhập LibSpace thành công! Đang chuẩn bị đưa bạn vào hệ thống nha... 🚀');
        
        setTimeout(() => {
            const root = window.location.pathname.includes('/library-management-firebase/') ? '/library-management-firebase/' : '/';
            window.location.href = root + 'user/index.html';
        }, 2000);
    } catch (e) {
        showToast(getErrorMessage(e.code), 'error');
    }
};

export const signIn = async (email, password) => {
    if (!email || !password) {
        showToast('Bạn hãy nhập email và mật khẩu để mình đăng nhập cho bạn nhé!', 'error');
        return;
    }
    try {
        const res = await signInWithEmailAndPassword(auth, email, password);
        const userDoc = await getDoc(doc(db, "users", res.user.uid));
        if (userDoc.exists()) {
            const userData = userDoc.data();
            saveUserCache(res.user, userData);
            showToast('Chào mừng bạn đã quay trở lại! Để mình dẫn bạn vào kho học liệu nha. ✨');
            
            setTimeout(() => {
                const root = window.location.pathname.includes('/library-management-firebase/') ? '/library-management-firebase/' : '/';
                window.location.href = root + (userData.role === 'admin' ? 'admin/admin.html' : 'user/index.html');
            }, 1000);
        }
    } catch (e) {
        showToast(getErrorMessage(e.code), 'error');
    }
};

export const signOutUser = async () => {
    localStorage.removeItem('lib_user');
    await signOut(auth);
    showToast('Đã đăng xuất thành công. Chúc bạn có một ngày làm việc thật vui vẻ nhé! 👋');
    const root = window.location.pathname.includes('/library-management-firebase/') ? '/library-management-firebase/' : '/';
    setTimeout(() => {
        window.location.href = root + 'user/login.html';
    }, 1200);
};

// --- KHỞI TẠO ---
document.addEventListener('DOMContentLoaded', () => {
    const cachedData = localStorage.getItem('lib_user');
    if (cachedData) updateNavbarUI(JSON.parse(cachedData));

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

    const googleBtn = document.getElementById('googleLoginBtn');
    if (googleBtn) googleBtn.addEventListener('click', e => { e.preventDefault(); signInWithGoogle(); });

    const loBtn = document.getElementById('logoutBtn');
    if (loBtn) loBtn.addEventListener('click', e => { e.preventDefault(); signOutUser(); });

    // --- LOGIC ẨN/HIỆN MẬT KHẨU ---
    const togglePassword = document.getElementById('togglePassword');
    const passwordInput = document.getElementById('password');
    if (togglePassword && passwordInput) {
        togglePassword.addEventListener('click', () => {
            const isPassword = passwordInput.type === 'password';
            passwordInput.type = isPassword ? 'text' : 'password';
            
            // Thay đổi icon
            const icon = togglePassword.querySelector('i');
            if (isPassword) {
                // Đang ẩn (password) -> Chuyển sang hiện (text)
                icon.classList.replace('ph-eye-slash', 'ph-eye');
            } else {
                // Đang hiện (text) -> Chuyển sang ẩn (password)
                icon.classList.replace('ph-eye', 'ph-eye-slash');
            }
        });
    }

    onAuthStateChanged(auth, handleRouting);
});

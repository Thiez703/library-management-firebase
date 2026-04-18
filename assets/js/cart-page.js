import { db, auth } from './firebase-config.js';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-auth.js";
import { getCartItems, clearCart, removeFromCart, updateCartBadges } from './cart.js';
import { handleCheckout } from './borrow.js';
import { showToast } from './auth.js';

/**
 * Trang Giỏ mượn (Cart Page)
 * Đã chuẩn hóa ID theo cart.html thực tế.
 */

const initCartPage = () => {
    // 1. Lấy các phần tử theo đúng ID trong cart.html
    const cartList = document.getElementById('cartList');
    const cartEmpty = document.getElementById('cartEmpty');
    const checkoutForm = document.getElementById('checkoutForm');
    const checkoutLocked = document.getElementById('checkoutLocked');
    
    if (!cartList) return;

    // --- HÀM CẬP NHẬT UI ---
    
    const renderItems = () => {
        const items = getCartItems();
        
        if (items.length === 0) {
            cartList.innerHTML = '';
            if (cartEmpty) cartEmpty.classList.remove('hidden');
            return;
        }

        if (cartEmpty) cartEmpty.classList.add('hidden');
        cartList.innerHTML = items.map(item => `
            <div class="flex items-center gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-100 transition-all hover:border-primary-200">
                <img src="${item.coverUrl || '../assets/images/book-cover-placeholder-gray.svg'}" class="w-14 h-20 object-cover rounded-lg shadow-sm bg-white">
                <div class="flex-1 min-w-0">
                    <h4 class="font-bold text-slate-800 truncate text-sm">${item.title}</h4>
                    <p class="text-xs text-slate-500 truncate">${item.author}</p>
                </div>
                <button data-remove-id="${item.bookId}" class="p-2 text-rose-500 hover:bg-white rounded-xl transition-colors">
                    <i class="ph-bold ph-trash text-lg"></i>
                </button>
            </div>
        `).join('');

        // Gắn sự kiện xóa
        cartList.querySelectorAll('[data-remove-id]').forEach(btn => {
            btn.onclick = () => {
                removeFromCart(btn.getAttribute('data-remove-id'));
                renderItems();
                updateCartBadges();
            };
        });
    };

    const fillUserInfo = (userData) => {
        if (!userData) return;
        const nameInput = document.getElementById('checkoutFullName');
        const phoneInput = document.getElementById('checkoutPhone');
        const cccdInput = document.getElementById('checkoutCccd');

        if (nameInput) nameInput.value = userData.displayName || userData.fullName || '';
        if (phoneInput) phoneInput.value = userData.phone || '';
        if (cccdInput) cccdInput.value = userData.cccd || '';
    };

    // --- LOGIC XÁC THỰC ---
    
    const updateAuthStateUI = async (user) => {
        if (user) {
            // Đã đăng nhập
            if (checkoutLocked) checkoutLocked.classList.add('hidden');
            if (checkoutForm) checkoutForm.classList.remove('hidden');
            
            renderItems();

            try {
                const userDoc = await getDoc(doc(db, "users", user.uid));
                if (userDoc.exists()) fillUserInfo(userDoc.data());
            } catch (e) { console.error("Error loading user info:", e); }
        } else {
            // Chưa đăng nhập
            if (checkoutLocked) checkoutLocked.classList.remove('hidden');
            if (checkoutForm) checkoutForm.classList.add('hidden');
            renderItems(); // Vẫn cho xem giỏ nhưng không cho gửi
        }
    };

    // Khởi tạo từ cache để hiện nhanh
    const cached = localStorage.getItem('lib_user');
    if (cached) {
        updateAuthStateUI(JSON.parse(cached));
    }

    // Lắng nghe Firebase thực tế
    onAuthStateChanged(auth, updateAuthStateUI);

    // --- XỬ LÝ GỬI PHIẾU ---
    if (checkoutForm) {
        checkoutForm.onsubmit = async (e) => {
            e.preventDefault();
            
            const items = getCartItems();
            if (items.length === 0) {
                showToast("Giỏ mượn đang trống!", "error");
                return;
            }

            if (!auth.currentUser) {
                showToast("Vui lòng đăng nhập để tiếp tục!", "error");
                return;
            }

            const btn = document.getElementById('checkoutBtn');
            const originalText = btn.innerHTML;

            try {
                btn.disabled = true;
                btn.innerHTML = '<i class="ph ph-spinner animate-spin mr-2"></i> Đang xử lý...';

                const userData = {
                    uid: auth.currentUser.uid,
                    email: auth.currentUser.email,
                    userDetails: {
                        fullName: document.getElementById('checkoutFullName').value.trim(),
                        phone: document.getElementById('checkoutPhone').value.trim(),
                        cccd: document.getElementById('checkoutCccd').value.trim()
                    }
                };

                const result = await handleCheckout(userData, items);
                
                if (result) {
                    const modal = document.getElementById('checkoutSuccessModal');
                    if (modal) {
                        document.getElementById('ticketCode').textContent = result.recordId;
                        modal.classList.remove('hidden');
                        modal.classList.add('flex');
                        
                        clearCart();
                        renderItems();
                        updateCartBadges();

                        document.getElementById('closeSuccessModalBtn').onclick = () => {
                            window.location.href = 'borrow-history.html';
                        };
                    }
                }
            } catch (err) {
                showToast(err.message || "Lỗi tạo phiếu mượn", "error");
            } finally {
                btn.disabled = false;
                btn.innerHTML = originalText;
            }
        };
    }
};

// Khởi chạy
document.addEventListener('turbo:load', initCartPage);
document.addEventListener('DOMContentLoaded', initCartPage);
if (document.readyState !== 'loading') initCartPage();

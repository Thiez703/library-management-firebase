import { auth } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-auth.js";
import { getCartItems, removeFromCart, updateCartBadges } from './cart.js';
import { handleCheckout } from './borrow.js';
import { showToast } from './auth.js';
import { getUserIdentity, verifyUser, IDENTITY_ERRORS, REPUTATION_MIN_BORROW } from './identity.js';

const formatMoney = (value) => `${Number(value || 0).toLocaleString('vi-VN')} đ`;

const getElem = (id) => document.getElementById(id);

const renderCart = () => {
    const list = getElem('cartList');
    const empty = getElem('cartEmpty');
    if (!list || !empty) return;

    const items = getCartItems();

    if (items.length === 0) {
        list.innerHTML = '';
        empty.classList.remove('hidden');
        getElem('checkoutBtn')?.setAttribute('disabled', 'disabled');
        return;
    }

    empty.classList.add('hidden');
    getElem('checkoutBtn')?.removeAttribute('disabled');

    list.innerHTML = items.map((item) => `
        <div class="flex items-center gap-3 border border-slate-200 rounded-xl p-3 bg-white">
            <img src="${item.coverUrl || '../assets/images/book-cover-placeholder-gray.svg'}" onerror="this.src='../assets/images/book-cover-placeholder-gray.svg'" class="w-14 h-20 object-cover rounded-md border border-slate-200" alt="${item.title}">
            <div class="flex-1 min-w-0">
                <p class="font-semibold text-slate-800 truncate">${item.title}</p>
                <p class="text-sm text-slate-500 truncate">${item.author || 'Không rõ tác giả'}</p>
                <p class="text-xs text-slate-400">Giá tham khảo: ${formatMoney(item.price)}</p>
            </div>
            <button data-remove-id="${item.bookId}" class="p-2 text-rose-600 hover:bg-rose-50 rounded-lg">
                <i class="ph ph-trash"></i>
            </button>
        </div>
    `).join('');

    list.querySelectorAll('[data-remove-id]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-remove-id');
            removeFromCart(id);
            renderCart();
        });
    });
};

// === HIỂN THỊ UI THEO TRẠNG THÁI XÁC MINH ===

const showSection = (sectionId) => {
    ['checkoutLocked', 'verifySection', 'checkoutForm', 'reputationWarning', 'reputationBlocked'].forEach(id => {
        getElem(id)?.classList.add('hidden');
    });
    getElem(sectionId)?.classList.remove('hidden');
};

const renderVerificationUI = async (user) => {
    if (!user) {
        showSection('checkoutLocked');
        return;
    }

    const identity = await getUserIdentity(user.uid);

    if (!identity) {
        showSection('checkoutLocked');
        return;
    }

    if (!identity.isVerified) {
        // Chưa xác minh → hiện form xác minh
        showSection('verifySection');

        // Pre-fill tên từ Firebase Auth
        const nameInput = getElem('verifyFullName');
        if (nameInput && !nameInput.value) {
            nameInput.value = identity.displayName || user.displayName || '';
        }
        return;
    }

    // Đã xác minh → kiểm tra uy tín
    const score = identity.reputationScore;

    if (score < REPUTATION_MIN_BORROW) {
        // Uy tín quá thấp → chặn mượn
        showSection('reputationBlocked');
        const blockedEl = getElem('reputationScoreBlocked');
        if (blockedEl) blockedEl.textContent = score;
        return;
    }

    if (score < 50) {
        // Uy tín thấp → cảnh báo nhưng vẫn cho mượn
        const warningEl = getElem('reputationWarning');
        warningEl?.classList.remove('hidden');
        const scoreEl = getElem('reputationScoreDisplay');
        if (scoreEl) scoreEl.textContent = score;
    }

    // Hiện checkout form với thông tin readonly
    showSection('checkoutForm');

    const nameInput = getElem('checkoutFullName');
    const phoneInput = getElem('checkoutPhone');
    const repDisplay = getElem('checkoutReputation');

    if (nameInput) nameInput.value = identity.fullName || identity.displayName || '';
    if (phoneInput) phoneInput.value = identity.phone || '';
    if (repDisplay) {
        repDisplay.textContent = `${score} / 100`;
        if (score >= 80) {
            repDisplay.className = 'mt-1 text-sm font-semibold text-emerald-600';
        } else if (score >= 50) {
            repDisplay.className = 'mt-1 text-sm font-semibold text-amber-600';
        } else {
            repDisplay.className = 'mt-1 text-sm font-semibold text-rose-600';
        }
    }
};

// === BIND FORM XÁC MINH ===

const bindVerifyForm = () => {
    const form = getElem('verifyForm');
    if (!form || form.dataset.bound === '1') return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const user = auth.currentUser;
        if (!user) {
            showToast('Vui lòng đăng nhập.', 'error');
            return;
        }

        const phone = (getElem('verifyPhone')?.value || '').trim();
        const cccd = (getElem('verifyCccd')?.value || '').trim();
        const fullName = (getElem('verifyFullName')?.value || '').trim();

        if (!fullName) {
            showToast('Vui lòng nhập họ và tên.', 'error');
            return;
        }

        const btn = getElem('verifyBtn');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="ph ph-spinner text-lg animate-spin"></i> Đang xác minh...';
        }

        try {
            await verifyUser(user.uid, phone, cccd);

            // Cập nhật displayName vào user doc nếu chưa có
            const { doc: firestoreDoc, updateDoc, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js');
            const { db: fireDb } = await import('./firebase-config.js');
            await updateDoc(firestoreDoc(fireDb, 'users', user.uid), {
                displayName: fullName,
                updatedAt: serverTimestamp()
            });

            showToast('Xác minh danh tính thành công! ✅ Bạn có thể mượn sách ngay bây giờ.', 'success');

            // Cập nhật cache
            const cached = JSON.parse(localStorage.getItem('lib_user') || '{}');
            localStorage.setItem('lib_user', JSON.stringify({
                ...cached,
                isVerified: true,
                phone,
                displayName: fullName
            }));

            // Render lại UI
            await renderVerificationUI(user);
        } catch (err) {
            console.error('Verify error:', err);
            const msg = err.message || 'Không thể xác minh. Vui lòng thử lại.';
            showToast(msg, 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="ph ph-shield-check text-lg"></i> Xác minh danh tính';
            }
        }
    });

    form.dataset.bound = '1';
};

// === BIND CHECKOUT FORM ===

const bindCheckout = () => {
    const form = getElem('checkoutForm');
    if (!form || form.dataset.bound === '1') return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const user = auth.currentUser;
        if (!user) {
            showToast('Vui lòng đăng nhập trước khi gửi phiếu mượn.', 'error');
            window.location.href = 'login.html';
            return;
        }

        // handleCheckout giờ tự lấy userDetails từ Firestore
        // Không cần truyền form input nữa
        const result = await handleCheckout(
            { uid: user.uid, email: user.email },
            getCartItems()
        );

        // Xử lý error code từ handleCheckout
        if (result && result.error) {
            if (result.error === IDENTITY_ERRORS.USER_NOT_VERIFIED) {
                await renderVerificationUI(user);
            }
            return;
        }

        if (!result) return;

        // Thành công
        getElem('ticketCode') && (getElem('ticketCode').textContent = result);
        getElem('checkoutSuccessModal')?.classList.remove('hidden');
        renderCart();
    });

    form.dataset.bound = '1';
};

// === INIT ===

const initCartPage = () => {
    if (!getElem('cartPageRoot')) return;

    updateCartBadges();
    renderCart();
    bindVerifyForm();
    bindCheckout();

    getElem('closeSuccessModalBtn')?.addEventListener('click', () => {
        getElem('checkoutSuccessModal')?.classList.add('hidden');
        window.location.href = 'borrow-history.html';
    });

    onAuthStateChanged(auth, async (user) => {
        await renderVerificationUI(user);
    });
};

document.addEventListener('turbo:load', initCartPage);
document.addEventListener('turbo:render', initCartPage);
if (document.readyState !== 'loading') initCartPage();
else document.addEventListener('DOMContentLoaded', initCartPage);

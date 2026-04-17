import { auth } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-auth.js";
import { getCartItems, removeFromCart, updateCartBadges } from './cart.js';
import { handleCheckout } from './borrow.js';
import { showToast } from './auth.js';

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

        const fullName = (getElem('checkoutFullName')?.value || '').trim();
        const phone = (getElem('checkoutPhone')?.value || '').trim();
        const cccd = (getElem('checkoutCccd')?.value || '').trim();

        const recordId = await handleCheckout(
            {
                uid: user.uid,
                userDetails: { fullName, phone, cccd }
            },
            getCartItems()
        );

        if (!recordId) return;

        getElem('ticketCode') && (getElem('ticketCode').textContent = recordId);
        getElem('checkoutSuccessModal')?.classList.remove('hidden');
        form.reset();
        renderCart();
    });

    form.dataset.bound = '1';
};

const initCartPage = () => {
    if (!getElem('cartPageRoot')) return;

    updateCartBadges();
    renderCart();
    bindCheckout();

    getElem('closeSuccessModalBtn')?.addEventListener('click', () => {
        getElem('checkoutSuccessModal')?.classList.add('hidden');
        window.location.href = 'borrow-history.html';
    });

    onAuthStateChanged(auth, (user) => {
        const locked = getElem('checkoutLocked');
        const form = getElem('checkoutForm');
        if (!locked || !form) return;

        if (user) {
            locked.classList.add('hidden');
            form.classList.remove('hidden');
        } else {
            locked.classList.remove('hidden');
            form.classList.add('hidden');
        }
    });
};

document.addEventListener('turbo:load', initCartPage);
document.addEventListener('turbo:render', initCartPage);
if (document.readyState !== 'loading') initCartPage();
else document.addEventListener('DOMContentLoaded', initCartPage);

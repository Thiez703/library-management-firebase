import { showToast } from './auth.js';

export const CART_KEY = 'lib_borrow_cart_v2';
export const MAX_BOOKS_PER_TICKET = 5;

const parseCart = () => {
    try {
        const raw = localStorage.getItem(CART_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

const saveCart = (items) => {
    localStorage.setItem(CART_KEY, JSON.stringify(items));
    updateCartBadges();
};

export const getCartItems = () => parseCart();

export const clearCart = () => saveCart([]);

export const removeFromCart = (bookId) => {
    const items = parseCart().filter((item) => item.bookId !== bookId);
    saveCart(items);
    return items;
};

export const isInCart = (bookId) => parseCart().some((item) => item.bookId === bookId);

export const addToCart = (book) => {
    if (!book?.bookId) {
        return { ok: false, message: 'Sách không hợp lệ.' };
    }

    const items = parseCart();

    if (items.some((item) => item.bookId === book.bookId)) {
        return { ok: false, message: 'Sách đã có trong giỏ mượn.' };
    }

    if (items.length >= MAX_BOOKS_PER_TICKET) {
        return { ok: false, message: `Mỗi phiếu chỉ tối đa ${MAX_BOOKS_PER_TICKET} cuốn.` };
    }

    const nextItems = [
        ...items,
        {
            bookId: book.bookId,
            title: book.title || 'Không rõ tên sách',
            author: book.author || 'Không rõ tác giả',
            coverUrl: book.coverUrl || '',
            price: Number(book.price || 0) || 0
        }
    ];

    saveCart(nextItems);
    return { ok: true, message: 'Đã thêm vào giỏ mượn.' };
};

export const updateCartBadges = () => {
    const count = parseCart().length;
    document.querySelectorAll('[data-cart-count]').forEach((el) => {
        el.textContent = String(count);
    });
};

export const ensureFloatingCartButton = () => {
    let button = document.getElementById('floatingBorrowCartBtn');
    if (!button) {
        button = document.createElement('button');
        button.id = 'floatingBorrowCartBtn';
        button.type = 'button';
        button.className = 'fixed bottom-5 right-5 z-[120] w-14 h-14 rounded-full bg-primary-600 hover:bg-primary-700 text-white shadow-lg shadow-primary-500/30 flex items-center justify-center transition-transform active:scale-95';
        button.innerHTML = '<i class="ph-bold ph-books text-2xl"></i><span data-cart-count class="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-rose-500 text-white text-[11px] font-bold flex items-center justify-center border-2 border-white">0</span>';
        button.addEventListener('click', () => {
            window.location.href = 'cart.html';
        });
        document.body.appendChild(button);
    }

    updateCartBadges();
};

export const showCartActionToast = (result) => {
    showToast(result.message, result.ok ? 'success' : 'error');
};

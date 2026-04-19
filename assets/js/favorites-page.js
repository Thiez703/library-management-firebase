import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-auth.js";
import { collection, onSnapshot } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";
import { addToCart, ensureFloatingCartButton, showCartActionToast, updateCartBadges } from './cart.js';
import { initFavoriteFeature, refreshFavoriteButtons } from './favorites.js';

const FALLBACK_COVER = '../assets/images/book-cover-placeholder-gray.svg';

let unsubscribeFavorites = null;
let cartActionsBound = false;

const renderCards = (items = []) => {
    const grid = document.getElementById('favoriteGrid');
    const empty = document.getElementById('favoriteEmpty');
    const count = document.getElementById('favoriteTotalCount');
    if (!grid || !empty || !count) return;

    count.textContent = String(items.length);

    if (!items.length) {
        grid.classList.add('hidden');
        empty.classList.remove('hidden');
        return;
    }

    empty.classList.add('hidden');
    grid.classList.remove('hidden');

    grid.innerHTML = items.map((item) => {
        const coverUrl = item.coverUrl || FALLBACK_COVER;
        const title = item.title || 'Sách không rõ tên';
        const author = item.author || 'Tác giả chưa cập nhật';
        const category = item.categoryName || 'Sách';

        return `
            <article class="group flex flex-col bg-white rounded-2xl border border-slate-200 overflow-hidden hover:shadow-xl hover:border-rose-200 transition-all duration-300">
                <a href="book-detail.html?id=${item.bookId}" class="block relative aspect-[2/3] overflow-hidden bg-slate-100 p-4 flex items-center justify-center">
                    <img src="${coverUrl}" alt="${title}" onerror="this.src='../assets/images/book-cover-placeholder-gray.svg'" class="w-full h-full object-cover rounded-md shadow-sm transform group-hover:scale-105 transition-all duration-500">
                </a>
                <div class="p-4 flex flex-col flex-1">
                    <p class="text-[10px] font-bold text-primary-600 uppercase tracking-wider mb-2 line-clamp-1">${category}</p>
                    <a href="book-detail.html?id=${item.bookId}" class="font-bold text-slate-800 text-sm leading-snug mb-1 hover:text-primary-600 transition-colors line-clamp-2">${title}</a>
                    <p class="text-xs text-slate-500 mb-3 line-clamp-1">${author}</p>
                    <div class="mt-auto pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                        <button
                            type="button"
                            data-favorite-book="${item.bookId}"
                            data-book-title="${title.replace(/"/g, '&quot;')}"
                            data-book-author="${author.replace(/"/g, '&quot;')}"
                            data-book-cover="${coverUrl.replace(/"/g, '&quot;')}"
                            data-book-category="${category.replace(/"/g, '&quot;')}"
                            class="h-8 px-3 rounded-full border border-slate-300 bg-white text-slate-600 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 text-xs font-semibold flex items-center gap-1 transition-colors"
                            title="Bỏ khỏi yêu thích"
                            aria-label="Bỏ khỏi yêu thích">
                            <i class="ph ph-heart text-sm"></i>
                            <span>Yêu thích</span>
                        </button>
                        <button
                            type="button"
                            data-add-cart="${item.bookId}"
                            data-book-title="${title.replace(/"/g, '&quot;')}"
                            data-book-author="${author.replace(/"/g, '&quot;')}"
                            data-book-cover="${coverUrl.replace(/"/g, '&quot;')}"
                            class="h-8 px-3 rounded-full bg-primary-50 text-primary-700 hover:bg-primary-100 text-xs font-semibold flex items-center gap-1 transition-colors"
                            title="Thêm vào giỏ mượn">
                            <i class="ph-bold ph-plus"></i>
                            <span>Thêm giỏ</span>
                        </button>
                    </div>
                </div>
            </article>
        `;
    }).join('');

    refreshFavoriteButtons(grid);
};

const subscribeUserFavorites = (uid) => {
    if (unsubscribeFavorites) {
        unsubscribeFavorites();
        unsubscribeFavorites = null;
    }

    unsubscribeFavorites = onSnapshot(collection(db, 'users', uid, 'favorites'), (snapshot) => {
        const items = [];
        snapshot.forEach((docSnap) => {
            items.push({ bookId: docSnap.id, ...(docSnap.data() || {}) });
        });

        items.sort((a, b) => {
            const left = (a.title || '').toLowerCase();
            const right = (b.title || '').toLowerCase();
            return left.localeCompare(right, 'vi');
        });

        renderCards(items);
    });
};

const bindCartActions = () => {
    if (cartActionsBound) return;
    cartActionsBound = true;

    document.addEventListener('click', (event) => {
        const btn = event.target.closest('[data-add-cart]');
        if (!btn) return;

        event.preventDefault();

        const payload = {
            bookId: btn.getAttribute('data-add-cart') || '',
            title: btn.getAttribute('data-book-title') || '',
            author: btn.getAttribute('data-book-author') || '',
            coverUrl: btn.getAttribute('data-book-cover') || ''
        };

        const result = addToCart(payload);
        showCartActionToast(result);
    });
};

const initFavoritesPage = () => {
    const root = document.getElementById('favoritesPageRoot');
    if (!root) return;

    ensureFloatingCartButton();
    updateCartBadges();
    initFavoriteFeature();
    bindCartActions();

    onAuthStateChanged(auth, (user) => {
        if (!user) {
            if (unsubscribeFavorites) {
                unsubscribeFavorites();
                unsubscribeFavorites = null;
            }
            renderCards([]);
            const authHint = document.getElementById('favoriteAuthHint');
            if (authHint) authHint.classList.remove('hidden');
            return;
        }

        const authHint = document.getElementById('favoriteAuthHint');
        if (authHint) authHint.classList.add('hidden');
        subscribeUserFavorites(user.uid);
    });
};

document.addEventListener('turbo:load', initFavoritesPage);
document.addEventListener('turbo:render', initFavoritesPage);
if (document.readyState !== 'loading') initFavoritesPage();
else document.addEventListener('DOMContentLoaded', initFavoritesPage);

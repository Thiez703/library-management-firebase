import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-auth.js";
import { collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

const favoritesState = {
    initialized: false,
    authBound: false,
    clickBound: false,
    unsubscribeFavorites: null,
    favoriteIds: new Set()
};

const notify = (message, type = 'success') => {
    let toast = document.getElementById('favorite-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'favorite-toast';
        document.body.appendChild(toast);
    }

    const bgColor = type === 'success' ? '#10b981' : '#f43f5e';
    toast.style.cssText = `position: fixed; top: 24px; right: 24px; background: ${bgColor}; color: white; padding: 12px 18px; border-radius: 10px; z-index: 99999; font-family: 'Inter', sans-serif; font-weight: 600; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1); transition: all 0.3s; opacity: 1; display: flex; align-items: center; gap: 10px;`;
    toast.innerHTML = `<span>${type === 'success' ? '❤' : '!'}</span><span>${message}</span>`;

    setTimeout(() => { toast.style.opacity = '0'; }, 2200);
    setTimeout(() => {
        if (toast.parentNode) toast.style.display = 'none';
    }, 2600);
    toast.style.display = 'flex';
};

const getFavoriteDocRef = (uid, bookId) => doc(db, 'users', uid, 'favorites', bookId);

const updateFavoriteBadges = () => {
    const count = favoritesState.favoriteIds.size;
    document.querySelectorAll('[data-favorite-count]').forEach((el) => {
        el.textContent = String(count);
    });
};

const applyFavoriteStyle = (button) => {
    const bookId = button.getAttribute('data-favorite-book');
    if (!bookId) return;

    const active = favoritesState.favoriteIds.has(bookId);
    button.classList.toggle('text-rose-600', active);
    button.classList.toggle('bg-rose-50', active);
    button.classList.toggle('border-rose-200', active);

    button.classList.toggle('text-slate-600', !active);
    button.classList.toggle('bg-white', !active);
    button.classList.toggle('border-slate-300', !active);

    button.setAttribute('title', active ? 'Bỏ khỏi yêu thích' : 'Lưu vào yêu thích');
    button.setAttribute('aria-label', active ? 'Bỏ khỏi yêu thích' : 'Lưu vào yêu thích');

    const icon = button.querySelector('i');
    if (icon) {
        if (active) {
            icon.classList.add('ph-fill');
            icon.classList.remove('ph');
        } else {
            icon.classList.add('ph');
            icon.classList.remove('ph-fill');
        }
    }
};

export const refreshFavoriteButtons = (root = document) => {
    const scope = root && typeof root.querySelectorAll === 'function' ? root : document;
    scope.querySelectorAll('[data-favorite-book]').forEach((button) => {
        applyFavoriteStyle(button);
    });
};

const subscribeFavorites = (uid) => {
    if (favoritesState.unsubscribeFavorites) {
        favoritesState.unsubscribeFavorites();
        favoritesState.unsubscribeFavorites = null;
    }

    favoritesState.unsubscribeFavorites = onSnapshot(collection(db, 'users', uid, 'favorites'), (snapshot) => {
        const ids = new Set();
        snapshot.forEach((item) => ids.add(item.id));
        favoritesState.favoriteIds = ids;
        updateFavoriteBadges();
        refreshFavoriteButtons(document);
    });
};

const extractBookFromButton = (button) => ({
    bookId: button.getAttribute('data-favorite-book') || '',
    title: button.getAttribute('data-book-title') || 'Sách không rõ tên',
    author: button.getAttribute('data-book-author') || 'Tác giả chưa cập nhật',
    coverUrl: button.getAttribute('data-book-cover') || '',
    categoryName: button.getAttribute('data-book-category') || ''
});

const toggleFavorite = async (button) => {
    const user = auth.currentUser;
    const payload = extractBookFromButton(button);

    if (!payload.bookId) {
        notify('Thiếu mã sách để lưu yêu thích.', 'error');
        return;
    }

    if (!user) {
        notify('Vui lòng đăng nhập để lưu sách yêu thích.', 'error');
        return;
    }

    const ref = getFavoriteDocRef(user.uid, payload.bookId);
    const isActive = favoritesState.favoriteIds.has(payload.bookId);

    button.disabled = true;

    try {
        if (isActive) {
            await deleteDoc(ref);
            notify('Đã bỏ khỏi danh sách yêu thích.');
        } else {
            await setDoc(ref, {
                ...payload,
                createdAt: serverTimestamp()
            }, { merge: true });
            notify('Đã thêm vào sách yêu thích.');
        }
    } catch (err) {
        console.error('Favorite toggle error:', err);
        notify('Không thể cập nhật yêu thích. Vui lòng thử lại.', 'error');
    } finally {
        button.disabled = false;
    }
};

const bindFavoriteClicks = () => {
    if (favoritesState.clickBound) return;
    favoritesState.clickBound = true;

    document.addEventListener('click', async (event) => {
        const trigger = event.target.closest('[data-favorite-trigger]');
        if (trigger) {
            event.preventDefault();
            if (!window.location.pathname.endsWith('/favorites.html')) {
                window.location.href = 'favorites.html';
            }
            return;
        }

        const button = event.target.closest('[data-favorite-book]');
        if (!button) return;

        event.preventDefault();
        await toggleFavorite(button);
    });
};

const bindFavoriteAuth = () => {
    if (favoritesState.authBound) return;
    favoritesState.authBound = true;

    onAuthStateChanged(auth, (user) => {
        if (!user) {
            if (favoritesState.unsubscribeFavorites) {
                favoritesState.unsubscribeFavorites();
                favoritesState.unsubscribeFavorites = null;
            }
            favoritesState.favoriteIds = new Set();
            updateFavoriteBadges();
            refreshFavoriteButtons(document);
            return;
        }

        subscribeFavorites(user.uid);
    });
};

export const initFavoriteFeature = () => {
    if (favoritesState.initialized) {
        refreshFavoriteButtons(document);
        updateFavoriteBadges();
        return;
    }

    favoritesState.initialized = true;
    bindFavoriteClicks();
    bindFavoriteAuth();
    refreshFavoriteButtons(document);
    updateFavoriteBadges();
};

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-auth.js";
import { doc, getDoc, setDoc, updateDoc, arrayUnion, arrayRemove, onSnapshot } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

const favoritesState = {
    items: [],
    initialized: false
};

export const initFavoriteFeature = () => {
    onAuthStateChanged(auth, (user) => {
        if (user) {
            // Lắng nghe thay đổi danh sách yêu thích
            const userRef = doc(db, 'users', user.uid);
            onSnapshot(userRef, (docSnap) => {
                if (docSnap.exists()) {
                    favoritesState.items = docSnap.data().favorites || [];
                    updateFavoriteBadges();
                    refreshFavoriteButtons(document);
                }
            });
        } else {
            favoritesState.items = [];
            updateFavoriteBadges();
            refreshFavoriteButtons(document);
        }
    });
};

export const updateFavoriteBadges = () => {
    const count = favoritesState.items.length;
    document.querySelectorAll('[data-favorite-count]').forEach(el => {
        el.textContent = count;
    });
};

export const refreshFavoriteButtons = (container = document) => {
    container.querySelectorAll('[data-favorite-book]').forEach(btn => {
        const bookId = btn.getAttribute('data-favorite-book');
        const icon = btn.querySelector('i');
        if (favoritesState.items.includes(bookId)) {
            btn.classList.add('bg-rose-50', 'text-rose-600', 'border-rose-200');
            if (icon) {
                icon.classList.remove('ph-heart');
                icon.classList.add('ph-fill', 'ph-heart');
            }
        } else {
            btn.classList.remove('bg-rose-50', 'text-rose-600', 'border-rose-200');
            if (icon) {
                icon.classList.remove('ph-fill', 'ph-heart');
                icon.classList.add('ph-heart');
            }
        }
    });
};

import { db } from './firebase-config.js';
import { collection, onSnapshot, query, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

const initPublicBooks = () => {
    const featuredContainer = document.querySelector('[data-mock-books="featured"]');
    const newArrivalContainer = document.querySelector('[data-mock-books="new-arrival"]');
    const catalogGrid = document.querySelector('[data-mock-books="catalog-grid"]');

    // Nếu không có bất kỳ container nào thì không chạy tiếp
    if (!featuredContainer && !newArrivalContainer && !catalogGrid) return;

    console.log("Initializing Public Books...");

    const booksRef = collection(db, 'books');
    const q = query(booksRef, orderBy('createdAt', 'desc'), limit(24));

    // Lắng nghe dữ liệu thời gian thực
    onSnapshot(q, (snapshot) => {
        const books = [];
        snapshot.forEach(doc => {
            books.push({ id: doc.id, ...doc.data() });
        });

        if (featuredContainer) renderSection(featuredContainer, books.slice(0, 5), 'Top');
        if (newArrivalContainer) renderSection(newArrivalContainer, books.slice(0, 10), 'Mới');
        if (catalogGrid) {
            renderSection(catalogGrid, books, null);
            updateCatalogStats(books.length);
        }
    }, (error) => {
        console.error("Lỗi Firebase:", error);
    });
};

function renderSection(container, books, badgeType) {
    const loader = container.nextElementSibling; // Thẻ thông báo "Đang tải..."
    
    if (books.length > 0) {
        container.classList.remove('hidden');
        if (loader) loader.classList.add('hidden');
        
        container.innerHTML = books.map((book, index) => 
            createBookCardHTML(book, badgeType, index + 1)
        ).join('');
    } else {
        container.classList.add('hidden');
        if (loader) {
            loader.classList.remove('hidden');
            const msg = loader.querySelector('p');
            if (msg) msg.textContent = "Hiện chưa có sách nào trong mục này.";
        }
    }
}

function updateCatalogStats(count) {
    const statusInfo = document.getElementById('catalog-status-info');
    const pagination = document.querySelector('section > .mt-12'); 

    if (statusInfo) {
        statusInfo.innerHTML = `<span class="text-sm text-slate-500 mr-2">Đang hiển thị <strong>${count}</strong> tài liệu</span>`;
    }

    if (pagination) {
        const paginationText = pagination.querySelector('p');
        const paginationButtons = pagination.querySelector('.flex.items-center.gap-2');

        if (paginationText) {
            paginationText.innerHTML = `Hiển thị <strong>1</strong> đến <strong>${count}</strong> trong tổng số <strong>${count}</strong> kết quả`;
        }

        if (paginationButtons) {
            paginationButtons.innerHTML = `
                <button class="w-10 h-10 rounded-xl border border-slate-200 flex items-center justify-center text-slate-400 cursor-not-allowed"><i class="ph-bold ph-caret-left"></i></button>
                <button class="w-10 h-10 rounded-xl bg-primary-600 text-white font-bold shadow-md shadow-primary-500/20">1</button>
                <button class="w-10 h-10 rounded-xl border border-slate-200 flex items-center justify-center text-slate-400 cursor-not-allowed"><i class="ph-bold ph-caret-right"></i></button>
            `;
        }
        pagination.classList.toggle('hidden', count <= 12);
    }
}

function createBookCardHTML(book, badgeText, badgeValue) {
    const coverUrl = book.coverUrl || '../assets/images/book_cover_2.png';
    const categoryName = book.categoryName || 'Sách';
    const author = book.author || 'Tác giả ẩn danh';
    const rating = (Math.random() * (0.3) + 4.7).toFixed(1);

    let badgeHtml = '';
    if (badgeText === 'Top') {
        badgeHtml = `<div class="absolute top-3 right-3 z-10 px-2 py-1 bg-amber-500 text-white font-bold text-[10px] uppercase rounded border border-amber-400 flex items-center gap-1"><i class="ph-fill ph-trend-up"></i> Top ${badgeValue}</div>`;
    } else if (badgeText === 'Mới') {
        badgeHtml = `<div class="absolute top-3 left-3 z-10 px-2.5 py-1 bg-white/90 backdrop-blur-sm text-emerald-600 font-bold text-[10px] uppercase rounded-lg shadow-sm border border-emerald-100 flex items-center gap-1"><div class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div> Mới</div>`;
    } else if (book.status === 'Hết sách') {
        badgeHtml = `<div class="absolute top-3 left-3 z-10 px-2.5 py-1 bg-white/90 backdrop-blur-sm text-rose-600 font-bold text-[10px] uppercase rounded-lg shadow-sm border border-rose-100">Đã mượn hết</div>`;
    }

    return `
    <div class="group flex flex-col bg-white rounded-2xl border border-slate-200 overflow-hidden hover:shadow-xl hover:border-primary-200 transition-all duration-300">
        <a href="book-detail.html?id=${book.id}" class="block relative aspect-[2/3] overflow-hidden bg-slate-100 p-4 flex items-center justify-center">
            ${badgeHtml}
            <img src="${coverUrl}" alt="${book.title}" onerror="this.src='../assets/images/book_cover_2.png'" class="w-full h-full object-cover rounded-md book-shadow transform group-hover:scale-105 transition-all duration-500">
            <div class="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-[2px]">
                <span class="px-5 py-2.5 bg-white text-slate-900 font-bold text-sm rounded-xl shadow-lg transform translate-y-4 group-hover:translate-y-0 transition-all">Xem Chi Tiết</span>
            </div>
        </a>
        <div class="p-3 md:p-4 flex flex-col flex-1">
            <div class="text-[10px] font-bold text-primary-600 uppercase tracking-wider mb-2 line-clamp-1">${categoryName}</div>
            <a href="book-detail.html?id=${book.id}" class="font-bold text-slate-800 text-sm md:text-base leading-snug mb-1 hover:text-primary-600 transition-colors line-clamp-2">${book.title}</a>
            <p class="text-xs md:text-sm font-medium text-slate-500 mb-3">${author}</p>
            <div class="mt-auto pt-3 flex items-center justify-between border-t border-slate-100">
                <div class="flex items-center text-amber-400 text-xs md:text-sm">
                    <i class="ph-fill ph-star"></i><span class="text-slate-600 font-medium ml-1">${rating}</span>
                </div>
                <button class="w-8 h-8 rounded-full ${book.availableQuantity > 0 ? 'bg-slate-50 text-slate-600 hover:bg-primary-50 hover:text-primary-600' : 'text-slate-300 cursor-not-allowed'} flex items-center justify-center transition-colors">
                    <i class="ph-bold ${book.availableQuantity > 0 ? 'ph-plus' : 'ph-bell-slash'}"></i>
                </button>
            </div>
        </div>
    </div>`;
}

// Khởi tạo
document.addEventListener('turbo:load', initPublicBooks);
document.addEventListener('turbo:render', initPublicBooks);
if (document.readyState !== 'loading') initPublicBooks();
else document.addEventListener('DOMContentLoaded', initPublicBooks);

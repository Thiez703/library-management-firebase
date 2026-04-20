import { db } from './firebase-config.js';
import { collection, onSnapshot, query, orderBy, limit, getDocs } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";
import { loadBooksPage, searchAndFilterClientSide } from './books.js';
import { addToCart, ensureFloatingCartButton, showCartActionToast } from './cart.js';
import { initFavoriteFeature, refreshFavoriteButtons } from './favorites.js';

const escapeHtml = (str) => String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

let addToCartClickBound = false;

const initPublicBooks = () => {
    const featuredContainer = document.querySelector('[data-mock-books="featured"]');
    const newArrivalContainer = document.querySelector('[data-mock-books="new-arrival"]');
    const catalogGrid = document.querySelector('[data-mock-books="catalog-grid"]');

    if (!featuredContainer && !newArrivalContainer && !catalogGrid) return;

    console.log("Initializing Public Books...");
    ensureFloatingCartButton();
    initFavoriteFeature();

    if (featuredContainer || newArrivalContainer) {
        const skeletonHtml = Array(5).fill(`
            <div class="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm animate-pulse flex flex-col h-full opacity-60">
                <div class="aspect-[2/3] bg-slate-200"></div>
                <div class="p-4 space-y-3 flex-1 flex flex-col">
                    <div class="h-3 bg-slate-200 rounded w-1/3"></div>
                    <div class="h-4 bg-slate-200 rounded w-3/4"></div>
                </div>
            </div>
        `).join('');

        if (featuredContainer) {
            featuredContainer.innerHTML = skeletonHtml;
            featuredContainer.classList.remove('hidden');
        }
        if (newArrivalContainer) {
            newArrivalContainer.innerHTML = skeletonHtml;
            newArrivalContainer.classList.remove('hidden');
        }

        const booksRef = collection(db, 'books');
        const q = query(booksRef, orderBy('createdAt', 'desc'), limit(15));
        onSnapshot(q, (snapshot) => {
            const books = [];
            snapshot.forEach(doc => {
                books.push({ id: doc.id, ...doc.data() });
            });
            if (featuredContainer) renderSection(featuredContainer, books.slice(0, 5), 'Top');
            if (newArrivalContainer) renderSection(newArrivalContainer, books.slice(0, 10), 'Mới');
        });
    }

    if (catalogGrid) {
        initCatalog(catalogGrid);
    }
};

const initCatalog = async (catalogGrid) => {
    const searchInput = document.getElementById('catalog-search');
    const categoryList = document.getElementById('catalog-categories');
    const sortSelect = document.getElementById('catalog-sort');
    
    let currentKeyword = '';
    let currentCategoryId = '';
    let currentSortMode = sortSelect ? sortSelect.value : 'az';
    let currentPage = 1;
    let pageSize = 12;
    let allFilteredBooks = [];
    
    // 1. Fetch Danh mục động
    if (categoryList) {
        try {
            const catsSnap = await getDocs(collection(db, 'categories'));
            let html = `<li>
                <a href="#" data-id="" class="cat-link flex items-center justify-between px-3 py-2.5 bg-primary-50 text-primary-700 rounded-xl font-medium text-sm transition-colors group">
                    <span class="flex items-center gap-2.5"><i class="ph-fill ph-squares-four text-lg text-primary-500"></i> Tất cả sách</span>
                </a>
            </li>`;
            
            catsSnap.docs.forEach(doc => {
                const catName = doc.data().categoryName;
                if (!catName) return; // Bỏ qua nếu dữ liệu lỗi
                html += `<li>
                    <a href="#" data-id="${doc.id}" class="cat-link flex items-center justify-between px-3 py-2.5 text-slate-600 hover:bg-slate-50 hover:text-slate-900 rounded-xl font-medium text-sm transition-colors group">
                        <span class="flex items-center gap-2.5"><i class="ph ph-bookmark text-lg text-slate-400 group-hover:text-primary-500 transition-colors"></i> ${escapeHtml(catName)}</span>
                    </a>
                </li>`;
            });
            categoryList.innerHTML = html;

            document.querySelectorAll('.cat-link').forEach(link => {
                link.addEventListener('click', (e) => {
                    e.preventDefault();
                    document.querySelectorAll('.cat-link').forEach(l => {
                        l.classList.remove('bg-primary-50', 'text-primary-700');
                        l.classList.add('text-slate-600');
                        const icon = l.querySelector('i');
                        if (icon) {
                            icon.classList.remove('text-primary-500', 'ph-fill');
                            icon.classList.add('text-slate-400', 'ph');
                        }
                    });
                    
                    const clicked = e.currentTarget;
                    clicked.classList.remove('text-slate-600');
                    clicked.classList.add('bg-primary-50', 'text-primary-700');
                    const cIcon = clicked.querySelector('i');
                    if (cIcon) {
                        cIcon.classList.remove('text-slate-400', 'ph');
                        cIcon.classList.add('text-primary-500', 'ph-fill');
                    }
                    
                    currentCategoryId = clicked.getAttribute('data-id');
                    loadAndRenderCatalog(true);
                });
            });
        } catch(e) {}
    }

    const renderCurrentPage = () => {
        const totalBooks = allFilteredBooks.length;
        const totalPages = Math.ceil(totalBooks / pageSize);
        
        if (currentPage > totalPages) currentPage = totalPages;
        if (currentPage < 1) currentPage = 1;
        
        const startIdx = (currentPage - 1) * pageSize;
        const endIdx = startIdx + pageSize;
        const booksToRender = allFilteredBooks.slice(startIdx, endIdx);
        
        renderSection(catalogGrid, booksToRender, null);
        renderPaginationStats(totalBooks, totalPages);
    };

    const loadAndRenderCatalog = async (resetPage = true) => {
        if (resetPage) currentPage = 1;
        
        catalogGrid.innerHTML = Array(8).fill(`
            <div class="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm animate-pulse flex flex-col h-full opacity-60">
                <div class="aspect-[2/3] bg-slate-200"></div>
                <div class="p-4 space-y-3 flex-1 flex flex-col">
                    <div class="h-3 bg-slate-200 rounded w-1/3"></div>
                    <div class="h-4 bg-slate-200 rounded w-3/4"></div>
                </div>
            </div>
        `).join('');
        catalogGrid.classList.remove('hidden');

        try {
            let fetchedBooks = await searchAndFilterClientSide(currentKeyword, currentCategoryId);
            
            if (currentSortMode === 'az') {
                fetchedBooks.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
            } else if (currentSortMode === 'za') {
                fetchedBooks.sort((a, b) => (b.title || '').localeCompare(a.title || ''));
            } else if (currentSortMode === 'newest') {
                fetchedBooks.sort((a, b) => {
                    const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
                    const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
                    return timeB - timeA;
                });
            } else if (currentSortMode === 'popular') {
                fetchedBooks.sort((a, b) => (b.borrowCount || 0) - (a.borrowCount || 0));
            }
            
            allFilteredBooks = fetchedBooks;
            renderCurrentPage();
        } catch(e) {
            console.error(e);
            catalogGrid.innerHTML = '<p class="col-span-full text-center py-10 text-rose-500">Đã xảy ra lỗi khi tải dữ liệu.</p>';
        }
    };

    const renderPaginationStats = (totalCount, totalPages) => {
        const statusInfo = document.getElementById('catalog-status-info');
        const pagination = document.querySelector('section > .mt-12'); 

        if (statusInfo) {
            statusInfo.innerHTML = `<span class="text-sm text-slate-500 mr-2">Đang hiển thị <strong>${totalCount}</strong> tài liệu</span>`;
        }

        if (pagination) {
            const paginationText = pagination.querySelector('p');
            const paginationButtons = pagination.querySelector('.flex.items-center.gap-2');

            const startItem = (currentPage - 1) * pageSize + 1;
            const endItem = Math.min(currentPage * pageSize, totalCount);

            if (paginationText) {
                if (totalCount === 0) {
                     paginationText.innerHTML = `Không có kết quả nào`;
                } else {
                     paginationText.innerHTML = `Hiển thị <span class="font-medium text-slate-900">${startItem}</span> đến <span class="font-medium text-slate-900">${endItem}</span> trong tổng số <span class="font-medium text-slate-900">${totalCount}</span> kết quả`;
                }
            }

            if (paginationButtons) {
                if (totalPages <= 1) {
                    paginationButtons.innerHTML = '';
                    pagination.classList.toggle('hidden', totalCount === 0);
                    return;
                }

                let btnsHtml = `
                    <button class="btn-prev-page w-10 h-10 rounded-xl border border-slate-200 flex items-center justify-center ${currentPage === 1 ? 'text-slate-400 cursor-not-allowed' : 'text-slate-600 hover:bg-slate-50'} transition-colors" title="Trang trước">
                        <i class="ph-bold ph-caret-left"></i>
                    </button>
                `;

                for (let i = 1; i <= totalPages; i++) {
                    if (i === 1 || i === totalPages || (i >= currentPage - 1 && i <= currentPage + 1)) {
                        if (i === currentPage) {
                            btnsHtml += `<button class="btn-page w-10 h-10 rounded-xl bg-primary-600 text-white font-bold shadow-md shadow-primary-500/20" data-page="${i}">${i}</button>`;
                        } else {
                            btnsHtml += `<button class="btn-page w-10 h-10 rounded-xl bg-white border border-slate-200 text-slate-600 font-medium hover:bg-slate-50 transition-colors hidden sm:block" data-page="${i}">${i}</button>`;
                        }
                    } else if (i === currentPage - 2 || i === currentPage + 2) {
                        btnsHtml += `<span class="text-slate-400 font-medium px-2">...</span>`;
                    }
                }

                btnsHtml += `
                    <button class="btn-next-page w-10 h-10 rounded-xl border border-slate-200 flex items-center justify-center ${currentPage === totalPages ? 'text-slate-400 cursor-not-allowed' : 'text-slate-600 hover:bg-slate-50'} transition-colors" title="Trang tiếp theo">
                        <i class="ph-bold ph-caret-right"></i>
                    </button>
                `;
                paginationButtons.innerHTML = btnsHtml;

                const prevBtn = paginationButtons.querySelector('.btn-prev-page');
                const nextBtn = paginationButtons.querySelector('.btn-next-page');
                
                if (currentPage > 1) {
                    prevBtn.onclick = () => { currentPage--; renderCurrentPage(); window.scrollTo({ top: 0, behavior: 'smooth' }); };
                }
                
                if (currentPage < totalPages) {
                    nextBtn.onclick = () => { currentPage++; renderCurrentPage(); window.scrollTo({ top: 0, behavior: 'smooth' }); };
                }

                paginationButtons.querySelectorAll('.btn-page').forEach(btn => {
                    btn.onclick = (e) => {
                        const page = parseInt(e.target.getAttribute('data-page'));
                        if (page !== currentPage) {
                            currentPage = page;
                            renderCurrentPage();
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                        }
                    };
                });
            }
            pagination.classList.remove('hidden');
        }
    };

    if (searchInput) {
        let debounceTimer;
        searchInput.addEventListener('input', (e) => {
            clearTimeout(debounceTimer);
            currentKeyword = e.target.value.trim();
            debounceTimer = setTimeout(() => loadAndRenderCatalog(true), 500);
        });
    }

    if (sortSelect) {
        sortSelect.addEventListener('change', (e) => {
            currentSortMode = e.target.value;
            loadAndRenderCatalog(true);
        });
    }

    loadAndRenderCatalog(true);
};

function renderSection(container, books, badgeType) {
    const loader = container.nextElementSibling;
    if (books.length > 0) {
        container.classList.remove('hidden');
        if (loader && loader.classList.contains('text-center')) loader.classList.add('hidden');
        container.innerHTML = books.map((book, index) => createBookCardHTML(book, badgeType, index + 1)).join('');
        refreshFavoriteButtons(container);
    } else {
        container.classList.add('hidden');
        if (loader && loader.classList.contains('text-center')) {
            loader.classList.remove('hidden');
            const msg = loader.querySelector('p');
            if (msg) msg.textContent = "Không tìm thấy kết quả phù hợp.";
        }
    }
}

function createBookCardHTML(book, badgeText, badgeValue) {
    const fallbackCover = '../assets/images/book-cover-placeholder-gray.svg';
    const coverUrl = book.coverUrl || fallbackCover;
    const categoryName = book.categoryName || 'Sách';
    const author = book.author || 'Tác giả ẩn danh';
    const borrowCount = Number(book.borrowCount || 0);

    let badgeHtml = '';
    if (badgeText === 'Top') {
        badgeHtml = `<div class="absolute top-3 right-3 z-10 px-2 py-1 bg-amber-500 text-white font-bold text-[10px] uppercase rounded border border-amber-400 flex items-center gap-1"><i class="ph-fill ph-trend-up"></i> Top ${badgeValue}</div>`;
    } else if (badgeText === 'Mới') {
        badgeHtml = `<div class="absolute top-3 left-3 z-10 px-2.5 py-1 bg-white/90 backdrop-blur-sm text-emerald-600 font-bold text-[10px] uppercase rounded-lg shadow-sm border border-emerald-100 flex items-center gap-1"><div class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div> Mới</div>`;
    } else if (book.status === 'Hết sách' || book.availableQuantity <= 0) {
        badgeHtml = `<div class="absolute top-3 left-3 z-10 px-2.5 py-1 bg-white/90 backdrop-blur-sm text-rose-600 font-bold text-[10px] uppercase rounded-lg shadow-sm border border-rose-100">Đã mượn hết</div>`;
    }

    const addDisabled = book.availableQuantity <= 0;
    const addBtnClass = addDisabled
        ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
        : 'bg-primary-50 text-primary-700 hover:bg-primary-100';

    return `
    <div class="group flex flex-col bg-white rounded-2xl border border-slate-200 overflow-hidden hover:shadow-xl hover:border-primary-200 transition-all duration-300 h-full">
        <a href="book-detail.html?id=${book.id}" class="block relative aspect-[2/3] overflow-hidden bg-slate-100 p-4 flex items-center justify-center shrink-0">
            ${badgeHtml}
            <img src="${coverUrl}" alt="${escapeHtml(book.title)}" onerror="this.src='../assets/images/book-cover-placeholder-gray.svg'" class="w-full h-full object-cover rounded-md book-shadow transform group-hover:scale-105 transition-all duration-500">
            <div class="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-[2px]">
                <span class="px-5 py-2.5 bg-white text-slate-900 font-bold text-sm rounded-xl shadow-lg transform translate-y-4 group-hover:translate-y-0 transition-all">Xem Chi Tiết</span>
            </div>
        </a>
        <div class="p-3 md:p-4 flex flex-col flex-1">
            <div class="text-[10px] font-bold text-primary-600 uppercase tracking-wider mb-2 line-clamp-1">${escapeHtml(categoryName)}</div>
            <a href="book-detail.html?id=${book.id}" class="font-bold text-slate-800 text-sm md:text-base leading-snug mb-1 hover:text-primary-600 transition-colors line-clamp-2">${escapeHtml(book.title)}</a>
            <p class="text-xs md:text-sm font-medium text-slate-500 mb-3">${escapeHtml(author)}</p>
            <div class="mt-auto pt-3 flex items-center justify-between border-t border-slate-100">
                <div class="flex items-center text-slate-400 text-xs md:text-sm">
                    <i class="ph ph-books"></i><span class="text-slate-500 font-medium ml-1">${borrowCount > 0 ? borrowCount + ' lượt' : 'Chưa có'}</span>
                </div>
                <div class="flex items-center gap-2">
                    <button
                        type="button"
                        data-favorite-book="${book.id}"
                        data-book-title="${(book.title || '').replace(/"/g, '&quot;')}"
                        data-book-author="${(author || '').replace(/"/g, '&quot;')}"
                        data-book-cover="${(coverUrl || '').replace(/"/g, '&quot;')}"
                        data-book-category="${(categoryName || '').replace(/"/g, '&quot;')}"
                        class="w-8 h-8 rounded-full border border-slate-300 bg-white text-slate-600 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 flex items-center justify-center transition-colors"
                        title="Lưu vào yêu thích"
                        aria-label="Lưu vào yêu thích">
                        <i class="ph ph-heart text-sm"></i>
                    </button>
                    <button
                        data-add-cart="${book.id}"
                        data-book-title="${(book.title || '').replace(/"/g, '&quot;')}"
                        data-book-author="${(author || '').replace(/"/g, '&quot;')}"
                        data-book-cover="${(coverUrl || '').replace(/"/g, '&quot;')}"
                        data-book-price="${Number(book.price || 0)}"
                        ${addDisabled ? 'disabled' : ''}
                        class="px-3 h-8 rounded-full ${addBtnClass} flex items-center justify-center gap-1 text-xs font-semibold transition-colors"
                        title="${addDisabled ? 'Hết sách' : 'Thêm vào giỏ mượn'}">
                        <i class="ph-bold ${addDisabled ? 'ph-bell-slash' : 'ph-plus'}"></i>
                        <span>${addDisabled ? 'Hết sách' : 'Thêm giỏ'}</span>
                    </button>
                </div>
            </div>
        </div>
    </div>`;
}

const bindAddToCartClicks = () => {
    if (addToCartClickBound) return;
    addToCartClickBound = true;

    document.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-add-cart]');
        if (!btn) return;
        if (btn.disabled) return;

        const payload = {
            bookId: btn.getAttribute('data-add-cart'),
            title: btn.getAttribute('data-book-title') || '',
            author: btn.getAttribute('data-book-author') || '',
            coverUrl: btn.getAttribute('data-book-cover') || '',
            price: Number(btn.getAttribute('data-book-price') || 0)
        };

        const result = addToCart(payload);
        showCartActionToast(result);
    });
};

bindAddToCartClicks();

document.addEventListener('turbo:load', initPublicBooks);
document.addEventListener('turbo:render', initPublicBooks);
if (document.readyState !== 'loading') initPublicBooks();
else document.addEventListener('DOMContentLoaded', initPublicBooks);

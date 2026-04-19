import { db } from './firebase-config.js';
import { requireAdmin } from './admin-guard.js';
import { 
    collection, 
    addDoc, 
    onSnapshot, 
    updateDoc, 
    deleteDoc, 
    doc, 
    query, 
    orderBy,
    where,
    getDocs,
    limit
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";
import { showToast } from './notify.js';

// DOM Elements
const getElem = (id) => document.getElementById(id);
const categoriesContainer = getElem('categories-container');
const categoryForm = getElem('categoryForm');
const categoryModal = getElem('categoryModal');
const modalTitle = getElem('modalTitle');
const categoryIdInput = getElem('category-id');
const categoryNameInput = getElem('category-name');
const categoryDescInput = getElem('category-description');
const categoryIconInput = getElem('category-icon');
const iconBtns = document.querySelectorAll('.icon-btn');

const btnOpenAddModal = getElem('btn-open-add-modal');
const btnCloseModal = getElem('btn-close-modal');
const btnCancelModal = getElem('btn-cancel-modal');

const totalSummary = getElem('total-categories-summary');
const statTotalCategories = getElem('stat-total-categories');
const statActiveCategories = getElem('stat-active-categories');
const statTotalBooks = getElem('stat-total-books');
const statPopularCategory = getElem('stat-popular-category');
const statPopularCount = getElem('stat-popular-count');

const state = {
    categories: [],
    books: [],
    currentPage: 1,
    itemsPerPage: 6,
    search: '',
    categoryBooks: [],
    categoryBooksSearch: ''
};

const pageStartInfo = getElem('page-start-info');
const pageEndInfo = getElem('page-end-info');
const totalItemsInfo = getElem('total-items-info');
const paginationControls = getElem('pagination-controls');
const categoryBooksModal = getElem('categoryBooksModal');
const categoryBooksTitle = getElem('category-books-title');
const categoryBooksSubtitle = getElem('category-books-subtitle');
const categoryBooksList = getElem('category-books-list');
const btnCloseCategoryBooks = getElem('btn-close-category-books');
const categoryBooksSearchInput = getElem('category-books-search-input');
const categoryBooksEntities = getElem('category-books-entities');

// --- UI Helpers (Toast & Confirm) ---

const showConfirmModal = (message, onConfirm) => {
    const modal = getElem('deleteConfirmModal');
    const msgElem = getElem('confirmMessage');
    const btnConfirm = getElem('btn-confirm-delete');
    const btnCancel = getElem('btn-cancel-delete');
    if (!modal) return;
    if (message) msgElem.textContent = message;
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    const handleConfirm = () => { onConfirm(); closeConfirm(); };
    const closeConfirm = () => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        btnConfirm.removeEventListener('click', handleConfirm);
        btnCancel.removeEventListener('click', closeConfirm);
    };
    btnConfirm.addEventListener('click', handleConfirm);
    btnCancel.addEventListener('click', closeConfirm);
};

// --- Functions ---

const openModal = (isEdit = false, data = null) => {
    categoryModal.classList.remove('hidden');
    categoryModal.classList.add('flex');
    if (isEdit && data) {
        modalTitle.textContent = 'Chỉnh Sửa Thể Loại';
        categoryIdInput.value = data.id;
        categoryNameInput.value = data.categoryName;
        categoryDescInput.value = data.description || '';
        categoryIconInput.value = data.icon || 'ph-monitor';
        updateIconUI(data.icon || 'ph-monitor');
    } else {
        modalTitle.textContent = 'Thêm Thể Loại Mới';
        categoryForm.reset();
        categoryIdInput.value = '';
        categoryIconInput.value = 'ph-monitor';
        updateIconUI('ph-monitor');
    }
};

const closeModal = () => {
    categoryModal.classList.add('hidden');
    categoryModal.classList.remove('flex');
};

const updateIconUI = (selectedIcon) => {
    iconBtns.forEach(btn => {
        const icon = btn.getAttribute('data-icon');
        if (icon === selectedIcon) {
            btn.classList.add('border-primary-500', 'bg-primary-50', 'text-primary-600');
            btn.classList.remove('border-slate-200', 'text-slate-400');
        } else {
            btn.classList.remove('border-primary-500', 'bg-primary-50', 'text-primary-600');
            btn.classList.add('border-slate-200', 'text-slate-400');
        }
    });
};

const deleteCategory = async (id, name, bookCount) => {
    try {
        // Check if category has books
        if (bookCount > 0) {
            showToast(`Không thể xóa thể loại "${name}" vì vẫn còn sách thuộc thể loại này!`, "error");
            return;
        }

        // Secondary check in books collection
        const booksCol = collection(db, 'books');
        const qBooks = query(booksCol, where('categoryId', '==', id), limit(1));
        const bookSnapshot = await getDocs(qBooks);

        if (!bookSnapshot.empty) {
            showToast(`Lỗi dữ liệu: Thể loại "${name}" vẫn còn liên kết với sách!`, "error");
            return;
        }

        await deleteDoc(doc(db, 'categories', id));
        showToast(`Đã xóa thể loại "${name}" thành công!`);
    } catch (error) {
        console.error("Error deleting category:", error);
        showToast("Có lỗi xảy ra khi xóa thể loại.", "error");
    }
};

const normalizeName = (value = '') => value.toString().trim().toLowerCase();
const normalizeText = (value = '') => value
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
const escapeHtml = (value = '') => value
    .toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const getBookData = (bookDoc) => (typeof bookDoc?.data === 'function' ? bookDoc.data() : bookDoc || {});

const getFrequentEntities = (booksInCategory = [], topN = 8) => {
    const entityCounts = new Map();

    booksInCategory.forEach((bookDoc) => {
        const book = getBookData(bookDoc);
        const author = (book.author || '').toString().trim();
        const publisher = (book.publisher || '').toString().trim();

        if (author) entityCounts.set(author, (entityCounts.get(author) || 0) + 1);
        if (publisher) entityCounts.set(publisher, (entityCounts.get(publisher) || 0) + 1);
    });

    return [...entityCounts.entries()]
        .filter(([, count]) => count > 1)
        .sort((a, b) => b[1] - a[1])
        .slice(0, topN);
};

const renderCategoryBooksList = () => {
    if (!categoryBooksList) return;

    const keyword = normalizeText(state.categoryBooksSearch);
    const books = state.categoryBooks || [];

    const filteredBooks = !keyword
        ? books
        : books.filter((bookDoc) => {
            const book = getBookData(bookDoc);
            const title = normalizeText(book.title);
            const author = normalizeText(book.author);
            const publisher = normalizeText(book.publisher);
            return title.includes(keyword) || author.includes(keyword) || publisher.includes(keyword);
        });

    if (categoryBooksSubtitle) {
        categoryBooksSubtitle.textContent = `${filteredBooks.length.toLocaleString()}/${books.length.toLocaleString()} đầu sách`;
    }

    if (!filteredBooks.length) {
        categoryBooksList.innerHTML = `
            <div class="bg-white border border-slate-200 rounded-xl px-4 py-6 text-center text-sm text-slate-500">
                Không tìm thấy sách phù hợp theo từ khóa.
            </div>
        `;
        return;
    }

    const sortedBooks = [...filteredBooks].sort((a, b) => {
        const aTitle = (getBookData(a).title || '').toString();
        const bTitle = (getBookData(b).title || '').toString();
        return aTitle.localeCompare(bTitle, 'vi');
    });

    categoryBooksList.innerHTML = sortedBooks.map((bookDoc, idx) => {
        const book = getBookData(bookDoc);
        const title = escapeHtml(book.title || 'Sách chưa có tên');
        const author = escapeHtml(book.author || 'Chưa rõ tác giả');
        const publisher = escapeHtml(book.publisher || '--');
        const availableQty = Number(book.availableQuantity || 0);
        const totalQty = Number(book.totalQuantity || 0);

        return `
            <div class="bg-white border border-slate-200 rounded-xl px-4 py-3">
                <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0">
                        <p class="text-sm font-semibold text-slate-800 truncate">${idx + 1}. ${title}</p>
                        <p class="text-xs text-slate-500 mt-1">Tác giả: ${author}</p>
                        <p class="text-xs text-slate-500">NXB: ${publisher}</p>
                    </div>
                    <div class="text-right shrink-0">
                        <p class="text-xs text-slate-500">Khả dụng</p>
                        <p class="text-sm font-bold ${availableQty > 0 ? 'text-emerald-600' : 'text-rose-600'}">${availableQty}/${totalQty}</p>
                    </div>
                </div>
            </div>
        `;
    }).join('');
};

const renderPopularEntities = () => {
    if (!categoryBooksEntities) return;

    const entities = getFrequentEntities(state.categoryBooks, 8);
    if (!entities.length) {
        categoryBooksEntities.innerHTML = '<span class="text-xs text-slate-400">Chưa có thực thể lặp nhiều để gợi ý.</span>';
        return;
    }

    categoryBooksEntities.innerHTML = entities.map(([label, count]) => {
        const safeLabel = escapeHtml(label);
        return `
            <button
                type="button"
                class="entity-chip px-2.5 py-1 rounded-full text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 transition-colors"
                data-query="${safeLabel}">
                ${safeLabel} · ${count}
            </button>
        `;
    }).join('');

    categoryBooksEntities.querySelectorAll('.entity-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
            const queryText = chip.getAttribute('data-query') || '';
            state.categoryBooksSearch = queryText;
            if (categoryBooksSearchInput) categoryBooksSearchInput.value = queryText;
            renderCategoryBooksList();
        });
    });
};

const getBooksForCategory = (categoryId, categoryName) => {
    const normalizedCategoryName = normalizeName(categoryName);
    const byId = [];
    const byName = [];

    state.books.forEach((bookDoc) => {
        const book = getBookData(bookDoc);
        const currentCategoryId = (book.categoryId || '').toString().trim();
        const currentCategoryName = normalizeName(book.categoryName);

        if (currentCategoryId && currentCategoryId === categoryId) {
            byId.push(bookDoc);
            return;
        }

        if (!currentCategoryId && normalizedCategoryName && currentCategoryName === normalizedCategoryName) {
            byName.push(bookDoc);
        }
    });

    if (!byName.length) return byId;

    const merged = [...byId];
    const seenIds = new Set(byId.map((docSnap) => docSnap.id));
    byName.forEach((docSnap) => {
        if (!seenIds.has(docSnap.id)) merged.push(docSnap);
    });
    return merged;
};

const openCategoryBooksModal = (category, booksInCategory = []) => {
    if (!categoryBooksModal || !categoryBooksList) return;

    const categoryName = category?.categoryName || 'Thể loại';
    categoryBooksTitle.textContent = `Sách thuộc: ${categoryName}`;
    state.categoryBooks = booksInCategory;
    state.categoryBooksSearch = '';
    if (categoryBooksSearchInput) categoryBooksSearchInput.value = '';

    renderPopularEntities();
    renderCategoryBooksList();

    categoryBooksModal.classList.remove('hidden');
    categoryBooksModal.classList.add('flex');
};

const closeCategoryBooksModal = () => {
    if (!categoryBooksModal) return;
    categoryBooksModal.classList.add('hidden');
    categoryBooksModal.classList.remove('flex');
};

const renderCategories = () => {
    const { categories, books, currentPage, itemsPerPage } = state;
    categoriesContainer.innerHTML = '';
    const countByCategoryId = new Map();
    const countByCategoryName = new Map();

    categories.forEach((cat) => {
        const data = cat.data() || {};
        countByCategoryId.set(cat.id, 0);
        countByCategoryName.set(normalizeName(data.categoryName), 0);
    });

    books.forEach((bookSnap) => {
        const book = bookSnap.data() || {};
        const categoryId = (book.categoryId || '').toString().trim();
        const categoryName = normalizeName(book.categoryName);

        if (categoryId && countByCategoryId.has(categoryId)) {
            countByCategoryId.set(categoryId, (countByCategoryId.get(categoryId) || 0) + 1);
            return;
        }

        if (categoryName && countByCategoryName.has(categoryName)) {
            countByCategoryName.set(categoryName, (countByCategoryName.get(categoryName) || 0) + 1);
        }
    });

    const categoryCounts = categories.map((cat) => {
        const data = cat.data() || {};
        const byId = countByCategoryId.get(cat.id) || 0;
        const byName = countByCategoryName.get(normalizeName(data.categoryName)) || 0;
        return byId > 0 ? byId : byName;
    });

    const maxCount = Math.max(0, ...categoryCounts);
    let totalBooks = books.length;
    let popularCat = { name: '--', count: 0 };

    // Tìm thể loại phổ biến nhất dựa trên tất cả dữ liệu
    categories.forEach((cat, idx) => {
        const data = cat.data();
        const bCount = categoryCounts[idx] || 0;
        if (bCount > popularCat.count) popularCat = { name: data.categoryName, count: bCount };
    });

    // Lọc theo tìm kiếm
    let filteredCategories = categories;
    if (state.search) {
        const searchTerm = normalizeText(state.search);
        filteredCategories = categories.filter(cat => {
            const data = cat.data();
            const name = normalizeText(data.categoryName);
            const description = normalizeText(data.description);
            return name.includes(searchTerm) || description.includes(searchTerm);
        });
    }

    // Phân trang
    const totalItems = filteredCategories.length;
    const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;
    
    // Đảm bảo trang hiện tại hợp lệ
    if (state.currentPage > totalPages) state.currentPage = totalPages;
    if (state.currentPage < 1) state.currentPage = 1;

    const startIndex = (state.currentPage - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, totalItems);
    
    // Cập nhật text hiển thị số lượng
    if (pageStartInfo) pageStartInfo.textContent = totalItems === 0 ? 0 : startIndex + 1;
    if (pageEndInfo) pageEndInfo.textContent = endIndex;
    if (totalItemsInfo) totalItemsInfo.textContent = totalItems;

    const currentCategories = filteredCategories.slice(startIndex, endIndex);

    currentCategories.forEach((cat) => {
        const originalIdx = categories.findIndex(c => c.id === cat.id);
        const data = cat.data();
        const id = cat.id;
        const bCount = categoryCounts[originalIdx] || 0;
        const booksInCategory = getBooksForCategory(id, data.categoryName);

        const card = document.createElement('div');
        card.className = 'bg-white rounded-2xl p-4 border border-slate-200 shadow-sm hover:shadow-md hover:border-primary-200 transition-all group animate-fade-in';
        const progress = maxCount > 0 ? Math.round((bCount / maxCount) * 100) : 0;
        
        card.innerHTML = `
            <div class="flex items-start justify-between mb-3">
                <div class="w-11 h-11 rounded-xl bg-primary-100 text-primary-600 flex items-center justify-center text-xl flex-shrink-0">
                    <i class="ph-fill ${data.icon || 'ph-monitor'}"></i>
                </div>
                <div class="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button class="edit-btn p-1.5 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
                        <i class="ph ph-pencil text-lg"></i>
                    </button>
                    <button class="delete-btn p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg transition-colors">
                        <i class="ph ph-trash text-lg"></i>
                    </button>
                </div>
            </div>
            <h4 class="font-bold text-slate-800 text-base mb-1">${data.categoryName}</h4>
            <p class="text-sm text-slate-600 mb-3 line-clamp-2">${data.description || 'Không có mô tả'}</p>
            <div class="space-y-2">
                <div class="flex items-center justify-between">
                    <span class="text-xs text-slate-500">Số Sách</span>
                    <span class="font-bold text-slate-800">${bCount.toLocaleString()}</span>
                </div>
                <div class="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div class="h-full bg-primary-500" style="width: ${progress}%"></div>
                </div>
            </div>
            <button class="view-books-btn mt-3 w-full px-3 py-2 text-sm font-medium text-primary-700 bg-primary-50 hover:bg-primary-100 rounded-lg transition-colors">
                Xem sách thuộc thể loại
            </button>
        `;
        
        card.querySelector('.edit-btn').addEventListener('click', () => openModal(true, { id, ...data }));
        card.querySelector('.delete-btn').addEventListener('click', () => {
            showConfirmModal(`Bạn có chắc muốn xóa thể loại "${data.categoryName}"?`, () => deleteCategory(id, data.categoryName, bCount));
        });
        card.querySelector('.view-books-btn').addEventListener('click', () => {
            openCategoryBooksModal(data, booksInCategory);
        });
        categoriesContainer.appendChild(card);
    });

    totalSummary.textContent = `${categories.length} thể loại`;
    statTotalCategories.textContent = categories.length;
    statActiveCategories.textContent = categories.length;
    statTotalBooks.textContent = totalBooks > 1000 ? (totalBooks / 1000).toFixed(1) + 'K' : totalBooks;
    statPopularCategory.textContent = popularCat.name;
    statPopularCount.textContent = `${popularCat.count.toLocaleString()} sách`;

    renderPagination(totalPages);
};

const renderPagination = (totalPages) => {
    if (!paginationControls) return;
    paginationControls.innerHTML = '';
    
    if (totalPages <= 1) return;

    // Prev Button
    const prevBtn = document.createElement('button');
    prevBtn.className = `p-2 rounded-lg border flex items-center justify-center transition-colors ${
        state.currentPage === 1 
        ? 'border-slate-200 text-slate-300 cursor-not-allowed bg-slate-50' 
        : 'border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300'
    }`;
    prevBtn.innerHTML = '<i class="ph ph-caret-left"></i>';
    prevBtn.disabled = state.currentPage === 1;
    if (!prevBtn.disabled) {
        prevBtn.addEventListener('click', () => {
            state.currentPage--;
            renderAll();
        });
    }
    paginationControls.appendChild(prevBtn);

    // Page Numbers
    for (let i = 1; i <= totalPages; i++) {
        // Rút gọn hiển thị trang nếu có quá nhiều trang (ví dụ: 1 2 ... 5 6)
        if (totalPages > 5) {
            if (i !== 1 && i !== totalPages && Math.abs(i - state.currentPage) > 1) {
                if (i === 2 || i === totalPages - 1) {
                    const dots = document.createElement('span');
                    dots.className = 'p-2 text-slate-400';
                    dots.textContent = '...';
                    paginationControls.appendChild(dots);
                }
                continue;
            }
        }

        const pageBtn = document.createElement('button');
        const isActive = i === state.currentPage;
        
        pageBtn.className = `min-w-[36px] h-9 px-2 rounded-lg text-sm font-medium transition-all ${
            isActive 
            ? 'bg-primary-600 text-white shadow-md shadow-primary-500/20' 
            : 'text-slate-600 hover:bg-slate-100'
        }`;
        pageBtn.textContent = i;
        pageBtn.addEventListener('click', () => {
            state.currentPage = i;
            renderAll();
        });
        
        paginationControls.appendChild(pageBtn);
    }

    // Next Button
    const nextBtn = document.createElement('button');
    nextBtn.className = `p-2 rounded-lg border flex items-center justify-center transition-colors ${
        state.currentPage === totalPages 
        ? 'border-slate-200 text-slate-300 cursor-not-allowed bg-slate-50' 
        : 'border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300'
    }`;
    nextBtn.innerHTML = '<i class="ph ph-caret-right"></i>';
    nextBtn.disabled = state.currentPage === totalPages;
    if (!nextBtn.disabled) {
        nextBtn.addEventListener('click', () => {
            state.currentPage++;
            renderAll();
        });
    }
    paginationControls.appendChild(nextBtn);
};

// --- Event Listeners ---

const searchInput = getElem('adminCategorySearchInput');
if (searchInput) {
    searchInput.addEventListener('input', (e) => {
        state.search = (e.target.value || '').trim();
        state.currentPage = 1;
        renderAll();
    });
}

if (categoryBooksSearchInput) {
    categoryBooksSearchInput.addEventListener('input', (e) => {
        state.categoryBooksSearch = (e.target.value || '').trim();
        renderCategoryBooksList();
    });
}

iconBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const icon = btn.getAttribute('data-icon');
        categoryIconInput.value = icon;
        updateIconUI(icon);
    });
});

btnOpenAddModal.addEventListener('click', () => openModal(false));
btnCloseModal.addEventListener('click', closeModal);
btnCancelModal.addEventListener('click', closeModal);
btnCloseCategoryBooks?.addEventListener('click', closeCategoryBooksModal);

categoryBooksModal?.addEventListener('click', (e) => {
    if (e.target === categoryBooksModal) closeCategoryBooksModal();
});

categoryForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = categoryIdInput.value;
    const name = categoryNameInput.value.trim();
    if (!name) { showToast("Vui lòng nhập tên thể loại!", "error"); return; }

    const categoryData = {
        categoryName: name,
        description: categoryDescInput.value.trim(),
        icon: categoryIconInput.value
    };

    try {
        if (id) {
            await updateDoc(doc(db, 'categories', id), categoryData);
            showToast("Cập nhật thể loại thành công!");
        } else {
            await addDoc(collection(db, 'categories'), { ...categoryData, bookCount: 0 });
            showToast("Thêm thể loại mới thành công!");
        }
        closeModal();
    } catch (error) {
        console.error("Error saving category:", error);
        showToast("Lỗi khi lưu thể loại.", "error");
    }
});

const renderAll = () => {
    renderCategories();
};

// Khởi chạy — bảo vệ bằng admin guard
requireAdmin(() => {
    onSnapshot(query(collection(db, 'categories'), orderBy('categoryName', 'asc')), (snapshot) => {
        state.categories = snapshot.docs;
        renderAll();
    });

    onSnapshot(collection(db, 'books'), (snapshot) => {
        state.books = snapshot.docs;
        renderAll();
    });
});

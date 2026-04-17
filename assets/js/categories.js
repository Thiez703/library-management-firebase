import { db } from './firebase-config.js';
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
    books: []
};

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

const renderCategories = (categories, books) => {
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

    categories.forEach((cat, idx) => {
        const data = cat.data();
        const id = cat.id;
        const bCount = categoryCounts[idx] || 0;
        if (bCount > popularCat.count) popularCat = { name: data.categoryName, count: bCount };

        const card = document.createElement('div');
        card.className = 'bg-white rounded-2xl p-6 border border-slate-200 shadow-sm hover:shadow-md hover:border-primary-200 transition-all group animate-fade-in';
        const progress = maxCount > 0 ? Math.round((bCount / maxCount) * 100) : 0;
        
        card.innerHTML = `
            <div class="flex items-start justify-between mb-4">
                <div class="w-12 h-12 rounded-xl bg-primary-100 text-primary-600 flex items-center justify-center text-xl flex-shrink-0">
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
            <h4 class="font-bold text-slate-800 text-lg mb-1">${data.categoryName}</h4>
            <p class="text-sm text-slate-600 mb-4 line-clamp-2">${data.description || 'Không có mô tả'}</p>
            <div class="space-y-3">
                <div class="flex items-center justify-between">
                    <span class="text-xs text-slate-500">Số Sách</span>
                    <span class="font-bold text-slate-800">${bCount.toLocaleString()}</span>
                </div>
                <div class="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div class="h-full bg-primary-500" style="width: ${progress}%"></div>
                </div>
            </div>
        `;
        
        card.querySelector('.edit-btn').addEventListener('click', () => openModal(true, { id, ...data }));
        card.querySelector('.delete-btn').addEventListener('click', () => {
            showConfirmModal(`Bạn có chắc muốn xóa thể loại "${data.categoryName}"?`, () => deleteCategory(id, data.categoryName, bCount));
        });
        categoriesContainer.appendChild(card);
    });

    totalSummary.textContent = `${categories.length} thể loại`;
    statTotalCategories.textContent = categories.length;
    statActiveCategories.textContent = categories.length;
    statTotalBooks.textContent = totalBooks > 1000 ? (totalBooks / 1000).toFixed(1) + 'K' : totalBooks;
    statPopularCategory.textContent = popularCat.name;
    statPopularCount.textContent = `${popularCat.count.toLocaleString()} sách`;
};

// --- Event Listeners ---

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
    renderCategories(state.categories, state.books);
};

onSnapshot(query(collection(db, 'categories'), orderBy('categoryName', 'asc')), (snapshot) => {
    state.categories = snapshot.docs;
    renderAll();
});

onSnapshot(collection(db, 'books'), (snapshot) => {
    state.books = snapshot.docs;
    renderAll();
});

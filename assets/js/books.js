import { db, storage } from './firebase-config.js';
import { requireAdmin } from './admin-guard.js';
import { collection, addDoc, updateDoc, doc, deleteDoc, serverTimestamp, onSnapshot, query, orderBy, getDoc, getDocs, limit, startAfter, where } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";
import { ref, uploadBytesResumable, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-storage.js";
import { showToast, showConfirm } from './notify.js';

const getElem = (id) => document.getElementById(id);
const MAX_BOOK_QUANTITY = 3000;

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

const COVER_PLACEHOLDER = '../assets/images/book-cover-placeholder-gray.svg';
let currentCoverUrl = '';
let previewObjectUrl = '';

// ============================================================
// Cover Preview
// ============================================================
const revokePreviewObjectUrl = () => {
    if (!previewObjectUrl) return;
    URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = '';
};

const setCoverPreview = (src = COVER_PLACEHOLDER) => {
    const previewImg = getElem('book-cover-preview');
    if (!previewImg) return;
    previewImg.src = src || COVER_PLACEHOLDER;
};

const updateCoverPreviewFromFile = (file) => {
    revokePreviewObjectUrl();
    if (file) {
        previewObjectUrl = URL.createObjectURL(file);
        setCoverPreview(previewObjectUrl);
        return;
    }
    setCoverPreview(currentCoverUrl || COVER_PLACEHOLDER);
};

const resetBookCoverPreview = () => {
    currentCoverUrl = '';
    revokePreviewObjectUrl();
    const bookImageInput = getElem('bookImage');
    if (bookImageInput) bookImageInput.value = '';
    setCoverPreview(COVER_PLACEHOLDER);
};

// ============================================================
// State
// ============================================================
let adminAllBooks = [];
let adminAllCategories = [];
let adminSearchTerm = '';
let categorySearchTerm = '';
let selectedCategoryId = null; // null = all
let adminCurrentPage = 1;
const adminPageSize = 10;

// ============================================================
// Category Sidebar
// ============================================================
const getBookCountForCategory = (catId) => {
    return adminAllBooks.filter(snap => {
        const book = snap.data();
        return book.categoryId === catId;
    }).length;
};

const renderCategorySidebar = () => {
    const container = getElem('category-list');
    if (!container) return;

    let cats = adminAllCategories;
    if (categorySearchTerm) {
        const term = normalizeText(categorySearchTerm);
        cats = cats.filter(snap => {
            const data = snap.data();
            return normalizeText(data.categoryName).includes(term);
        });
    }

    const totalBooks = adminAllBooks.length;

    let html = `
        <button class="cat-item w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left text-sm transition-all group hover:bg-slate-50 ${selectedCategoryId === null ? 'active' : ''}" data-cat-id="">
            <div class="w-8 h-8 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center text-base shrink-0">
                <i class="ph-fill ph-squares-four"></i>
            </div>
            <div class="flex-1 min-w-0">
                <p class="cat-name font-medium text-slate-700 text-sm truncate">Tất cả thể loại</p>
            </div>
            <span class="text-[11px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">${totalBooks}</span>
        </button>
    `;

    cats.forEach(snap => {
        const data = snap.data();
        const id = snap.id;
        const count = getBookCountForCategory(id);
        const isActive = selectedCategoryId === id;
        const icon = data.icon || 'ph-book-open';

        html += `
            <button class="cat-item w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left text-sm transition-all group hover:bg-slate-50 ${isActive ? 'active' : ''}" data-cat-id="${id}">
                <div class="w-8 h-8 rounded-lg bg-primary-50 text-primary-600 flex items-center justify-center text-base shrink-0">
                    <i class="ph-fill ${icon}"></i>
                </div>
                <div class="flex-1 min-w-0">
                    <p class="cat-name font-medium text-slate-700 text-sm truncate">${escapeHtml(data.categoryName)}</p>
                </div>
                <span class="text-[11px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">${count}</span>
                <div class="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <span class="edit-cat p-1 text-slate-400 hover:text-primary-600 rounded cursor-pointer" data-edit-id="${id}" title="Sửa"><i class="ph ph-pencil-simple text-sm"></i></span>
                    <span class="delete-cat p-1 text-slate-400 hover:text-rose-600 rounded cursor-pointer" data-delete-id="${id}" data-delete-name="${escapeHtml(data.categoryName)}" data-delete-count="${count}" title="Xóa"><i class="ph ph-trash-simple text-sm"></i></span>
                </div>
            </button>
        `;
    });

    container.innerHTML = html;

    // Bind click events
    container.querySelectorAll('.cat-item').forEach(btn => {
        btn.addEventListener('click', (e) => {
            // Don't select category when clicking edit/delete
            if (e.target.closest('.edit-cat') || e.target.closest('.delete-cat')) return;
            const catId = btn.getAttribute('data-cat-id');
            selectedCategoryId = catId || null;
            adminCurrentPage = 1;
            renderCategorySidebar();
            renderAdminPage();
            updateCategoryTitle();
        });
    });

    container.querySelectorAll('.edit-cat').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.getAttribute('data-edit-id');
            openEditCategory(id);
        });
    });

    container.querySelectorAll('.delete-cat').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.getAttribute('data-delete-id');
            const name = btn.getAttribute('data-delete-name');
            const count = parseInt(btn.getAttribute('data-delete-count')) || 0;
            handleDeleteCategory(id, name, count);
        });
    });
};

const updateCategoryTitle = () => {
    const titleEl = getElem('current-category-name');
    if (!titleEl) return;
    if (!selectedCategoryId) {
        titleEl.textContent = 'Tất cả sách';
        return;
    }
    const catSnap = adminAllCategories.find(s => s.id === selectedCategoryId);
    if (catSnap) {
        titleEl.textContent = catSnap.data().categoryName;
    }
};

// ============================================================
// Category CRUD
// ============================================================
const openCategoryModal = (isEdit = false, data = null) => {
    const modal = getElem('categoryModal');
    if (!modal) return;

    const form = getElem('categoryForm');
    const title = getElem('catModalTitle');
    const idInput = getElem('category-id');
    const nameInput = getElem('category-name');
    const descInput = getElem('category-description');
    const iconInput = getElem('category-icon');

    if (form) form.reset();

    if (isEdit && data) {
        if (title) title.textContent = 'Chỉnh Sửa Thể Loại';
        if (idInput) idInput.value = data.id;
        if (nameInput) nameInput.value = data.categoryName;
        if (descInput) descInput.value = data.description || '';
        if (iconInput) iconInput.value = data.icon || 'ph-book-open';
        updateIconUI(data.icon || 'ph-book-open');
    } else {
        if (title) title.textContent = 'Thêm Thể Loại Mới';
        if (idInput) idInput.value = '';
        if (iconInput) iconInput.value = 'ph-book-open';
        updateIconUI('ph-book-open');
    }

    modal.classList.replace('hidden', 'flex');
};

const closeCategoryModal = () => {
    const modal = getElem('categoryModal');
    if (!modal) return;
    modal.classList.replace('flex', 'hidden');
};

const openEditCategory = async (id) => {
    const snap = adminAllCategories.find(s => s.id === id);
    if (!snap) return;
    openCategoryModal(true, { id, ...snap.data() });
};

const handleSaveCategory = async (e) => {
    e.preventDefault();
    const id = getElem('category-id')?.value;
    const name = getElem('category-name')?.value.trim();
    const description = getElem('category-description')?.value.trim();
    const icon = getElem('category-icon')?.value || 'ph-book-open';

    if (!name) {
        showToast('Vui lòng nhập tên thể loại!', 'error');
        return;
    }

    const categoryData = { categoryName: name, description, icon };

    try {
        if (id) {
            await updateDoc(doc(db, 'categories', id), categoryData);
            showToast('Cập nhật thể loại thành công!');
        } else {
            await addDoc(collection(db, 'categories'), { ...categoryData, bookCount: 0 });
            showToast('Thêm thể loại mới thành công!');
        }
        closeCategoryModal();
    } catch (error) {
        console.error('Error saving category:', error);
        showToast('Lỗi khi lưu thể loại.', 'error');
    }
};

const handleDeleteCategory = async (id, name, bookCount) => {
    if (bookCount > 0) {
        showToast(`Không thể xóa "${name}" vì còn ${bookCount} sách thuộc thể loại này!`, 'error');
        return;
    }

    const ok = await showConfirm(`Bạn có chắc muốn xóa thể loại "${name}"?`, {
        title: 'Xác nhận xóa',
        confirmText: 'Xóa',
        cancelText: 'Hủy',
        type: 'warning'
    });
    if (!ok) return;

    try {
        // Double check in Firestore
        const qBooks = query(collection(db, 'books'), where('categoryId', '==', id), limit(1));
        const bookSnapshot = await getDocs(qBooks);
        if (!bookSnapshot.empty) {
            showToast(`Thể loại "${name}" vẫn còn sách liên kết!`, 'error');
            return;
        }
        await deleteDoc(doc(db, 'categories', id));
        if (selectedCategoryId === id) {
            selectedCategoryId = null;
            updateCategoryTitle();
        }
        showToast(`Đã xóa thể loại "${name}" thành công!`);
    } catch (error) {
        console.error('Error deleting category:', error);
        showToast('Có lỗi khi xóa thể loại.', 'error');
    }
};

const updateIconUI = (selectedIcon) => {
    const iconBtns = document.querySelectorAll('#icon-selector .icon-btn');
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

// ============================================================
// Book Modal
// ============================================================
const openAddBookModal = () => {
    const modal = getElem('addBookModal');
    if (!modal) return;

    const form = getElem('bookForm');
    if (form) form.reset();
    if (getElem('book-id')) getElem('book-id').value = '';
    if (getElem('modalTitle')) getElem('modalTitle').textContent = 'Thêm Sách Mới';

    // Pre-select category if one is selected in sidebar
    if (selectedCategoryId) {
        setTimeout(() => {
            const catSelect = getElem('book-category');
            if (catSelect) catSelect.value = selectedCategoryId;
        }, 50);
    }

    resetBookCoverPreview();
    modal.classList.replace('hidden', 'flex');
};

const closeBookModal = () => {
    const modal = getElem('addBookModal');
    if (!modal) return;
    modal.classList.replace('flex', 'hidden');
    resetBookCoverPreview();
};

window.openAddBookModal = openAddBookModal;
window.closeBookModal = closeBookModal;

// ============================================================
// Init Page
// ============================================================
const updateCategoryDropdown = () => {
    const select = getElem('book-category');
    if (!select) return;
    const current = select.value;
    select.innerHTML = '<option value="">Chọn thể loại...</option>' +
        adminAllCategories.map(d => `<option value="${d.id}" data-name="${d.data().categoryName}">${d.data().categoryName}</option>`).join('');
    select.value = current;
};

const initAdminBooks = () => {
    const tableBody = getElem('books-table-body');
    if (!tableBody) return;

    console.log("System: Admin Books + Categories Module Loaded");

    // Listen to Categories
    onSnapshot(query(collection(db, 'categories'), orderBy('categoryName', 'asc')), (snap) => {
        adminAllCategories = snap.docs;
        updateCategoryDropdown();
        renderCategorySidebar();
    });

    // Listen to Books
    onSnapshot(query(collection(db, 'books'), orderBy('createdAt', 'desc')), (snap) => {
        adminAllBooks = snap.docs;
        renderAdminPage();
        renderCategorySidebar(); // update counts
    });

    // Book form submit
    const form = getElem('bookForm');
    if (form) {
        form.onsubmit = async (e) => {
            e.preventDefault();
            const submitBtn = document.querySelector('button[type="submit"][form="bookForm"]') || form.querySelector('button[type="submit"]');
            try {
                if (submitBtn) {
                    submitBtn.disabled = true;
                    submitBtn.innerHTML = '<i class="ph ph-spinner animate-spin mr-2"></i> Đang lưu...';
                }
                await handleSaveBook();
            } catch (error) {
                console.error("Save Error:", error);
                showToast("Lỗi: " + error.message, "error");
            } finally {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = 'Lưu Sách';
                }
            }
        };
    }

    // Category form submit
    const catForm = getElem('categoryForm');
    if (catForm) {
        catForm.addEventListener('submit', handleSaveCategory);
    }

    // Category icon selector
    document.querySelectorAll('#icon-selector .icon-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const icon = btn.getAttribute('data-icon');
            const iconInput = getElem('category-icon');
            if (iconInput) iconInput.value = icon;
            updateIconUI(icon);
        });
    });

    // Book search
    const searchInput = getElem('adminBookSearchInput');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            adminSearchTerm = (e.target.value || '').trim();
            adminCurrentPage = 1;
            renderAdminPage();
        });
    }

    // Category search
    const catSearchInput = getElem('categorySearchInput');
    if (catSearchInput) {
        catSearchInput.addEventListener('input', (e) => {
            categorySearchTerm = (e.target.value || '').trim();
            renderCategorySidebar();
        });
    }

    // Image preview
    const imageInput = getElem('bookImage');
    if (imageInput) {
        imageInput.addEventListener('change', (e) => {
            const selectedFile = e.target.files?.[0] || null;
            updateCoverPreviewFromFile(selectedFile);
        });
    }

    // Button bindings
    getElem('btn-open-book-modal')?.addEventListener('click', openAddBookModal);
    getElem('btn-close-book-modal')?.addEventListener('click', closeBookModal);
    getElem('btn-cancel-book-modal')?.addEventListener('click', closeBookModal);
    getElem('btn-add-category')?.addEventListener('click', () => openCategoryModal(false));
    getElem('btn-close-cat-modal')?.addEventListener('click', closeCategoryModal);
    getElem('btn-cancel-cat-modal')?.addEventListener('click', closeCategoryModal);

    setCoverPreview(COVER_PLACEHOLDER);
};

// ============================================================
// Render Books Table
// ============================================================
const renderAdminPage = () => {
    let filteredBooks = adminAllBooks;

    // Filter by category
    if (selectedCategoryId) {
        filteredBooks = filteredBooks.filter(snap => {
            const book = snap.data();
            return book.categoryId === selectedCategoryId;
        });
    }

    // Filter by search
    if (adminSearchTerm) {
        const normalizedTerm = normalizeText(adminSearchTerm);
        filteredBooks = filteredBooks.filter(snap => {
            const book = snap.data();
            const title = normalizeText(book.title || '');
            const author = normalizeText(book.author || '');
            return title.includes(normalizedTerm) || author.includes(normalizedTerm);
        });
    }

    const totalCount = filteredBooks.length;
    const totalPages = Math.ceil(totalCount / adminPageSize);

    if (adminCurrentPage > totalPages) adminCurrentPage = totalPages;
    if (adminCurrentPage < 1) adminCurrentPage = 1;

    const startIdx = (adminCurrentPage - 1) * adminPageSize;
    const endIdx = startIdx + adminPageSize;
    const docsToRender = filteredBooks.slice(startIdx, endIdx);

    renderBooksTable(docsToRender, totalCount);
    renderAdminPagination(totalCount, totalPages);
};

const renderBooksTable = (docs, totalCount) => {
    const tableBody = getElem('books-table-body');
    if (!tableBody) return;

    if (docs.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="9" class="px-4 py-12 text-center text-slate-500">
            <i class="ph ph-books text-4xl text-slate-300 mb-2 block"></i>
            Không tìm thấy sách nào.
        </td></tr>`;
        if (getElem('total-summary')) getElem('total-summary').innerText = totalCount;
        return;
    }

    tableBody.innerHTML = docs.map(snap => {
        const book = snap.data();
        const id = snap.id;
        const avail = book.availableQuantity || 0;
        const statusClass = avail === 0 ? 'bg-rose-50 text-rose-700' : (avail < 5 ? 'bg-orange-50 text-orange-700' : 'bg-emerald-50 text-emerald-700');
        const statusDot = avail === 0 ? 'bg-rose-500' : (avail < 5 ? 'bg-orange-500' : 'bg-emerald-500');

        return `
            <tr class="hover:bg-slate-50/80 transition-colors group">
                <td class="px-3 py-2"><div class="w-10 h-14 rounded-md overflow-hidden bg-slate-100 border border-slate-200"><img src="${book.coverUrl || COVER_PLACEHOLDER}" class="w-full h-full object-cover" onerror="this.src='${COVER_PLACEHOLDER}'"></div></td>
                <td class="px-3 py-2 font-semibold text-slate-800 truncate max-w-[200px]">${escapeHtml(book.title)}</td>
                <td class="px-3 py-2 text-slate-600 truncate max-w-[120px]">${escapeHtml(book.author)}</td>
                <td class="px-3 py-2 text-slate-600 truncate max-w-[120px]">${escapeHtml(book.publisher || '--')}</td>
                <td class="px-3 py-2"><span class="px-2 py-0.5 bg-blue-100 text-blue-700 text-[10px] font-bold rounded-full">${escapeHtml(book.categoryName || '--')}</span></td>
                <td class="px-3 py-2 text-center">${book.totalQuantity}</td>
                <td class="px-3 py-2 text-center font-bold ${avail > 0 ? 'text-emerald-600' : 'text-rose-600'}">${avail}</td>
                <td class="px-3 py-2"><span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${statusClass}"><span class="w-1.5 h-1.5 ${statusDot} rounded-full"></span> ${avail > 0 ? 'Còn sách' : 'Hết sách'}</span></td>
                <td class="px-1.5 py-2 text-right">
                    <div class="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onclick="editBookAction('${id}')" class="p-1.5 text-slate-600 hover:bg-slate-100 rounded-lg"><i class="ph ph-pencil"></i></button>
                        <button onclick="deleteBookAction('${id}', '${escapeHtml(book.title).replace(/'/g, "\\'")}')" class="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg"><i class="ph ph-trash"></i></button>
                    </div>
                </td>
            </tr>`;
    }).join('');

    if (getElem('total-summary')) getElem('total-summary').innerText = totalCount;
};

const renderAdminPagination = (totalCount, totalPages) => {
    const info = getElem('pagination-info');
    const controls = getElem('pagination-controls');

    if (!info || !controls) return;

    if (totalCount === 0) {
        info.innerHTML = `Không có sách nào`;
        controls.classList.add('hidden');
        return;
    }

    const startItem = (adminCurrentPage - 1) * adminPageSize + 1;
    const endItem = Math.min(adminCurrentPage * adminPageSize, totalCount);
    info.innerHTML = `Hiển thị <strong>${startItem} - ${endItem}</strong> / <strong>${totalCount}</strong> cuốn sách`;

    if (totalPages <= 1) {
        controls.classList.add('hidden');
        return;
    }

    controls.classList.remove('hidden');
    let btnsHtml = `
        <button class="btn-prev-page p-1 rounded hover:bg-slate-200 text-slate-500 transition-colors ${adminCurrentPage === 1 ? 'opacity-50 cursor-not-allowed' : ''}" title="Trang trước"><i class="ph-bold ph-caret-left"></i></button>
    `;

    for (let i = 1; i <= totalPages; i++) {
        if (i === 1 || i === totalPages || (i >= adminCurrentPage - 1 && i <= adminCurrentPage + 1)) {
            if (i === adminCurrentPage) {
                btnsHtml += `<button class="btn-page w-7 h-7 rounded bg-primary-600 text-white font-bold text-xs" data-page="${i}">${i}</button>`;
            } else {
                btnsHtml += `<button class="btn-page w-7 h-7 rounded hover:bg-slate-200 text-slate-700 font-medium text-xs transition-colors" data-page="${i}">${i}</button>`;
            }
        } else if (i === adminCurrentPage - 2 || i === adminCurrentPage + 2) {
            btnsHtml += `<span class="text-slate-400 font-medium px-1 text-xs">...</span>`;
        }
    }

    btnsHtml += `
        <button class="btn-next-page p-1 rounded hover:bg-slate-200 text-slate-500 transition-colors ${adminCurrentPage === totalPages ? 'opacity-50 cursor-not-allowed' : ''}" title="Trang sau"><i class="ph-bold ph-caret-right"></i></button>
    `;

    controls.innerHTML = btnsHtml;

    const prevBtn = controls.querySelector('.btn-prev-page');
    const nextBtn = controls.querySelector('.btn-next-page');

    if (adminCurrentPage > 1) {
        prevBtn.onclick = () => { adminCurrentPage--; renderAdminPage(); };
    }
    if (adminCurrentPage < totalPages) {
        nextBtn.onclick = () => { adminCurrentPage++; renderAdminPage(); };
    }

    controls.querySelectorAll('.btn-page').forEach(btn => {
        btn.onclick = (e) => {
            const p = parseInt(e.target.getAttribute('data-page'));
            if (p !== adminCurrentPage) {
                adminCurrentPage = p;
                renderAdminPage();
            }
        };
    });
};

// ============================================================
// Save Book (removed borrowDuration)
// ============================================================
const handleSaveBook = async () => {
    const id = getElem('book-id').value;
    const title = getElem('book-title').value.trim();
    const author = getElem('book-author').value.trim();
    const catSelect = getElem('book-category');
    const file = getElem('bookImage').files[0];

    if (!title || !author || !catSelect.value) {
        throw new Error("Vui lòng điền đầy đủ Tên sách, Tác giả và Thể loại!");
    }

    const qty = parseInt(getElem('book-quantity').value, 10);
    if (!Number.isInteger(qty) || qty < 1) {
        throw new Error("Số lượng sách phải là số nguyên lớn hơn 0.");
    }
    if (qty > MAX_BOOK_QUANTITY) {
        throw new Error(`Số lượng sách tối đa là ${MAX_BOOK_QUANTITY} cuốn.`);
    }

    const data = {
        title, author,
        publisher: getElem('book-publisher').value.trim(),
        categoryId: catSelect.value,
        categoryName: catSelect.options[catSelect.selectedIndex].getAttribute('data-name'),
        publishYear: getElem('book-year').value || null,
        titleLower: normalizeText(title),
        totalQuantity: qty,
        availableQuantity: qty,
        description: getElem('book-description').value.trim(),
        updatedAt: serverTimestamp()
    };

    let bookId = id;
    if (id) {
        const existingSnap = await getDoc(doc(db, 'books', id));
        if (existingSnap.exists()) {
            const existingData = existingSnap.data();
            const currentTotal = Number(existingData.totalQuantity || 0);
            const currentAvailable = Number(existingData.availableQuantity || 0);
            const currentlyBorrowed = Math.max(0, currentTotal - currentAvailable);
            data.availableQuantity = Math.max(0, qty - currentlyBorrowed);
        } else {
            data.availableQuantity = qty;
        }
        await updateDoc(doc(db, 'books', id), data);
    } else {
        data.createdAt = serverTimestamp();
        const newDoc = await addDoc(collection(db, 'books'), data);
        bookId = newDoc.id;
    }

    closeBookModal();
    getElem('bookForm').reset();

    if (file) {
        const toast = showToast("Đang tải ảnh bìa (0%)...", "info");
        const storageRef = ref(storage, `covers/${bookId}_${Date.now()}`);
        const uploadTask = uploadBytesResumable(storageRef, file);

        uploadTask.on('state_changed',
            (snap) => {
                const prog = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
                toast.update(`Đang tải ảnh bìa (${prog}%)...`);
            },
            (err) => { toast.update("Lỗi tải ảnh!"); setTimeout(toast.close, 2000); },
            async () => {
                const url = await getDownloadURL(uploadTask.snapshot.ref);
                await updateDoc(doc(db, 'books', bookId), { coverUrl: url });
                toast.update("Lưu sách và ảnh thành công!");
                setTimeout(toast.close, 1500);
            }
        );
    } else {
        showToast("Đã lưu sách thành công!");
    }
};

// ============================================================
// Global Actions
// ============================================================
window.editBookAction = async (id) => {
    try {
        const snap = await getDoc(doc(db, 'books', id));
        if (!snap.exists()) return;
        const book = snap.data();

        getElem('book-id').value = id;
        getElem('book-title').value = book.title;
        getElem('book-author').value = book.author;
        getElem('book-publisher').value = book.publisher || '';
        getElem('book-category').value = book.categoryId;
        getElem('book-year').value = book.publishYear || '';
        getElem('book-quantity').value = book.totalQuantity;
        getElem('book-description').value = book.description || '';

        currentCoverUrl = book.coverUrl || '';
        revokePreviewObjectUrl();
        setCoverPreview(currentCoverUrl || COVER_PLACEHOLDER);
        const imageInput = getElem('bookImage');
        if (imageInput) imageInput.value = '';

        getElem('modalTitle').textContent = "Chỉnh Sửa Sách";
        getElem('addBookModal').classList.replace('hidden', 'flex');
    } catch (e) { showToast("Lỗi khi lấy thông tin sách", "error"); }
};

window.deleteBookAction = async (id, title) => {
    const ok = await showConfirm(`Bạn có chắc chắn muốn xóa sách "${title}"?`, {
        title: 'Xác nhận xóa sách',
        confirmText: 'Xóa sách',
        cancelText: 'Hủy',
        type: 'warning'
    });

    if (!ok) return;

    try {
        await deleteDoc(doc(db, 'books', id));
        showToast("Đã xóa sách thành công.");
    } catch (e) {
        showToast("Lỗi khi xóa sách", "error");
    }
};

// ============================================================
// Guard Init
// ============================================================
const guardedInit = () => {
    if (!document.getElementById('books-table-body')) return;
    requireAdmin(() => initAdminBooks());
};
document.addEventListener('turbo:load', guardedInit);
document.addEventListener('turbo:render', guardedInit);
if (document.readyState !== 'loading') guardedInit();
else document.addEventListener('DOMContentLoaded', guardedInit);

// ============================================================
// Exports (used by other pages)
// ============================================================
export const loadBooksPage = async (lastDocNode = null, pageSize = 12) => {
    let q;
    if (lastDocNode) {
        q = query(collection(db, 'books'), orderBy('createdAt', 'desc'), startAfter(lastDocNode), limit(pageSize));
    } else {
        q = query(collection(db, 'books'), orderBy('createdAt', 'desc'), limit(pageSize));
    }
    const snapshot = await getDocs(q);
    return {
        docs: snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })),
        lastDocNode: snapshot.docs[snapshot.docs.length - 1]
    };
};

export const searchBooks = async (keyword) => {
    const term = keyword.toLowerCase().trim();
    const q = query(
        collection(db, 'books'),
        where('titleLower', '>=', term),
        where('titleLower', '<=', term + '\uf8ff'),
        orderBy('titleLower')
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

export const filterByCategory = async (categoryId) => {
    const q = query(
        collection(db, 'books'),
        where('categoryId', '==', categoryId)
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

export const searchAndFilterClientSide = async (keyword, categoryId) => {
    let baseQuery;

    if (categoryId) {
        baseQuery = query(collection(db, 'books'), where('categoryId', '==', categoryId));
    } else {
        baseQuery = query(collection(db, 'books'), orderBy('createdAt', 'desc'), limit(200));
    }

    const snapshot = await getDocs(baseQuery);
    let results = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    if (keyword) {
        const term = keyword.toLowerCase().trim();
        results = results.filter(b =>
            (b.title && b.title.toLowerCase().includes(term)) ||
            (b.author && b.author.toLowerCase().includes(term))
        );
    }

    return results;
};

import { db, storage } from './firebase-config.js';
import { 
    collection, 
    addDoc, 
    getDocs, 
    updateDoc, 
    doc, 
    deleteDoc,
    increment,
    serverTimestamp,
    onSnapshot,
    query,
    orderBy,
    where,
    limit,
    getDoc
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-storage.js";

// DOM Elements
const getElem = (id) => document.getElementById(id);

export async function uploadCoverImage(file, bookId, onProgress) {
    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!file) {
        throw new Error('Vui lòng chọn ảnh bìa trước khi tải lên');
    }

    if (!validTypes.includes(file.type)) {
        throw new Error('Định dạng file không hợp lệ (chỉ nhận JPG, PNG, WebP)');
    }

    if (file.size > 5 * 1024 * 1024) {
        throw new Error('Kích thước ảnh quá lớn (tối đa 5MB)');
    }

    const imagePath = `covers/${bookId}`;
    const storageRef = ref(storage, imagePath);
    const uploadTask = uploadBytesResumable(storageRef, file);

    const coverUrl = await new Promise((resolve, reject) => {
        uploadTask.on(
            'state_changed',
            (snapshot) => {
                const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                if (onProgress) onProgress(progress);
            },
            (error) => reject(error),
            async () => {
                const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
                resolve(downloadURL);
            }
        );
    });

    return {
        coverUrl,
        imagePath
    };
}

export async function deleteCoverImage(coverUrl) {
    if (!coverUrl || coverUrl.includes('placeholder')) return;

    try {
        const imageRef = ref(storage, coverUrl);
        await deleteObject(imageRef);
        console.log('Da xoa anh cu thanh cong');
    } catch (error) {
        console.error('Loi khi xoa anh:', error);
    }
}

// --- UI Helpers (Toast & Confirm) ---

const showToast = (message, type = 'success') => {
    const container = getElem('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    const bgColor = type === 'success' ? 'bg-emerald-500' : 'bg-rose-500';
    const icon = type === 'success' ? 'ph-check-circle' : 'ph-x-circle';

    toast.className = `${bgColor} text-white px-6 py-3 rounded-xl shadow-lg flex items-center gap-3 animate-fade-in transition-all`;
    toast.innerHTML = `
        <i class="ph-fill ${icon} text-xl"></i>
        <span class="text-sm font-semibold">${message}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(20px)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
};

const showConfirmModal = (message, onConfirm) => {
    const modal = getElem('deleteConfirmModal');
    const msgElem = getElem('confirmMessage');
    const btnConfirm = getElem('btn-confirm-delete');
    const btnCancel = getElem('btn-cancel-delete');

    if (!modal) return;

    if (message) msgElem.textContent = message;
    modal.classList.remove('hidden');
    modal.classList.add('flex');

    const handleConfirm = () => {
        onConfirm();
        closeConfirm();
    };

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

const initCategoriesListener = () => {
    const bookCategorySelect = getElem('book-category');
    if (!bookCategorySelect) return;

    onSnapshot(collection(db, 'categories'), (snapshot) => {
        const currentValue = bookCategorySelect.value;
        bookCategorySelect.innerHTML = '<option value="">Chọn thể loại...</option>';
        
        snapshot.docs.forEach((doc) => {
            const data = doc.data();
            const option = document.createElement('option');
            option.value = doc.id;
            option.setAttribute('data-name', data.categoryName);
            option.textContent = data.categoryName;
            bookCategorySelect.appendChild(option);
        });
        if (currentValue) bookCategorySelect.value = currentValue;
    });
};

const openModal = (isEdit = false, data = null) => {
    const modal = getElem('addBookModal');
    const form = getElem('bookForm');
    const modalTitle = getElem('modalTitle');
    
    if (!modal || !form) return;
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    
    if (isEdit && data) {
        modalTitle.textContent = 'Chỉnh Sửa Sách';
        getElem('book-id').value = data.id;
        getElem('book-title').value = data.title;
        getElem('book-author').value = data.author;
        getElem('book-publisher').value = data.publisher || '';
        getElem('book-category').value = data.categoryId;
        getElem('book-year').value = data.publishYear || '';
        getElem('book-quantity').value = data.totalQuantity;
        getElem('book-duration').value = data.borrowDuration || 14;
        getElem('book-description').value = data.description || '';
        getElem('old-category-id').value = data.categoryId;
        getElem('old-total-quantity').value = data.totalQuantity;
        getElem('old-available-quantity').value = data.availableQuantity;
    } else {
        modalTitle.textContent = 'Thêm Sách Mới';
        form.reset();
        getElem('book-id').value = '';
    }
};

const renderBooks = (books) => {
    const tableBody = getElem('books-table-body');
    const totalSummary = getElem('total-books-summary');
    if (!tableBody) return;

    tableBody.innerHTML = '';
    let totalCount = 0;

    books.forEach(bookSnap => {
        const book = bookSnap.data();
        const id = bookSnap.id;
        totalCount += 1;

        const row = document.createElement('tr');
        row.className = 'hover:bg-slate-50/80 transition-colors group';
        
        let statusClass = 'bg-emerald-50 text-emerald-700';
        let statusDot = 'bg-emerald-500';
        if (book.status === 'Hết sách') {
            statusClass = 'bg-rose-50 text-rose-700';
            statusDot = 'bg-rose-500';
        } else if (book.status === 'Sắp hết' || (book.availableQuantity > 0 && book.availableQuantity < 5)) {
            statusClass = 'bg-orange-50 text-orange-700';
            statusDot = 'bg-orange-500';
        }

        row.innerHTML = `
            <td class="px-3 py-2 font-semibold text-slate-800 truncate max-w-[200px]" title="${book.title}">${book.title}</td>
            <td class="px-3 py-2 text-slate-600 truncate max-w-[150px]">${book.author}</td>
            <td class="px-3 py-2 text-slate-600 truncate max-w-[150px]">${book.publisher || '--'}</td>
            <td class="px-3 py-2">
                <span class="inline-flex px-2 py-0.5 bg-blue-100/70 text-blue-700 text-xs font-medium rounded-full">
                    ${book.categoryName}
                </span>
            </td>
            <td class="px-3 py-2 text-center font-medium">${book.totalQuantity}</td>
            <td class="px-3 py-2 text-center">
                <span class="font-semibold ${book.availableQuantity > 0 ? 'text-emerald-600' : 'text-rose-600'}">
                    ${book.availableQuantity}
                </span>
            </td>
            <td class="px-3 py-2">
                <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${statusClass}">
                    <span class="w-1.5 h-1.5 ${statusDot} rounded-full"></span>
                    ${book.status}
                </span>
            </td>
            <td class="px-1.5 py-2 text-right">
                <div class="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button class="edit-btn p-1 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors" data-id="${id}" title="Chỉnh sửa">
                        <i class="ph ph-pencil text-sm"></i>
                    </button>
                    <button class="delete-btn p-1 text-rose-600 hover:bg-rose-50/50 rounded-lg transition-colors" data-id="${id}" title="Xóa">
                        <i class="ph ph-trash text-sm"></i>
                    </button>
                </div>
            </td>
        `;

        row.querySelector('.delete-btn').addEventListener('click', () => {
            showConfirmModal(`Bạn có chắc muốn xóa sách "${book.title}"?`, () => deleteBook(id, book.title, book.categoryId, book.totalQuantity));
        });
        row.querySelector('.edit-btn').addEventListener('click', () => openModal(true, { id, ...book }));

        tableBody.appendChild(row);
    });

    if (totalSummary) totalSummary.textContent = `${totalCount.toLocaleString()} cuốn`;
};

const deleteBook = async (id, title, categoryId, quantity) => {
    try {
        const borrowRecordsCol = collection(db, 'borrowRecords');
        const qBorrowing = query(
            borrowRecordsCol,
            where('bookId', '==', id),
            where('status', '==', 'borrowing'),
            limit(1)
        );
        const loanSnapshot = await getDocs(qBorrowing);
        
        if (!loanSnapshot.empty) {
            showToast("Sách đang được mượn, không thể xóa!", "error");
            return;
        }

        const bookDoc = await getDoc(doc(db, 'books', id));
        const bookData = bookDoc.data();

        await deleteDoc(doc(db, 'books', id));
        const categoryRef = doc(db, 'categories', categoryId);
        await updateDoc(categoryRef, { bookCount: increment(-quantity) });

        await deleteCoverImage(bookData?.coverUrl || bookData?.imagePath);

        showToast("Đã xóa sách thành công!");
    } catch (error) {
        console.error("Error deleting book:", error);
        showToast("Có lỗi xảy ra khi xóa sách.", "error");
    }
};

const closeModal = () => {
    const modal = getElem('addBookModal');
    const form = getElem('bookForm');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
    if (form) form.reset();
    getElem('imagePreview')?.classList.add('hidden');
};

document.addEventListener('DOMContentLoaded', () => {
    initCategoriesListener();

    // Set max year for publication year input to current year
    const yearInput = getElem('book-year');
    if (yearInput) {
        yearInput.max = new Date().getFullYear();
    }

    onSnapshot(collection(db, 'books'), (snapshot) => {
        const sortedDocs = snapshot.docs.sort((a, b) => {
            const timeA = a.data().createdAt?.toMillis() || 0;
            const timeB = b.data().createdAt?.toMillis() || 0;
            return timeB - timeA;
        });
        renderBooks(sortedDocs);
    });

    getElem('btn-close-modal')?.addEventListener('click', closeModal);
    getElem('btn-cancel-modal')?.addEventListener('click', closeModal);

    getElem('bookForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();

        const bookId = getElem('book-id').value;
        const title = getElem('book-title').value.trim();
        const author = getElem('book-author').value.trim();
        const publisher = getElem('book-publisher').value.trim();
        const categorySelect = getElem('book-category');
        const categoryId = categorySelect.value;
        const categoryName = categorySelect.options[categorySelect.selectedIndex].getAttribute('data-name');
        const year = getElem('book-year').value;
        const totalQuantity = parseInt(getElem('book-quantity').value);
        const borrowDuration = parseInt(getElem('book-duration').value);
        const description = getElem('book-description').value.trim();
        const imageFile = getElem('bookImage')?.files?.[0] || null;

        const currentYear = new Date().getFullYear();
        if (year && parseInt(year) > currentYear) {
            showToast(`Năm xuất bản không thể lớn hơn ${currentYear}!`, "error");
            return;
        }

        if (!title || !author || !categoryId) {
            showToast("Vui lòng điền đủ thông tin!", "error");
            return;
        }

        try {
            if (bookId) {
                const oldTotalQty = parseInt(getElem('old-total-quantity').value);
                const oldAvailQty = parseInt(getElem('old-available-quantity').value);
                const oldCategoryId = getElem('old-category-id').value;
                const diff = totalQuantity - oldTotalQty;
                const newAvailQty = oldAvailQty + diff;

                if (newAvailQty < 0) {
                    showToast("Số lượng không hợp lệ!", "error");
                    return;
                }

                const status = newAvailQty === 0 ? 'Hết sách' : (newAvailQty < 5 ? 'Sắp hết' : 'Còn sách');

                const payload = {
                    title, author, publisher, categoryId, categoryName,
                    publishYear: year || null,
                    totalQuantity, availableQuantity: newAvailQty,
                    borrowDuration, description, status
                };

                if (imageFile) {
                    showToast('Đang tải ảnh bìa...', 'success');
                    const uploadResult = await uploadCoverImage(imageFile, bookId);
                    payload.coverUrl = uploadResult.coverUrl;
                    payload.imagePath = uploadResult.imagePath;
                }

                await updateDoc(doc(db, 'books', bookId), payload);

                if (oldCategoryId === categoryId) {
                    if (diff !== 0) await updateDoc(doc(db, 'categories', categoryId), { bookCount: increment(diff) });
                } else {
                    await updateDoc(doc(db, 'categories', oldCategoryId), { bookCount: increment(-oldTotalQty) });
                    await updateDoc(doc(db, 'categories', categoryId), { bookCount: increment(totalQuantity) });
                }
                showToast("Cập nhật thành công!");
            } else {
                const newBookRef = await addDoc(collection(db, 'books'), {
                    title, author, publisher, categoryId, categoryName,
                    publishYear: year || null,
                    totalQuantity, availableQuantity: totalQuantity,
                    borrowDuration, description, status: 'Còn sách',
                    createdAt: serverTimestamp()
                });

                if (imageFile) {
                    showToast('Đang tải ảnh bìa...', 'success');
                    const uploadResult = await uploadCoverImage(imageFile, newBookRef.id);
                    await updateDoc(doc(db, 'books', newBookRef.id), {
                        coverUrl: uploadResult.coverUrl,
                        imagePath: uploadResult.imagePath
                    });
                }

                await updateDoc(doc(db, 'categories', categoryId), { bookCount: increment(totalQuantity) });
                showToast("Thêm sách thành công!");
            }
            closeModal();
        } catch (error) {
            console.error("Error saving book:", error);
            showToast("Lỗi khi lưu dữ liệu.", "error");
        }
    });
});

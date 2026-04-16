import { db, storage } from './firebase-config.js';
import { collection, addDoc, updateDoc, doc, deleteDoc, serverTimestamp, onSnapshot, query, orderBy, getDoc, getDocs, limit, startAfter, where } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";
import { ref, uploadBytesResumable, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-storage.js";

const getElem = (id) => document.getElementById(id);

// --- 1. Toast Thông báo (Cải tiến) ---
const showToast = (message, type = 'success') => {
    const container = getElem('toast-container');
    if (!container) return { update: () => {}, close: () => {} };
    
    const toast = document.createElement('div');
    const bg = type === 'success' ? 'bg-emerald-500' : (type === 'info' ? 'bg-blue-500' : 'bg-rose-500');
    toast.className = `${bg} text-white px-6 py-3 rounded-xl shadow-lg flex items-center gap-3 animate-fade-in mb-3 transition-all z-[100]`;
    toast.innerHTML = `<i class="ph-fill ${type === 'success' ? 'ph-check-circle' : 'ph-info-circle'} text-xl"></i><span class="msg-text text-sm font-semibold">${message}</span>`;
    
    container.appendChild(toast);
    const close = () => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); };
    if (type !== 'info') setTimeout(close, 3000);
    
    return { 
        update: (newMsg) => { const txt = toast.querySelector('.msg-text'); if(txt) txt.innerText = newMsg; },
        close
    };
};

// --- 2. Khởi tạo Trang ---
let adminAllBooks = [];
let adminCurrentPage = 1;
const adminPageSize = 10;

const initAdminBooks = () => {
    const tableBody = getElem('books-table-body');
    if (!tableBody) return;

    console.log("System: Admin Books Module Loaded");

    // Lắng nghe Thể loại
    onSnapshot(collection(db, 'categories'), (snap) => {
        const select = getElem('book-category');
        if (!select) return;
        const current = select.value;
        select.innerHTML = '<option value="">Chọn thể loại...</option>' + 
            snap.docs.map(d => `<option value="${d.id}" data-name="${d.data().categoryName}">${d.data().categoryName}</option>`).join('');
        select.value = current;
    });

    // Lắng nghe Danh sách Sách
    onSnapshot(query(collection(db, 'books'), orderBy('createdAt', 'desc')), (snap) => {
        adminAllBooks = snap.docs;
        renderAdminPage();
    });

    // Sự kiện Form
    const form = getElem('bookForm');
    if (form) {
        form.onsubmit = async (e) => {
            e.preventDefault();
            // Tìm nút submit của form này (có thể nằm ngoài thẻ form)
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
};

const renderAdminPage = () => {
    const totalCount = adminAllBooks.length;
    const totalPages = Math.ceil(totalCount / adminPageSize);
    
    if (adminCurrentPage > totalPages) adminCurrentPage = totalPages;
    if (adminCurrentPage < 1) adminCurrentPage = 1;
    
    const startIdx = (adminCurrentPage - 1) * adminPageSize;
    const endIdx = startIdx + adminPageSize;
    const docsToRender = adminAllBooks.slice(startIdx, endIdx);
    
    renderBooksTable(docsToRender, totalCount);
    renderAdminPagination(totalCount, totalPages);
};

const renderBooksTable = (docs, totalCount) => {
    const tableBody = getElem('books-table-body');
    if (!tableBody) return;

    tableBody.innerHTML = docs.map(snap => {
        const book = snap.data();
        const id = snap.id;
        const avail = book.availableQuantity || 0;
        const statusClass = avail === 0 ? 'bg-rose-50 text-rose-700' : (avail < 5 ? 'bg-orange-50 text-orange-700' : 'bg-emerald-50 text-emerald-700');
        const statusDot = avail === 0 ? 'bg-rose-500' : (avail < 5 ? 'bg-orange-500' : 'bg-emerald-500');

        return `
            <tr class="hover:bg-slate-50/80 transition-colors group">
                <td class="px-3 py-2"><div class="w-10 h-14 rounded-md overflow-hidden bg-slate-100 border border-slate-200"><img src="${book.coverUrl || '../assets/images/book_cover_2.png'}" class="w-full h-full object-cover" onerror="this.src='../assets/images/book_cover_2.png'"></div></td>
                <td class="px-3 py-2 font-semibold text-slate-800 truncate max-w-[200px]">${book.title}</td>
                <td class="px-3 py-2 text-slate-600 truncate max-w-[120px]">${book.author}</td>
                <td class="px-3 py-2 text-slate-600 truncate max-w-[120px]">${book.publisher || '--'}</td>
                <td class="px-3 py-2"><span class="px-2 py-0.5 bg-blue-100 text-blue-700 text-[10px] font-bold rounded-full">${book.categoryName}</span></td>
                <td class="px-3 py-2 text-center">${book.totalQuantity}</td>
                <td class="px-3 py-2 text-center font-bold ${avail > 0 ? 'text-emerald-600' : 'text-rose-600'}">${avail}</td>
                <td class="px-3 py-2"><span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${statusClass}"><span class="w-1.5 h-1.5 ${statusDot} rounded-full"></span> ${avail > 0 ? 'Còn sách' : 'Hết sách'}</span></td>
                <td class="px-1.5 py-2 text-right">
                    <div class="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onclick="editBookAction('${id}')" class="p-1.5 text-slate-600 hover:bg-slate-100 rounded-lg"><i class="ph ph-pencil"></i></button>
                        <button onclick="deleteBookAction('${id}', '${book.title.replace(/'/g, "\\'")}')" class="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg"><i class="ph ph-trash"></i></button>
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

// --- 3. Xử lý Lưu dữ liệu ---
const handleSaveBook = async () => {
    const id = getElem('book-id').value;
    const title = getElem('book-title').value.trim();
    const author = getElem('book-author').value.trim();
    const catSelect = getElem('book-category');
    const file = getElem('bookImage').files[0];

    if (!title || !author || !catSelect.value) {
        throw new Error("Vui lòng điền đầy đủ Tên sách, Tác giả và Thể loại!");
    }

    const qty = parseInt(getElem('book-quantity').value) || 0;
    const data = {
        title, author,
        publisher: getElem('book-publisher').value.trim(),
        categoryId: catSelect.value,
        categoryName: catSelect.options[catSelect.selectedIndex].getAttribute('data-name'),
        publishYear: getElem('book-year').value || null,
        titleLower: title.toLowerCase(),
        totalQuantity: qty,
        availableQuantity: qty,
        borrowDuration: parseInt(getElem('book-duration').value) || 14,
        description: getElem('book-description').value.trim(),
        updatedAt: serverTimestamp()
    };

    let bookId = id;
    if (id) {
        await updateDoc(doc(db, 'books', id), data);
    } else {
        data.createdAt = serverTimestamp();
        const newDoc = await addDoc(collection(db, 'books'), data);
        bookId = newDoc.id;
    }

    // Đóng modal và reset form ngay để tạo cảm giác nhanh
    getElem('addBookModal').classList.replace('flex', 'hidden');
    getElem('bookForm').reset();

    // Xử lý tải ảnh bìa (chạy ngầm)
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

// --- 4. Các hành động Global ---
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
        getElem('book-duration').value = book.borrowDuration || 14;
        getElem('book-description').value = book.description || '';
        
        getElem('modalTitle').textContent = "Chỉnh Sửa Sách";
        getElem('addBookModal').classList.replace('hidden', 'flex');
    } catch (e) { showToast("Lỗi khi lấy thông tin sách", "error"); }
};

window.deleteBookAction = async (id, title) => {
    if (confirm(`Bạn có chắc chắn muốn xóa sách "${title}"?`)) {
        try {
            await deleteDoc(doc(db, 'books', id));
            showToast("Đã xóa sách thành công.");
        } catch (e) { showToast("Lỗi khi xóa sách", "error"); }
    }
};

// --- 5. Khởi chạy ---
document.addEventListener('turbo:load', initAdminBooks);
document.addEventListener('turbo:render', initAdminBooks);
if (document.readyState !== 'loading') initAdminBooks();
else document.addEventListener('DOMContentLoaded', initAdminBooks);

// --- 6. Thành viên 5 - Tìm kiếm & Phân trang ---
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
    // Prefix search with >= and <= trick
    const q = query(
        collection(db, 'books'),
        where('titleLower', '>=', term),
        where('titleLower', '<=', term + '\uf8ff'),
        orderBy('titleLower') // Required when using range filter
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

// Kết hợp tìm kiếm và lọc: dùng trên client vì Firestore hạn chế
export const searchAndFilterClientSide = async (keyword, categoryId) => {
    let baseQuery;
    
    if (categoryId) {
        // Lấy theo danh mục trước (tiện nhất). Loại bỏ orderBy để tương thích data cũ chưa có trường createdAt và không cần composite index
        baseQuery = query(collection(db, 'books'), where('categoryId', '==', categoryId));
    } else {
        // Lấy tất cả gần đây (thay vì fetch all)
        baseQuery = query(collection(db, 'books'), orderBy('createdAt', 'desc'), limit(200)); 
    }
    
    const snapshot = await getDocs(baseQuery);
    let results = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    // Áp dụng bộ lọc từ khóa trên client-side
    if (keyword) {
        const term = keyword.toLowerCase().trim();
        results = results.filter(b => 
            (b.title && b.title.toLowerCase().includes(term)) || 
            (b.author && b.author.toLowerCase().includes(term))
        );
    }
    
    return results;
};

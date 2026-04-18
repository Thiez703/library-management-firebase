import { db } from './firebase-config.js';
import { requireAdmin } from './admin-guard.js';
import {
    collection,
    onSnapshot,
    query,
    where,
    getDocs,
    addDoc,
    updateDoc,
    doc,
    limit,
    orderBy,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";
import { showToast } from './auth.js';
const getElem = (id) => document.getElementById(id);

const state = {
    readers: [],
    borrowingCountByUser: new Map(),
    overdueRecords: 0,
    searchTerm: '',
    selectedReaderId: '',
    currentPage: 1,
    itemsPerPage: 10
};

const pageStartInfo = getElem('page-start-info');
const pageEndInfo = getElem('page-end-info');
const totalItemsInfo = getElem('total-items-info');
const paginationControls = getElem('pagination-controls');

let unsubscribeUsers = null;
let unsubscribeBorrowing = null;

const escapeHtml = (value = '') => value
    .toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const makeMemberCode = (id, user) => {
    const code = (user?.memberCode || user?.readerCode || '').toString().trim();
    if (code) return code;
    return `US-${id.slice(0, 6).toUpperCase()}`;
};

const makeInitials = (displayName, email) => {
    const base = (displayName || email || 'DG').toString().trim();
    const words = base.split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
        return (words[0][0] + words[words.length - 1][0]).toUpperCase();
    }
    return base.slice(0, 2).toUpperCase();
};

const normalizeStatus = (user) => {
    const status = (user?.status || user?.accountStatus || '').toString().toLowerCase();
    if (['disabled', 'locked', 'blocked', 'inactive', 'banned'].includes(status)) {
        return {
            label: 'Tạm khóa',
            rowClass: 'bg-slate-100 text-slate-600',
            dotClass: 'bg-slate-500',
            isActive: false
        };
    }

    return {
        label: 'Hoạt động',
        rowClass: 'bg-emerald-50 text-emerald-700',
        dotClass: 'bg-emerald-500',
        isActive: true
    };
};

const renderStats = () => {
    const total = state.readers.length;
    const active = state.readers.filter((item) => normalizeStatus(item.data).isActive).length;
    const borrowingReaders = Array.from(state.borrowingCountByUser.values()).filter((count) => count > 0).length;

    getElem('stat-total-readers').textContent = total.toLocaleString('vi-VN');
    getElem('stat-active-readers').textContent = active.toLocaleString('vi-VN');
    getElem('stat-borrowing-readers').textContent = borrowingReaders.toLocaleString('vi-VN');
    getElem('stat-overdue-records').textContent = state.overdueRecords.toLocaleString('vi-VN');
};

const renderTable = () => {
    const body = getElem('readersTableBody');
    if (!body) return;

    const term = state.searchTerm.toLowerCase();
    const rows = state.readers.filter((item) => {
        if (!term) return true;

        const user = item.data || {};
        const displayName = (user.displayName || user.fullName || '').toString().toLowerCase();
        const email = (user.email || '').toString().toLowerCase();
        const phone = (user.phone || user.phoneNumber || '').toString().toLowerCase();
        const code = makeMemberCode(item.id, user).toLowerCase();

        return displayName.includes(term) || email.includes(term) || phone.includes(term) || code.includes(term);
    });

    if (rows.length === 0) {
        body.innerHTML = '<tr><td colspan="6" class="px-6 py-10 text-center text-slate-500">Không có độc giả phù hợp.</td></tr>';
        
        if (pageStartInfo) pageStartInfo.textContent = '0';
        if (pageEndInfo) pageEndInfo.textContent = '0';
        if (totalItemsInfo) totalItemsInfo.textContent = '0';
        if (paginationControls) paginationControls.innerHTML = '';
        return;
    }

    const { itemsPerPage } = state;
    const totalItems = rows.length;
    const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;
    
    if (state.currentPage > totalPages) state.currentPage = totalPages;
    if (state.currentPage < 1) state.currentPage = 1;

    const startIndex = (state.currentPage - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, totalItems);
    
    if (pageStartInfo) pageStartInfo.textContent = totalItems === 0 ? 0 : startIndex + 1;
    if (pageEndInfo) pageEndInfo.textContent = endIndex;
    if (totalItemsInfo) totalItemsInfo.textContent = totalItems;

    const currentRows = rows.slice(startIndex, endIndex);

    body.innerHTML = currentRows.map((item) => {
        const user = item.data || {};
        const uid = item.id;
        const displayName = (user.displayName || user.fullName || user.email || 'Độc giả').toString();
        const phone = (user.phone || user.phoneNumber || '---').toString();
        const email = (user.email || '---').toString();
        const memberCode = makeMemberCode(uid, user);
        const borrowingCount = Number(state.borrowingCountByUser.get(uid) || user.borrowingCount || 0);
        const status = normalizeStatus(user);
        const initials = makeInitials(displayName, email);
        const isLocked = !status.isActive;

        return `
            <tr class="hover:bg-slate-50/80 transition-colors group" data-uid="${uid}">
                <td class="px-6 py-4">
                    <div class="flex items-center gap-3">
                        <div class="w-9 h-9 rounded-full bg-violet-100 text-violet-600 flex items-center justify-center font-bold text-sm">${escapeHtml(initials)}</div>
                        <div>
                            <p class="font-semibold text-slate-800">${escapeHtml(displayName)}</p>
                            <p class="text-xs text-slate-500">${escapeHtml(phone)}</p>
                        </div>
                    </div>
                </td>
                <td class="px-6 py-4 font-mono text-xs text-slate-600">${escapeHtml(memberCode)}</td>
                <td class="px-6 py-4 text-slate-600">${escapeHtml(email)}</td>
                <td class="px-6 py-4 text-center font-semibold">${borrowingCount.toLocaleString('vi-VN')}</td>
                <td class="px-6 py-4">
                    <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${status.rowClass}">
                        <span class="w-1.5 h-1.5 rounded-full ${status.dotClass}"></span>${status.label}
                    </span>
                </td>
                <td class="px-6 py-4 text-right">
                    <div class="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button title="Xem chi tiết" data-action="view" data-uid="${uid}" class="p-1.5 text-blue-600 hover:bg-blue-50 rounded-md"><i class="ph ph-eye text-lg"></i></button>
                        <button title="Chỉnh sửa" data-action="edit" data-uid="${uid}" class="p-1.5 text-slate-600 hover:bg-slate-100 rounded-md"><i class="ph ph-pencil-simple text-lg"></i></button>
                        <button title="${isLocked ? 'Mở khóa' : 'Khóa'} tài khoản" data-action="lock" data-uid="${uid}" data-locked="${isLocked}" class="p-1.5 ${isLocked ? 'text-emerald-600 hover:bg-emerald-50' : 'text-rose-600 hover:bg-rose-50'} rounded-md"><i class="ph ph-${isLocked ? 'lock-open' : 'lock'} text-lg"></i></button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    // Gắn event listener sau khi render
    body.querySelectorAll('[data-action]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            const action = btn.getAttribute('data-action');
            const uid = btn.getAttribute('data-uid');
            const readerItem = state.readers.find((r) => r.id === uid);
            if (!readerItem) return;

            if (action === 'view') openReaderDetail(uid, readerItem.data);
            else if (action === 'edit') openReaderEdit(uid, readerItem.data);
            else if (action === 'lock') toggleLockReader(uid, readerItem.data);
        });
    });

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
            renderTable();
        });
    }
    paginationControls.appendChild(prevBtn);

    // Page Numbers
    for (let i = 1; i <= totalPages; i++) {
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
            renderTable();
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
            renderTable();
        });
    }
    paginationControls.appendChild(nextBtn);
};

const renderAll = () => {
    renderStats();
    renderTable();
};

// ─── MODAL: XEM CHI TI\u1ebcT \u0110\u1ed8C GI\u1ea2 ───────────────────────────────────────────────

const openReaderDetail = async (uid, userData) => {
    state.selectedReaderId = uid;
    const displayName = userData?.displayName || userData?.fullName || userData?.email || '\u0110\u1ed9c gi\u1ea3';
    const initials = makeInitials(displayName, userData?.email || '');
    const status = normalizeStatus(userData);
    const borrowingCount = Number(state.borrowingCountByUser.get(uid) || 0);
    const memberCode = makeMemberCode(uid, userData);

    // Populate modal
    const avatar = getElem('readerDetailAvatar');
    if (avatar) avatar.textContent = initials;

    const setText = (id, val) => { const el = getElem(id); if (el) el.textContent = val || '--'; };
    setText('readerDetailName', displayName);
    setText('readerDetailCode', memberCode);
    setText('readerDetailEmail', userData?.email || '--');
    setText('readerDetailPhone', userData?.phone || userData?.phoneNumber || '--');
    setText('readerDetailRole', userData?.role === 'admin' ? 'Qu\u1ea3n tr\u1ecb vi\u00ean' : '\u0110\u1ed9c gi\u1ea3');
    setText('readerDetailStatus', status.label);
    setText('readerDetailBorrowing', `${borrowingCount} cu\u1ed1n`);

    const createdAt = userData?.createdAt;
    if (createdAt && typeof createdAt.toDate === 'function') {
        setText('readerDetailCreatedAt', createdAt.toDate().toLocaleDateString('vi-VN'));
    } else {
        setText('readerDetailCreatedAt', '--');
    }

    // C\u1eadp nh\u1eadt n\u00fat kh\u00f3a
    const lockBtn = getElem('readerDetailLockBtn');
    if (lockBtn) {
        lockBtn.innerHTML = status.isActive
            ? '<i class="ph ph-lock mr-1"></i> Kh\u00f3a t\u00e0i kho\u1ea3n'
            : '<i class="ph ph-lock-open mr-1"></i> M\u1edf kh\u00f3a t\u00e0i kho\u1ea3n';
        lockBtn.className = `flex-1 px-4 py-2.5 rounded-xl border font-semibold text-sm transition-colors ${
            status.isActive
                ? 'border-rose-200 text-rose-600 hover:bg-rose-50'
                : 'border-emerald-200 text-emerald-600 hover:bg-emerald-50'
        }`;
        lockBtn.onclick = () => toggleLockReader(uid, userData);
    }

    // N\u00fat s\u1eeda
    const editBtn = getElem('readerDetailEditBtn');
    if (editBtn) editBtn.onclick = () => openReaderEdit(uid, userData);

    // Hi\u1ec3n th\u1ecb modal
    getElem('readerDetailModal')?.classList.remove('hidden');

    // T\u1ea3i l\u1ecbch s\u1eed m\u01b0\u1ee3n
    const historyContainer = getElem('readerDetailHistory');
    if (historyContainer) {
        historyContainer.innerHTML = '<p class="text-sm text-slate-400">Đang tải...</p>';
        try {
            const snap = await getDocs(query(
                collection(db, 'borrowRecords'),
                where('userId', '==', uid),
                orderBy('requestDate', 'desc'),
                limit(5)
            ));
            if (snap.empty) {
                historyContainer.innerHTML = '<p class="text-sm text-slate-400">Ch\u01b0a c\u00f3 phi\u1ebfu m\u01b0\u1ee3n n\u00e0o.</p>';
            } else {
                historyContainer.innerHTML = snap.docs.map(d => {
                    const r = d.data();
                    const statusMap = { pending: '\u2022 Ch\u1edd duy\u1ec7t', borrowing: '\u2022 \u0110ang m\u01b0\u1ee3n', returned: '\u2022 \u0110\u00e3 tr\u1ea3', cancelled: '\u2022 \u0110\u00e3 hu\u1ef7' };
                    const booksText = Array.isArray(r.books) ? r.books.map(b => b.title).join(', ') : '--';
                    const dateStr = r.requestDate?.toDate ? r.requestDate.toDate().toLocaleDateString('vi-VN') : '--';
                    return `<div class="rounded-xl border border-slate-100 p-3 text-sm">
                        <div class="flex justify-between items-start gap-2">
                            <p class="font-mono text-xs text-slate-500">${r.recordId || d.id}</p>
                            <span class="text-xs font-semibold text-slate-600">${statusMap[r.status] || r.status}</span>
                        </div>
                        <p class="text-slate-700 mt-1 truncate">${booksText}</p>
                        <p class="text-xs text-slate-400 mt-1">${dateStr}</p>
                    </div>`;
                }).join('');
            }
        } catch {
            historyContainer.innerHTML = '<p class="text-sm text-rose-500">Kh\u00f4ng th\u1ec3 t\u1ea3i l\u1ecbch s\u1eed.</p>';
        }
    }
};

// ─── MODAL: CH\u1ec8NH S\u1eeeA \u0110\u1ed8C GI\u1ea2 ───────────────────────────────────────────────────

const openReaderEdit = (uid, userData) => {
    state.selectedReaderId = uid;
    const nameInput = getElem('editReaderName');
    const phoneInput = getElem('editReaderPhone');
    const emailInput = getElem('editReaderEmail');
    const idInput = getElem('editReaderId');

    if (idInput) idInput.value = uid;
    if (nameInput) nameInput.value = userData?.displayName || userData?.fullName || '';
    if (phoneInput) phoneInput.value = userData?.phone || userData?.phoneNumber || '';
    if (emailInput) emailInput.value = userData?.email || '';

    // \u0110\u00f3ng detail modal, m\u1edf edit modal
    getElem('readerDetailModal')?.classList.add('hidden');
    getElem('readerEditModal')?.classList.remove('hidden');
};

// ─── KH\u00d3A / M\u1ede KH\u00d3A T\u00c0I KHO\u1ea2N ────────────────────────────────────────────────────

const toggleLockReader = async (uid, userData) => {
    const status = normalizeStatus(userData);
    const isCurrentlyActive = status.isActive;
    const newStatus = isCurrentlyActive ? 'locked' : 'active';
    const actionLabel = isCurrentlyActive ? 'kh\u00f3a' : 'm\u1edf kh\u00f3a';

    try {
        await updateDoc(doc(db, 'users', uid), {
            status: newStatus,
            updatedAt: serverTimestamp()
        });
        showToast(`\u0110\u00e3 ${actionLabel} t\u00e0i kho\u1ea3n th\u00e0nh c\u00f4ng.`, 'success');
        getElem('readerDetailModal')?.classList.add('hidden');
    } catch (err) {
        showToast(err.message || `Kh\u00f4ng th\u1ec3 ${actionLabel} t\u00e0i kho\u1ea3n.`, 'error');
    }
};

// ─── BIND MODALS \u0110\u1ed8C GI\u1ea2 ──────────────────────────────────────────────────────────

const bindReaderModals = () => {
    // Detail modal
    getElem('closeReaderDetailModal')?.addEventListener('click', () => {
        getElem('readerDetailModal')?.classList.add('hidden');
        state.selectedReaderId = '';
    });

    // Edit modal
    getElem('closeReaderEditModal')?.addEventListener('click', () => {
        getElem('readerEditModal')?.classList.add('hidden');
    });
    getElem('cancelReaderEditBtn')?.addEventListener('click', () => {
        getElem('readerEditModal')?.classList.add('hidden');
    });

    // Submit edit form
    getElem('readerEditForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const uid = getElem('editReaderId')?.value;
        if (!uid) return;

        const displayName = (getElem('editReaderName')?.value || '').trim();
        const phone = (getElem('editReaderPhone')?.value || '').trim();
        const email = (getElem('editReaderEmail')?.value || '').trim();

        if (!displayName) { showToast('Vui l\u00f2ng nh\u1eadp h\u1ecd t\u00ean.', 'error'); return; }

        try {
            await updateDoc(doc(db, 'users', uid), {
                displayName,
                phone,
                email,
                updatedAt: serverTimestamp()
            });
            showToast('\u0110\u00e3 c\u1eadp nh\u1eadt th\u00f4ng tin \u0111\u1ed9c gi\u1ea3 th\u00e0nh c\u00f4ng.', 'success');
            getElem('readerEditModal')?.classList.add('hidden');
        } catch (err) {
            showToast(err.message || 'Kh\u00f4ng th\u1ec3 c\u1eadp nh\u1eadt th\u00f4ng tin.', 'error');
        }
    });
};

const bindSearch = () => {
    const searchInput = getElem('readerSearchInput');
    if (!searchInput || searchInput.dataset.bound === '1') return;

    searchInput.addEventListener('input', () => {
        state.searchTerm = (searchInput.value || '').trim();
        state.currentPage = 1;
        renderTable();
    });

    searchInput.dataset.bound = '1';
};

const initReaders = () => {
    bindSearch();
    initGuestReaderUI();
    bindReaderModals();

    if (unsubscribeUsers) unsubscribeUsers();
    if (unsubscribeBorrowing) unsubscribeBorrowing();

    unsubscribeUsers = onSnapshot(collection(db, 'users'), (snapshot) => {
        state.readers = snapshot.docs
            .map((docSnap) => ({ id: docSnap.id, data: docSnap.data() || {} }))
            .filter((item) => {
                const role = (item.data.role || '').toString().toLowerCase();
                return role !== 'admin';
            });

        renderAll();
    });

    const borrowingQuery = query(collection(db, 'borrowRecords'), where('status', '==', 'borrowing'));
    unsubscribeBorrowing = onSnapshot(borrowingQuery, (snapshot) => {
        const map = new Map();
        let overdue = 0;
        const now = Date.now();

        snapshot.forEach((docSnap) => {
            const data = docSnap.data() || {};
            const userId = data.userId;
            const books = Array.isArray(data.books) ? data.books : [];
            const borrowedQty = Math.max(1, books.length);

            if (userId) {
                map.set(userId, (map.get(userId) || 0) + borrowedQty);
            }

            const dueMs = typeof data.dueDate?.toMillis === 'function' ? data.dueDate.toMillis() : null;
            if (dueMs && dueMs < now) {
                overdue += 1;
            }
        });

        state.borrowingCountByUser = map;
        state.overdueRecords = overdue;
        renderAll();
    });
};

    const createGuestReader = async (fullName, phone, cccd, email = '', note = '') => {
        if (!fullName?.trim() || !phone?.trim() || !cccd?.trim()) {
            showToast('Vui lòng điền đầy đủ Họ tên, Số điện thoại và CCCD.', 'error');
            return;
        }

        try {
            const docRef = await addDoc(collection(db, 'users'), {
                displayName: fullName.trim(),
                email: email.trim() || '',
                phone: phone.trim(),
                role: 'user',
                status: 'active',
                accountType: 'guest',
                userDetails: {
                    fullName: fullName.trim(),
                    phone: phone.trim(),
                    cccd: cccd.trim(),
                    email: email.trim() || ''
                },
                guestNote: note.trim() || '',
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            });

            showToast(`✓ Tạo độc giả vãng lai thành công! ID: ${docRef.id}`, 'success');
        
            // Đóng modal
            getElem('guestReaderModal')?.classList.add('hidden');
        
            // Reset form
            getElem('guestReaderForm')?.reset();
        
            return docRef.id;
        } catch (error) {
            console.error('Lỗi tạo độc giả vãng lai:', error);
            showToast('Lỗi: ' + (error.message || 'Không thể tạo độc giả'), 'error');
        }
    };

    const bindGuestReaderModal = () => {
        const openBtn = getElem('addGuestReaderBtn');
        const closeBtn = getElem('closeGuestReaderModal');
        const cancelBtn = getElem('cancelGuestReaderBtn');
        const modal = getElem('guestReaderModal');
        const form = getElem('guestReaderForm');

        if (form?.dataset.bound === '1') return;

        if (openBtn) {
            openBtn.addEventListener('click', () => {
                modal?.classList.remove('hidden');
                form?.reset();
            });
        }

        if (closeBtn || cancelBtn) {
            const closeModal = () => modal?.classList.add('hidden');
            closeBtn?.addEventListener('click', closeModal);
            cancelBtn?.addEventListener('click', closeModal);
        }

        if (form) {
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                const fullName = getElem('guestFullName')?.value || '';
                const phone = getElem('guestPhone')?.value || '';
                const cccd = getElem('guestCccd')?.value || '';
                const email = getElem('guestEmail')?.value || '';
                const note = getElem('guestNote')?.value || '';

                await createGuestReader(fullName, phone, cccd, email, note);
            });
            form.dataset.bound = '1';
        }
    };

    const initGuestReaderUI = () => {
        bindGuestReaderModal();
    };

// Khởi chạy — bảo vệ bằng admin guard
const guardedInit = () => requireAdmin(() => initReaders());
document.addEventListener('turbo:load', guardedInit);
document.addEventListener('turbo:render', guardedInit);
if (document.readyState !== 'loading') guardedInit();
else document.addEventListener('DOMContentLoaded', guardedInit);

import { db } from './firebase-config.js';
import {
    collection,
    onSnapshot,
    query,
    where
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

const getElem = (id) => document.getElementById(id);

const state = {
    readers: [],
    borrowingCountByUser: new Map(),
    overdueRecords: 0,
    searchTerm: '',
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

        return `
            <tr class="hover:bg-slate-50/80 transition-colors group">
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
                        <button title="Xem chi tiết" class="p-1.5 text-blue-600 hover:bg-blue-50 rounded-md"><i class="ph ph-eye text-lg"></i></button>
                        <button title="Chỉnh sửa" class="p-1.5 text-slate-600 hover:bg-slate-100 rounded-md"><i class="ph ph-pencil-simple text-lg"></i></button>
                        <button title="Khóa tài khoản" class="p-1.5 text-rose-600 hover:bg-rose-50 rounded-md"><i class="ph ph-lock text-lg"></i></button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

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

document.addEventListener('turbo:load', initReaders);
document.addEventListener('turbo:render', initReaders);
if (document.readyState !== 'loading') initReaders();
else document.addEventListener('DOMContentLoaded', initReaders);

import { approveTicket, calculateFineAmount, getActiveFeeSchedule, cleanupLegacyBorrowRecords, extendTicket, getTicketStatusView, returnTicket, subscribeAllTickets, BORROW_DURATION_DAYS } from './borrow.js';
import { showToast } from './auth.js';
import { requireAdmin } from './admin-guard.js';
import { db } from './firebase-config.js';
import {
    collection,
    onSnapshot,
    Timestamp,
    addDoc,
    runTransaction,
    doc,
    getDoc,
    increment,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

// BIZ-09: Đọc thời hạn mượn từ settings
const getBorrowDurationFromSettings = async () => {
    try {
        const snap = await getDoc(doc(db, 'system', 'settings'));
        const duration = snap.exists() ? Number(snap.data()?.library?.borrowDurationDays) : NaN;
        return Number.isFinite(duration) && duration > 0 ? duration : BORROW_DURATION_DAYS;
    } catch {
        return BORROW_DURATION_DAYS;
    }
};

const getElem = (id) => document.getElementById(id);

const state = {
    tickets: [],
    activeTab: 'pending',
    search: '',
    selectedApproveId: '',
    selectedDetailId: '',
    selectedReturnId: '',
    selectedExtendId: '',
    currentPage: 1,
    itemsPerPage: 10,
    feeSchedule: null
};

const pageStartInfo = getElem('page-start-info');
const pageEndInfo = getElem('page-end-info');
const totalItemsInfo = getElem('total-items-info');
const paginationControls = getElem('pagination-controls');

const formatDate = (tsLike) => {
    if (!tsLike || typeof tsLike.toDate !== 'function') return '--';
    return tsLike.toDate().toLocaleDateString('vi-VN');
};

const formatMoney = (value) => `${Number(value || 0).toLocaleString('vi-VN')} đ`;

const toMs = (tsLike) => {
    if (!tsLike || typeof tsLike.toMillis !== 'function') return null;
    return tsLike.toMillis();
};

const escapeHtml = (value = '') => value
    .toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const normalizeText = (value = '') => value
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

// ============================================================
// Filter
// ============================================================
const getFiltered = () => {
    const term = normalizeText(state.search);

    const byTab = state.tickets.filter((ticket) => {
        const view = getTicketStatusView(ticket);
        if (state.activeTab === 'pending') return ticket.status === 'pending';
        if (state.activeTab === 'borrowing') return view === 'borrowing';
        if (state.activeTab === 'overdue') return view === 'overdue';
        if (state.activeTab === 'returned') return ticket.status === 'returned';
        return false;
    });

    if (!term) return byTab;

    return byTab.filter((ticket) => {
        const recordId = normalizeText(ticket.recordId || '');
        const phone = normalizeText(ticket.userDetails?.phone || '');
        const cccd = normalizeText(ticket.userDetails?.cccd || '');
        const fullName = normalizeText(ticket.userDetails?.fullName || '');
        return recordId.includes(term) || phone.includes(term) || cccd.includes(term) || fullName.includes(term);
    });
};

// ============================================================
// Stats
// ============================================================
const isDueToday = (ticket) => {
    if (ticket.status !== 'borrowing') return false;
    const dueMs = toMs(ticket.dueDate);
    if (!dueMs) return false;
    const today = new Date();
    const due = new Date(dueMs);
    return today.getDate() === due.getDate() && today.getMonth() === due.getMonth() && today.getFullYear() === due.getFullYear();
};

const renderStats = () => {
    const pendingCount = state.tickets.filter(t => t.status === 'pending').length;
    const borrowingCount = state.tickets.filter(t => getTicketStatusView(t) === 'borrowing').length;
    const overdueCount = state.tickets.filter(t => getTicketStatusView(t) === 'overdue').length;
    const returnedCount = state.tickets.filter(t => t.status === 'returned').length;
    const dueTodayCount = state.tickets.filter(isDueToday).length;

    const set = (id, val) => { const el = getElem(id); if (el) el.textContent = String(val); };

    set('stat-pending', pendingCount);
    set('stat-borrowing', borrowingCount);
    set('stat-overdue', overdueCount);
    set('stat-due-today', dueTodayCount);

    set('pendingCount', pendingCount);
    set('borrowingCount', borrowingCount);
    set('overdueCount', overdueCount);
    set('returnedCount', returnedCount);
};

// ============================================================
// Table Headers
// ============================================================
const TABLE_HEADERS = {
    pending: [
        { label: 'Mã phiếu', cls: 'px-4 py-3' },
        { label: 'Độc giả', cls: 'px-4 py-3' },
        { label: 'SĐT', cls: 'px-4 py-3' },
        { label: 'Số sách', cls: 'px-4 py-3 text-center' },
        { label: 'Thời gian chờ', cls: 'px-4 py-3' },
        { label: 'Thao tác', cls: 'px-4 py-3 text-right' }
    ],
    borrowing: [
        { label: 'Mã phiếu', cls: 'px-4 py-3' },
        { label: 'Độc giả', cls: 'px-4 py-3' },
        { label: 'SĐT', cls: 'px-4 py-3' },
        { label: 'Số sách', cls: 'px-4 py-3 text-center' },
        { label: 'Ngày mượn', cls: 'px-4 py-3' },
        { label: 'Thời hạn', cls: 'px-4 py-3' },
        { label: 'Thao tác', cls: 'px-4 py-3 text-right' }
    ],
    overdue: [
        { label: 'Mã phiếu', cls: 'px-4 py-3' },
        { label: 'Độc giả', cls: 'px-4 py-3' },
        { label: 'SĐT', cls: 'px-4 py-3' },
        { label: 'Ngày quá hạn', cls: 'px-4 py-3' },
        { label: 'Phạt tạm tính', cls: 'px-4 py-3' },
        { label: 'Thao tác', cls: 'px-4 py-3 text-right' }
    ],
    returned: [
        { label: 'Mã phiếu', cls: 'px-4 py-3' },
        { label: 'Độc giả', cls: 'px-4 py-3' },
        { label: 'Ngày mượn', cls: 'px-4 py-3' },
        { label: 'Ngày trả', cls: 'px-4 py-3' },
        { label: 'Phạt thực thu', cls: 'px-4 py-3' },
        { label: 'Thao tác', cls: 'px-4 py-3 text-right' }
    ]
};

const renderTableHead = () => {
    const thead = getElem('loans-table-head');
    if (!thead) return;
    const headers = TABLE_HEADERS[state.activeTab] || TABLE_HEADERS.pending;
    thead.innerHTML = `<tr>${headers.map(h => `<th class="${h.cls}">${h.label}</th>`).join('')}</tr>`;
};

// ============================================================
// Time helpers
// ============================================================
const formatWaitTime = (requestDate) => {
    const reqMs = toMs(requestDate);
    if (!reqMs) return '--';
    const diffMs = Date.now() - reqMs;
    const mins = Math.floor(diffMs / 60000);
    if (mins < 60) return `${mins} phút`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} giờ`;
    const days = Math.floor(hours / 24);
    return `${days} ngày`;
};

const formatDaysRemaining = (dueDate) => {
    const dueMs = toMs(dueDate);
    if (!dueMs) return { text: '--', isOverdue: false };
    const diffMs = dueMs - Date.now();
    const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    if (days > 0) return { text: `Còn ${days} ngày`, isOverdue: false };
    if (days === 0) return { text: 'Hôm nay', isOverdue: false };
    return { text: `Quá ${Math.abs(days)} ngày`, isOverdue: true };
};

const getOverdueDays = (dueDate) => {
    const dueMs = toMs(dueDate);
    if (!dueMs) return 0;
    const diffMs = Date.now() - dueMs;
    if (diffMs <= 0) return 0;
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
};

// ============================================================
// Table Body
// ============================================================
const renderRows = () => {
    const tbody = getElem('loans-table-body');
    if (!tbody) return;

    renderTableHead();

    const rows = getFiltered();

    if (!rows.length) {
        const colCount = (TABLE_HEADERS[state.activeTab] || TABLE_HEADERS.pending).length;
        tbody.innerHTML = `<tr><td colspan="${colCount}" class="px-4 py-12 text-center text-slate-500">
            <i class="ph ph-clipboard-text text-4xl text-slate-300 mb-2 block"></i>
            Không có dữ liệu phù hợp.
        </td></tr>`;

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

    tbody.innerHTML = currentRows.map(ticket => {
        const books = Array.isArray(ticket.books) ? ticket.books : [];
        const tab = state.activeTab;

        if (tab === 'pending') {
            return `<tr class="hover:bg-slate-50 transition-colors">
                <td class="px-4 py-3 font-mono text-sm font-semibold text-slate-700">${escapeHtml(ticket.recordId || ticket.id)}</td>
                <td class="px-4 py-3 font-semibold text-slate-800 truncate max-w-[180px]">${escapeHtml(ticket.userDetails?.fullName || '--')}</td>
                <td class="px-4 py-3 text-slate-600">${escapeHtml(ticket.userDetails?.phone || '--')}</td>
                <td class="px-4 py-3 text-center">${books.length}</td>
                <td class="px-4 py-3"><span class="px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700">${formatWaitTime(ticket.requestDate)}</span></td>
                <td class="px-4 py-3 text-right">
                    <div class="flex items-center justify-end gap-1.5">
                        <button data-view="${ticket.id}" class="px-3 py-1.5 text-xs font-semibold bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200">Xem</button>
                        <button data-approve="${ticket.id}" class="px-3 py-1.5 text-xs font-semibold bg-emerald-50 text-emerald-700 rounded-lg hover:bg-emerald-100">Duyệt</button>
                    </div>
                </td>
            </tr>`;
        }

        if (tab === 'borrowing') {
            const remaining = formatDaysRemaining(ticket.dueDate);
            const badgeCls = remaining.isOverdue ? 'bg-rose-50 text-rose-700' : 'bg-blue-50 text-blue-700';
            return `<tr class="hover:bg-slate-50 transition-colors">
                <td class="px-4 py-3 font-mono text-sm font-semibold text-slate-700">${escapeHtml(ticket.recordId || ticket.id)}</td>
                <td class="px-4 py-3 font-semibold text-slate-800 truncate max-w-[180px]">${escapeHtml(ticket.userDetails?.fullName || '--')}</td>
                <td class="px-4 py-3 text-slate-600">${escapeHtml(ticket.userDetails?.phone || '--')}</td>
                <td class="px-4 py-3 text-center">${books.length}</td>
                <td class="px-4 py-3 text-slate-600">${formatDate(ticket.borrowDate)}</td>
                <td class="px-4 py-3"><span class="px-2.5 py-1 rounded-full text-xs font-semibold ${badgeCls}">${remaining.text}</span></td>
                <td class="px-4 py-3 text-right">
                    <div class="flex items-center justify-end gap-1.5">
                        <button data-view="${ticket.id}" class="px-3 py-1.5 text-xs font-semibold bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200">Xem</button>
                        <button data-extend="${ticket.id}" class="px-3 py-1.5 text-xs font-semibold bg-amber-50 text-amber-700 rounded-lg hover:bg-amber-100">Gia hạn</button>
                        <button data-return="${ticket.id}" class="px-3 py-1.5 text-xs font-semibold bg-primary-50 text-primary-700 rounded-lg hover:bg-primary-100">Trả</button>
                    </div>
                </td>
            </tr>`;
        }

        if (tab === 'overdue') {
            const overdueDays = getOverdueDays(ticket.dueDate);
            const finePreview = calculateFineAmount(overdueDays, state.feeSchedule);
            return `<tr class="hover:bg-slate-50 transition-colors">
                <td class="px-4 py-3 font-mono text-sm font-semibold text-slate-700">${escapeHtml(ticket.recordId || ticket.id)}</td>
                <td class="px-4 py-3 font-semibold text-slate-800 truncate max-w-[180px]">${escapeHtml(ticket.userDetails?.fullName || '--')}</td>
                <td class="px-4 py-3 text-slate-600">${escapeHtml(ticket.userDetails?.phone || '--')}</td>
                <td class="px-4 py-3"><span class="px-2.5 py-1 rounded-full text-xs font-bold bg-rose-50 text-rose-700">${overdueDays} ngày</span></td>
                <td class="px-4 py-3 font-semibold text-rose-600">${formatMoney(finePreview)}</td>
                <td class="px-4 py-3 text-right">
                    <div class="flex items-center justify-end gap-1.5">
                        <button data-view="${ticket.id}" class="px-3 py-1.5 text-xs font-semibold bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200">Xem</button>
                        <button data-return="${ticket.id}" class="px-3 py-1.5 text-xs font-semibold bg-rose-50 text-rose-700 rounded-lg hover:bg-rose-100">Trả ngay</button>
                    </div>
                </td>
            </tr>`;
        }

        if (tab === 'returned') {
            const totalFine = Number(ticket.fineOverdue || 0) + Number(ticket.fineDamage || 0);
            return `<tr class="hover:bg-slate-50 transition-colors">
                <td class="px-4 py-3 font-mono text-sm font-semibold text-slate-700">${escapeHtml(ticket.recordId || ticket.id)}</td>
                <td class="px-4 py-3 font-semibold text-slate-800 truncate max-w-[180px]">${escapeHtml(ticket.userDetails?.fullName || '--')}</td>
                <td class="px-4 py-3 text-slate-600">${formatDate(ticket.borrowDate)}</td>
                <td class="px-4 py-3 text-slate-600">${formatDate(ticket.returnDate)}</td>
                <td class="px-4 py-3 font-semibold ${totalFine > 0 ? 'text-rose-600' : 'text-emerald-600'}">${totalFine > 0 ? formatMoney(totalFine) : 'Không phạt'}</td>
                <td class="px-4 py-3 text-right">
                    <button data-view="${ticket.id}" class="px-3 py-1.5 text-xs font-semibold bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200">Xem</button>
                </td>
            </tr>`;
        }

        return '';
    }).join('');

    // Bind action buttons
    const tbody2 = getElem('loans-table-body');
    bindRowActions(tbody2);
    renderPagination(totalPages);
};

const bindRowActions = (container) => {
    if (!container) return;

    container.querySelectorAll('[data-view]').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-view');
            const ticket = state.tickets.find(t => t.id === id);
            if (!ticket) return;
            state.selectedDetailId = id;
            renderDetailModal(ticket);
            getElem('loanDetailModal')?.classList.remove('hidden');
        });
    });

    container.querySelectorAll('[data-approve]').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-approve');
            if (!id) return;
            state.selectedApproveId = id;
            const noteInput = getElem('handoverNote');
            if (noteInput) noteInput.value = '';
            getElem('handoverModal')?.classList.remove('hidden');
        });
    });

    container.querySelectorAll('[data-extend]').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-extend');
            if (!id) return;
            state.selectedExtendId = id;
            const daysInput = getElem('extendDays');
            const noteInput = getElem('extendNote');
            if (daysInput) daysInput.value = '7';
            if (noteInput) noteInput.value = '';
            getElem('extendModal')?.classList.remove('hidden');
        });
    });

    container.querySelectorAll('[data-return]').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-return');
            const ticket = state.tickets.find(t => t.id === id);
            if (!ticket) return;
            state.selectedReturnId = id;
            const dueMs = toMs(ticket.dueDate);
            const lateDays = dueMs && Date.now() > dueMs
                ? Math.ceil((Date.now() - dueMs) / (1000 * 60 * 60 * 24))
                : 0;
            const overdueFee = calculateFineAmount(lateDays, state.feeSchedule);
            getElem('returnOverdueFee').textContent = formatMoney(overdueFee);
            getElem('returnDamageFee').value = '0';
            getElem('returnNote').value = '';
            getElem('returnModal')?.classList.remove('hidden');
        });
    });
};

// ============================================================
// Pagination
// ============================================================
const renderPagination = (totalPages) => {
    if (!paginationControls) return;
    paginationControls.innerHTML = '';

    if (totalPages <= 1) return;

    const prevBtn = document.createElement('button');
    prevBtn.className = `p-2 rounded-lg border flex items-center justify-center transition-colors ${
        state.currentPage === 1
        ? 'border-slate-200 text-slate-300 cursor-not-allowed bg-slate-50'
        : 'border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300'
    }`;
    prevBtn.innerHTML = '<i class="ph ph-caret-left"></i>';
    prevBtn.disabled = state.currentPage === 1;
    if (!prevBtn.disabled) {
        prevBtn.addEventListener('click', () => { state.currentPage--; renderRows(); });
    }
    paginationControls.appendChild(prevBtn);

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
        pageBtn.addEventListener('click', () => { state.currentPage = i; renderRows(); });
        paginationControls.appendChild(pageBtn);
    }

    const nextBtn = document.createElement('button');
    nextBtn.className = `p-2 rounded-lg border flex items-center justify-center transition-colors ${
        state.currentPage === totalPages
        ? 'border-slate-200 text-slate-300 cursor-not-allowed bg-slate-50'
        : 'border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300'
    }`;
    nextBtn.innerHTML = '<i class="ph ph-caret-right"></i>';
    nextBtn.disabled = state.currentPage === totalPages;
    if (!nextBtn.disabled) {
        nextBtn.addEventListener('click', () => { state.currentPage++; renderRows(); });
    }
    paginationControls.appendChild(nextBtn);
};

// ============================================================
// Detail Modal (enhanced with timeline)
// ============================================================
const renderDetailModal = (ticket) => {
    const books = Array.isArray(ticket?.books) ? ticket.books : [];
    const statusView = getTicketStatusView(ticket || {});

    getElem('detailRecordId').textContent = ticket?.recordId || ticket?.id || '--';
    getElem('detailReaderName').textContent = ticket?.userDetails?.fullName || '--';
    getElem('detailReaderPhone').textContent = ticket?.userDetails?.phone || '--';
    getElem('detailReaderCccd').textContent = ticket?.userDetails?.cccd || '--';
    getElem('detailRequestDate').textContent = formatDate(ticket?.requestDate);
    getElem('detailDueDate').textContent = formatDate(ticket?.dueDate);

    const borrowDateEl = getElem('detailBorrowDate');
    if (borrowDateEl) borrowDateEl.textContent = formatDate(ticket?.borrowDate);
    const returnDateEl = getElem('detailReturnDate');
    if (returnDateEl) returnDateEl.textContent = formatDate(ticket?.returnDate);

    // Timeline
    const timelineEl = getElem('detailTimeline');
    if (timelineEl) {
        const steps = [
            { label: 'Đăng ký', done: true, icon: 'ph-note-pencil' },
            { label: 'Duyệt', done: ['borrowing', 'overdue', 'returned'].includes(statusView) || ticket?.status === 'returned', icon: 'ph-check-circle' },
            { label: 'Đang mượn', done: ['borrowing', 'overdue'].includes(statusView) || ticket?.status === 'returned', icon: 'ph-book-open-text' },
            { label: 'Hoàn trả', done: ticket?.status === 'returned', icon: 'ph-arrow-u-up-left' }
        ];

        timelineEl.innerHTML = steps.map((step, idx) => {
            const dotCls = step.done ? 'bg-primary-600 text-white' : 'bg-slate-200 text-slate-400';
            const lineCls = step.done ? 'bg-primary-500' : 'bg-slate-200';
            const textCls = step.done ? 'text-primary-700 font-semibold' : 'text-slate-400';
            return `
                ${idx > 0 ? `<div class="w-8 h-0.5 ${lineCls} rounded-full"></div>` : ''}
                <div class="flex flex-col items-center gap-1">
                    <div class="w-8 h-8 rounded-full ${dotCls} flex items-center justify-center text-sm"><i class="ph-fill ${step.icon}"></i></div>
                    <span class="text-[10px] ${textCls}">${step.label}</span>
                </div>
            `;
        }).join('');
    }

    // Status badge
    const statusEl = getElem('detailStatus');
    if (statusEl) {
        statusEl.className = 'inline-flex px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700';
        statusEl.textContent = 'Đã huỷ';
        if (ticket?.status === 'pending') {
            statusEl.className = 'inline-flex px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700';
            statusEl.textContent = 'Chờ duyệt';
        }
        if (statusView === 'borrowing') {
            statusEl.className = 'inline-flex px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700';
            statusEl.textContent = 'Đang mượn';
        }
        if (statusView === 'overdue') {
            statusEl.className = 'inline-flex px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700';
            statusEl.textContent = 'Quá hạn';
        }
        if (ticket?.status === 'returned') {
            statusEl.className = 'inline-flex px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700';
            statusEl.textContent = 'Đã trả';
        }
    }

    // Book list with covers
    const list = getElem('detailBookList');
    if (!list) return;

    if (!books.length) {
        list.innerHTML = '<p class="text-sm text-slate-500">Không có dữ liệu sách trong phiếu.</p>';
        return;
    }

    list.innerHTML = books.map((book, index) => {
        const cover = book?.coverUrl || '../assets/images/book-cover-placeholder-gray.svg';
        return `
            <div class="flex items-center gap-3 rounded-xl border border-slate-200 p-3">
                <img src="${escapeHtml(cover)}" onerror="this.src='../assets/images/book-cover-placeholder-gray.svg'" alt="Bìa sách" class="w-12 h-16 rounded-md border border-slate-200 object-cover shrink-0">
                <div class="min-w-0">
                    <p class="text-xs text-slate-400">Sách #${index + 1}</p>
                    <p class="text-sm font-semibold text-slate-800 truncate">${escapeHtml(book?.title || '--')}</p>
                    <p class="text-xs text-slate-500 truncate">${escapeHtml(book?.author || 'Tác giả chưa cập nhật')}</p>
                </div>
            </div>
        `;
    }).join('');
};

// ============================================================
// Render All
// ============================================================
const renderAll = () => {
    renderStats();
    renderRows();
};

// ============================================================
// UI Bindings
// ============================================================
const bindUI = () => {
    getElem('loanSearchInput')?.addEventListener('input', (e) => {
        state.search = e.target.value || '';
        state.currentPage = 1;
        renderRows();
    });

    document.querySelectorAll('[data-loan-tab]').forEach(btn => {
        btn.addEventListener('click', () => {
            state.activeTab = btn.getAttribute('data-loan-tab') || 'pending';
            document.querySelectorAll('[data-loan-tab]').forEach(item => {
                item.classList.remove('bg-primary-600', 'text-white', 'shadow-md');
                item.classList.add('text-slate-600', 'hover:bg-slate-50');
            });
            btn.classList.add('bg-primary-600', 'text-white', 'shadow-md');
            btn.classList.remove('text-slate-600', 'hover:bg-slate-50');
            state.currentPage = 1;
            renderRows();
        });
    });

    getElem('closeReturnModalBtn')?.addEventListener('click', () => {
        getElem('returnModal')?.classList.add('hidden');
    });

    getElem('closeExtendModalBtn')?.addEventListener('click', () => {
        getElem('extendModal')?.classList.add('hidden');
        state.selectedExtendId = '';
    });

    getElem('extendForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!state.selectedExtendId) return;
        const days = Number(getElem('extendDays')?.value || 7);
        const note = getElem('extendNote')?.value || '';
        try {
            await extendTicket(state.selectedExtendId, days, note);
            showToast(`Đã gia hạn thêm ${days} ngày thành công.`, 'success');
            getElem('extendModal')?.classList.add('hidden');
            state.selectedExtendId = '';
        } catch (err) {
            showToast(err.message || 'Không thể gia hạn phiếu.', 'error');
        }
    });

    getElem('closeHandoverModalBtn')?.addEventListener('click', () => {
        getElem('handoverModal')?.classList.add('hidden');
        state.selectedApproveId = '';
    });

    getElem('closeLoanDetailModalBtn')?.addEventListener('click', () => {
        getElem('loanDetailModal')?.classList.add('hidden');
        state.selectedDetailId = '';
    });

    getElem('handoverForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!state.selectedApproveId) return;
        const note = getElem('handoverNote')?.value || '';
        try {
            const duration = await getBorrowDurationFromSettings();
            await approveTicket(state.selectedApproveId, note, duration);
            showToast('Đã chuyển phiếu sang trạng thái đang mượn.', 'success');
            getElem('handoverModal')?.classList.add('hidden');
            state.selectedApproveId = '';
        } catch (err) {
            showToast(err.message || 'Không thể bàn giao sách.', 'error');
        }
    });

    getElem('returnForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!state.selectedReturnId) return;
        const damageFee = Number(getElem('returnDamageFee')?.value || 0);
        const note = getElem('returnNote')?.value || '';
        try {
            await returnTicket(state.selectedReturnId, damageFee, note);
            showToast('Đã hoàn tất trả sách.', 'success');
            getElem('returnModal')?.classList.add('hidden');
            state.selectedReturnId = '';
        } catch (err) {
            showToast(err.message || 'Không thể hoàn tất trả sách.', 'error');
        }
    });
};

// ============================================================
// Create Borrow Modal
// ============================================================
const createDirectBorrow = async (readerId, selectedBooks, durationDays = 14, adminNote = '') => {
    if (!readerId) {
        showToast('Vui lòng chọn độc giả.', 'error');
        return;
    }
    if (!Array.isArray(selectedBooks) || selectedBooks.length === 0) {
        showToast('Vui lòng chọn ít nhất một cuốn sách.', 'error');
        return;
    }
    if (selectedBooks.length > 5) {
        showToast('Tối đa 5 cuốn sách mỗi phiếu.', 'error');
        return;
    }

    try {
        const daysNum = Math.max(1, Math.min(90, Number(durationDays) || 14));
        const dueDateObj = new Date();
        dueDateObj.setDate(dueDateObj.getDate() + daysNum);

        const recordId = `LIB-${String(Date.now()).slice(-6).toUpperCase()}`;

        const ticketDocRef = doc(collection(db, 'borrowRecords'));

        await runTransaction(db, async (transaction) => {
            const bookRefs = selectedBooks.map((bookId) => doc(db, 'books', bookId));
            const bookSnaps = await Promise.all(bookRefs.map((ref) => transaction.get(ref)));

            for (let i = 0; i < bookSnaps.length; i++) {
                if (!bookSnaps[i].exists()) throw new Error(`Sách không tồn tại.`);
                const available = Number(bookSnaps[i].data()?.availableQuantity || 0);
                if (available <= 0) throw new Error(`Sách "${bookSnaps[i].data().title}" đã hết.`);
            }

            const bookDetails = [];
            for (let i = 0; i < bookSnaps.length; i++) {
                const bookData = bookSnaps[i].data();
                bookDetails.push({
                    bookId: selectedBooks[i],
                    title: bookData.title || 'Không rõ',
                    author: bookData.author || 'Không rõ',
                    coverUrl: bookData.coverUrl || '',
                    price: Number(bookData.price || 0)
                });
            }

            for (let i = 0; i < bookRefs.length; i++) {
                const available = Number(bookSnaps[i].data()?.availableQuantity || 0);
                const nextQty = available - 1;
                transaction.update(bookRefs[i], {
                    availableQuantity: nextQty,
                    status: nextQty > 0 ? 'available' : 'out_of_stock'
                });
            }

            transaction.set(ticketDocRef, {
                recordId,
                userId: readerId,
                userDetails: {
                    fullName: getElem('borrowReaderName').value,
                    phone: getElem('borrowReaderPhone').value,
                    cccd: ''
                },
                books: bookDetails,
                status: 'pending',
                requestDate: serverTimestamp(),
                borrowDate: null,
                dueDate: null,
                returnDate: null,
                fineOverdue: 0,
                fineDamage: 0,
                adminNote: (adminNote || '').trim(),
                createdBy: 'admin',
                updatedAt: serverTimestamp()
            });
        });

        showToast(`✓ Tạo phiếu mượn thành công! Mã: ${recordId}`, 'success');
        getElem('createBorrowModal')?.classList.add('hidden');
        getElem('createBorrowForm')?.reset();

        return recordId;
    } catch (error) {
        console.error('Lỗi tạo phiếu mượn:', error);
        showToast('Lỗi: ' + (error.message || 'Không thể tạo phiếu mượn'), 'error');
    }
};

const loadReadersForBorrow = async () => {
    const select = getElem('borrowReaderSelect');
    if (!select) return;

    onSnapshot(collection(db, 'users'), (snapshot) => {
        const options = [{ id: '', name: '-- Chọn độc giả --' }];
        snapshot.forEach((docSnap) => {
            const user = docSnap.data() || {};
            const role = (user.role || '').toLowerCase();
            if (role === 'admin') return;

            const displayName = user.displayName || user.email || 'Độc giả';
            options.push({
                id: docSnap.id,
                name: displayName,
                phone: user.phone || user.userDetails?.phone || '',
                data: user
            });
        });

        const current = select.value;
        select.innerHTML = options.map((opt) =>
            `<option value="${opt.id}" data-phone="${opt.phone || ''}" data-name="${opt.name || ''}">${opt.name}</option>`
        ).join('');
        select.value = current || '';
    });
};

const loadBooksForBorrow = async () => {
    onSnapshot(collection(db, 'books'), (snapshot) => {
        const books = [];
        snapshot.forEach((docSnap) => {
            const book = docSnap.data() || {};
            const available = Number(book.availableQuantity || 0);
            if (available > 0) {
                books.push({
                    id: docSnap.id,
                    title: book.title || 'Không rõ',
                    available
                });
            }
        });

        const bookSelects = document.querySelectorAll('.book-select');
        bookSelects.forEach((select) => {
            const current = select.value;
            select.innerHTML = '<option value="">-- Chọn sách --</option>' +
                books.map((b) => `<option value="${b.id}">${b.title} (${b.available})</option>`).join('');
            select.value = current || '';
        });
    });
};

const bindCreateBorrowModal = () => {
    const openBtn = getElem('createDirectBorrowBtn');
    const closeBtn = getElem('closeCreateBorrowModal');
    const cancelBtn = getElem('cancelCreateBorrowBtn');
    const modal = getElem('createBorrowModal');
    const form = getElem('createBorrowForm');
    const readerSelect = getElem('borrowReaderSelect');
    const addBookBtn = getElem('addBookRowBtn');
    const booksContainer = getElem('borrowBooksContainer');

    if (openBtn) {
        openBtn.addEventListener('click', () => {
            modal?.classList.remove('hidden');
            loadReadersForBorrow();
            loadBooksForBorrow();
        });
    }

    if (closeBtn || cancelBtn) {
        const closeModal = () => modal?.classList.add('hidden');
        closeBtn?.addEventListener('click', closeModal);
        cancelBtn?.addEventListener('click', closeModal);
    }

    if (readerSelect) {
        readerSelect.addEventListener('change', (e) => {
            const option = e.target.options[e.target.selectedIndex];
            getElem('borrowReaderName').value = option?.getAttribute('data-name') || '';
            getElem('borrowReaderPhone').value = option?.getAttribute('data-phone') || '';
        });
    }

    if (addBookBtn) {
        addBookBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const newRow = document.createElement('div');
            newRow.className = 'book-row grid grid-cols-1 sm:grid-cols-2 gap-2 items-end';
            newRow.innerHTML = `
                <select class="book-select px-4 py-2.5 border border-slate-200 rounded-lg text-sm bg-white" required>
                    <option value="">-- Chọn sách --</option>
                </select>
                <button type="button" class="remove-book-btn px-3 py-2.5 text-rose-600 hover:bg-rose-50 rounded-lg text-sm font-medium">
                    <i class="ph ph-trash mr-1"></i> Xoá
                </button>
            `;
            booksContainer?.appendChild(newRow);
            loadBooksForBorrow();

            const removeBtn = newRow.querySelector('.remove-book-btn');
            removeBtn.addEventListener('click', (e) => {
                e.preventDefault();
                newRow.remove();
            });
        });
    }

    booksContainer?.addEventListener('click', (e) => {
        if (e.target.closest('.remove-book-btn')) {
            e.preventDefault();
            e.target.closest('.book-row')?.remove();
        }
    });

    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const readerId = getElem('borrowReaderSelect')?.value || '';
            const durationDays = getElem('borrowDurationDays')?.value || 14;
            const adminNote = getElem('borrowNote')?.value || '';

            const bookSelects = form.querySelectorAll('.book-select');
            const selectedBooks = [];
            bookSelects.forEach((select) => {
                if (select.value) selectedBooks.push(select.value);
            });

            await createDirectBorrow(readerId, selectedBooks, durationDays, adminNote);
        });
    }
};

// ============================================================
// Init
// ============================================================
const initAdminLoans = async () => {
    const hasTable = !!getElem('loans-table-body');
    if (!hasTable) return;

    // Load fee schedule for fine preview
    try {
        state.feeSchedule = await getActiveFeeSchedule();
    } catch (err) {
        console.warn('Could not load fee schedule:', err);
    }

    bindUI();
    bindCreateBorrowModal();

    try {
        await cleanupLegacyBorrowRecords();
    } catch (err) {
        console.warn('Borrow cleanup failed, continuing to load tickets:', err);
    }

    subscribeAllTickets((rows) => {
        state.tickets = rows;
        renderAll();
    });
};

// Khởi chạy — bảo vệ bằng admin guard
const guardedInit = () => requireAdmin(() => initAdminLoans());
document.addEventListener('turbo:load', guardedInit);
document.addEventListener('turbo:render', guardedInit);
if (document.readyState !== 'loading') guardedInit();
else document.addEventListener('DOMContentLoaded', guardedInit);

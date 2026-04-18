import { autoCleanup, approveTicket, cleanupLegacyBorrowRecords, getTicketStatusView, returnTicket, subscribeAllTickets, FINE_PER_DAY } from './borrow.js';
import { showToast } from './auth.js';

const getElem = (id) => document.getElementById(id);

const state = {
    tickets: [],
    activeTab: 'pending',
    search: '',
    selectedApproveId: '',
    selectedDetailId: '',
    selectedReturnId: '',
    currentPage: 1,
    itemsPerPage: 6
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

const getFiltered = () => {
    const term = state.search.trim().toLowerCase();

    const byTab = state.tickets.filter((ticket) => {
        const view = getTicketStatusView(ticket);
        if (state.activeTab === 'pending') return ticket.status === 'pending';
        if (state.activeTab === 'borrowing') return view === 'borrowing';
        return view === 'overdue';
    });

    if (!term) return byTab;

    return byTab.filter((ticket) => {
        const recordId = (ticket.recordId || '').toLowerCase();
        const phone = (ticket.userDetails?.phone || '').toLowerCase();
        const cccd = (ticket.userDetails?.cccd || '').toLowerCase();
        return recordId.includes(term) || phone.includes(term) || cccd.includes(term);
    });
};

const renderCounts = () => {
    const pendingCount = state.tickets.filter((t) => t.status === 'pending').length;
    const borrowingCount = state.tickets.filter((t) => getTicketStatusView(t) === 'borrowing').length;
    const overdueCount = state.tickets.filter((t) => getTicketStatusView(t) === 'overdue').length;

    const pendingCounter = getElem('pendingCount');
    const borrowingCounter = getElem('borrowingCount');
    const overdueCounter = getElem('overdueCount');

    if (pendingCounter) pendingCounter.textContent = String(pendingCount);
    if (borrowingCounter) borrowingCounter.textContent = String(borrowingCount);
    if (overdueCounter) overdueCounter.textContent = String(overdueCount);
};

const renderRows = () => {
    const container = getElem('loanCardsContainer');
    if (!container) return;

    const rows = getFiltered();

    if (!rows.length) {
        container.innerHTML = `
            <div class="xl:col-span-3 md:col-span-2 rounded-2xl border border-slate-200 bg-white p-12 text-center text-slate-500">
                Không có dữ liệu phù hợp.
            </div>
        `;
        
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

    container.innerHTML = currentRows.map((ticket) => {
        const books = Array.isArray(ticket.books) ? ticket.books : [];
        const dueMs = toMs(ticket.dueDate);
        const daysLeft = dueMs ? Math.ceil((dueMs - Date.now()) / (1000 * 60 * 60 * 24)) : null;
        const statusView = getTicketStatusView(ticket);

        let statusHtml = '<span class="px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700">Đã huỷ</span>';
        if (ticket.status === 'pending') statusHtml = '<span class="px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700">Chờ duyệt</span>';
        if (statusView === 'borrowing') statusHtml = `<span class="px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700">Đang mượn (${daysLeft ?? '--'} ngày)</span>`;
        if (statusView === 'overdue') statusHtml = '<span class="px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700">Quá hạn</span>';

        let actionHtml = '-';
        if (ticket.status === 'pending') {
            actionHtml = `<button data-approve="${ticket.id}" class="px-3.5 py-2 text-sm font-semibold bg-emerald-50 text-emerald-700 rounded-lg hover:bg-emerald-100">Bàn giao sách</button>`;
        } else if (statusView === 'borrowing' || statusView === 'overdue') {
            actionHtml = `<button data-return="${ticket.id}" class="px-3.5 py-2 text-sm font-semibold bg-primary-50 text-primary-700 rounded-lg hover:bg-primary-100">Trả sách</button>`;
        }

        return `
            <article class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:shadow-md transition-shadow h-full min-h-[300px] flex flex-col">
                <div class="flex items-start justify-between gap-2">
                    <p class="font-mono text-sm font-semibold text-slate-700 truncate">${escapeHtml(ticket.recordId || ticket.id)}</p>
                    ${statusHtml}
                </div>

                <div class="mt-3 space-y-2">
                    <div>
                        <p class="text-xs uppercase tracking-wider text-slate-400">Độc giả</p>
                        <p class="font-semibold text-slate-900 truncate">${escapeHtml(ticket.userDetails?.fullName || '--')}</p>
                        <p class="text-sm text-slate-600 truncate">${escapeHtml(ticket.userDetails?.phone || '--')}</p>
                    </div>

                    <div>
                        <p class="text-xs uppercase tracking-wider text-slate-400">Sách</p>
                        <p class="text-sm font-semibold text-slate-800">${books.length} cuốn</p>
                    </div>

                    <div class="grid grid-cols-2 gap-2 text-xs">
                        <div class="rounded-lg bg-slate-50 p-2">
                            <p class="text-slate-400">Ngày đăng ký</p>
                            <p class="font-medium text-slate-700 mt-1">${formatDate(ticket.requestDate)}</p>
                        </div>
                        <div class="rounded-lg bg-slate-50 p-2">
                            <p class="text-slate-400">Hạn trả</p>
                            <p class="font-medium text-slate-700 mt-1">${formatDate(ticket.dueDate)}</p>
                        </div>
                    </div>
                </div>

                <div class="mt-auto pt-3 border-t border-slate-100 flex flex-wrap gap-2">
                    <button data-view="${ticket.id}" class="flex-1 min-w-[120px] px-3 py-2 text-sm font-semibold bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200">Xem chi tiết</button>
                    ${actionHtml !== '-' ? actionHtml.replace('px-3.5 py-2', 'flex-1 min-w-[120px] px-3 py-2') : ''}
                </div>
            </article>
        `;
    }).join('');

    container.querySelectorAll('[data-view]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-view');
            if (!id) return;

            const ticket = state.tickets.find((t) => t.id === id);
            if (!ticket) return;

            state.selectedDetailId = id;
            renderDetailModal(ticket);
            getElem('loanDetailModal')?.classList.remove('hidden');
        });
    });

    container.querySelectorAll('[data-approve]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-approve');
            if (!id) return;

            state.selectedApproveId = id;
            const noteInput = getElem('handoverNote');
            if (noteInput) noteInput.value = '';
            getElem('handoverModal')?.classList.remove('hidden');
        });
    });

    container.querySelectorAll('[data-return]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-return');
            const ticket = state.tickets.find((t) => t.id === id);
            if (!ticket) return;

            state.selectedReturnId = id;
            const dueMs = toMs(ticket.dueDate);
            const lateDays = dueMs && Date.now() > dueMs
                ? Math.ceil((Date.now() - dueMs) / (1000 * 60 * 60 * 24))
                : 0;
            const overdueFee = lateDays * FINE_PER_DAY;
            getElem('returnOverdueFee').textContent = formatMoney(overdueFee);
            getElem('returnDamageFee').value = '0';
            getElem('returnNote').value = '';
            getElem('returnModal')?.classList.remove('hidden');
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
            renderRows();
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
            renderRows();
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
            renderRows();
        });
    }
    paginationControls.appendChild(nextBtn);
};

const renderDetailModal = (ticket) => {
    const books = Array.isArray(ticket?.books) ? ticket.books : [];
    const statusView = getTicketStatusView(ticket || {});

    getElem('detailRecordId').textContent = ticket?.recordId || ticket?.id || '--';
    getElem('detailReaderName').textContent = ticket?.userDetails?.fullName || '--';
    getElem('detailReaderPhone').textContent = ticket?.userDetails?.phone || '--';
    getElem('detailReaderCccd').textContent = ticket?.userDetails?.cccd || '--';
    getElem('detailRequestDate').textContent = formatDate(ticket?.requestDate);
    getElem('detailDueDate').textContent = formatDate(ticket?.dueDate);

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
                <img src="${escapeHtml(cover)}" onerror="this.src='../assets/images/book-cover-placeholder-gray.svg'" alt="Bìa sách" class="w-12 h-16 rounded-md border border-slate-200 object-cover">
                <div class="min-w-0">
                    <p class="text-xs text-slate-400">Sách #${index + 1}</p>
                    <p class="text-sm font-semibold text-slate-800 truncate">${escapeHtml(book?.title || '--')}</p>
                    <p class="text-xs text-slate-500 truncate">${escapeHtml(book?.author || 'Tác giả chưa cập nhật')}</p>
                </div>
            </div>
        `;
    }).join('');
};

const renderAll = () => {
    renderCounts();
    renderRows();
};

const bindUI = () => {
    getElem('loanSearchInput')?.addEventListener('input', (e) => {
        state.search = e.target.value || '';
        state.currentPage = 1;
        renderRows();
    });

    document.querySelectorAll('[data-loan-tab]').forEach((btn) => {
        btn.addEventListener('click', () => {
            state.activeTab = btn.getAttribute('data-loan-tab') || 'pending';
            document.querySelectorAll('[data-loan-tab]').forEach((item) => {
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
            await approveTicket(state.selectedApproveId, note);
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

const initAdminLoans = async () => {
    const hasLegacyTable = !!getElem('loanTableBody');
    const hasCardContainer = !!getElem('loanCardsContainer');
    if (!hasLegacyTable && !hasCardContainer) return;

    bindUI();

    // Do not block ticket subscription if cleanup tasks fail.
    try {
        await cleanupLegacyBorrowRecords();
        await autoCleanup();
    } catch (err) {
        console.warn('Borrow cleanup failed, continuing to load tickets:', err);
    }

    subscribeAllTickets((rows) => {
        state.tickets = rows;
        renderAll();
    });
};

document.addEventListener('turbo:load', initAdminLoans);
document.addEventListener('turbo:render', initAdminLoans);
if (document.readyState !== 'loading') initAdminLoans();
else document.addEventListener('DOMContentLoaded', initAdminLoans);

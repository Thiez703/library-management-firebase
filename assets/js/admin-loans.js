import { autoCleanup, approveTicket, getTicketStatusView, returnTicket, subscribeAllTickets, FINE_PER_DAY } from './borrow.js';
import { showToast } from './auth.js';

const getElem = (id) => document.getElementById(id);

const state = {
    tickets: [],
    activeTab: 'pending',
    search: '',
    selectedReturnId: ''
};

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
    const body = getElem('loanTableBody');
    if (!body) return;

    const rows = getFiltered();

    if (!rows.length) {
        body.innerHTML = '<tr><td colspan="7" class="px-6 py-10 text-center text-slate-500">Không có dữ liệu phù hợp.</td></tr>';
        return;
    }

    body.innerHTML = rows.map((ticket) => {
        const books = Array.isArray(ticket.books) ? ticket.books : [];
        const booksText = books.slice(0, 2).map((b) => escapeHtml(b.title)).join(', ');
        const more = books.length > 2 ? ` +${books.length - 2}` : '';
        const dueMs = toMs(ticket.dueDate);
        const daysLeft = dueMs ? Math.ceil((dueMs - Date.now()) / (1000 * 60 * 60 * 24)) : null;
        const statusView = getTicketStatusView(ticket);

        let statusHtml = '<span class="px-2 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700">Đã huỷ</span>';
        if (ticket.status === 'pending') statusHtml = '<span class="px-2 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700">Chờ duyệt</span>';
        if (statusView === 'borrowing') statusHtml = `<span class="px-2 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700">Đang mượn (${daysLeft ?? '--'} ngày)</span>`;
        if (statusView === 'overdue') statusHtml = '<span class="px-2 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700">Quá hạn</span>';

        let actionHtml = '-';
        if (ticket.status === 'pending') {
            actionHtml = `<button data-approve="${ticket.id}" class="px-3 py-1.5 text-xs font-semibold bg-emerald-50 text-emerald-700 rounded-lg hover:bg-emerald-100">Bàn giao sách</button>`;
        } else if (statusView === 'borrowing' || statusView === 'overdue') {
            actionHtml = `<button data-return="${ticket.id}" class="px-3 py-1.5 text-xs font-semibold bg-primary-50 text-primary-700 rounded-lg hover:bg-primary-100">Trả sách</button>`;
        }

        return `
            <tr class="hover:bg-slate-50/80 transition-colors">
                <td class="px-6 py-4 font-mono text-xs text-slate-500">${escapeHtml(ticket.recordId || ticket.id)}</td>
                <td class="px-6 py-4">
                    <p class="font-medium text-slate-800">${escapeHtml(ticket.userDetails?.fullName || '--')}</p>
                    <p class="text-xs text-slate-500">${escapeHtml(ticket.userDetails?.phone || '--')}</p>
                    <p class="text-xs text-slate-500">CCCD: ${escapeHtml(ticket.userDetails?.cccd || '--')}</p>
                </td>
                <td class="px-6 py-4 text-slate-700">${booksText}${more}</td>
                <td class="px-6 py-4 text-slate-500">${formatDate(ticket.requestDate)}</td>
                <td class="px-6 py-4 text-slate-500">${formatDate(ticket.dueDate)}</td>
                <td class="px-6 py-4">${statusHtml}</td>
                <td class="px-6 py-4 text-right">${actionHtml}</td>
            </tr>
        `;
    }).join('');

    body.querySelectorAll('[data-approve]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const id = btn.getAttribute('data-approve');
            const note = window.prompt('Ghi chú tình trạng sách khi bàn giao:', '') || '';
            try {
                await approveTicket(id, note);
                showToast('Đã chuyển phiếu sang trạng thái đang mượn.', 'success');
            } catch (err) {
                showToast(err.message || 'Không thể bàn giao sách.', 'error');
            }
        });
    });

    body.querySelectorAll('[data-return]').forEach((btn) => {
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
};

const renderAll = () => {
    renderCounts();
    renderRows();
};

const bindUI = () => {
    getElem('loanSearchInput')?.addEventListener('input', (e) => {
        state.search = e.target.value || '';
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
            renderRows();
        });
    });

    getElem('closeReturnModalBtn')?.addEventListener('click', () => {
        getElem('returnModal')?.classList.add('hidden');
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
    if (!getElem('loanTableBody')) return;

    bindUI();
    await autoCleanup();

    subscribeAllTickets((rows) => {
        state.tickets = rows;
        renderAll();
    });
};

document.addEventListener('turbo:load', initAdminLoans);
document.addEventListener('turbo:render', initAdminLoans);
if (document.readyState !== 'loading') initAdminLoans();
else document.addEventListener('DOMContentLoaded', initAdminLoans);

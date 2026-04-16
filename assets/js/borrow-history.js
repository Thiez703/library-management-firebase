import { auth } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-auth.js";
import { autoCleanup, getTicketStatusView, subscribeUserTickets } from './borrow.js';

const formatDate = (tsLike) => {
    if (!tsLike || typeof tsLike.toDate !== 'function') return '--';
    return tsLike.toDate().toLocaleDateString('vi-VN');
};

const formatMoney = (value) => `${Number(value || 0).toLocaleString('vi-VN')} đ`;

const statusBadge = (ticket) => {
    const view = getTicketStatusView(ticket);
    if (ticket.status === 'pending') return '<span class="px-2 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700">Chờ duyệt</span>';
    if (view === 'overdue') return '<span class="px-2 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700">Quá hạn</span>';
    if (ticket.status === 'borrowing') return '<span class="px-2 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700">Đang mượn</span>';
    if (ticket.status === 'returned') return '<span class="px-2 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700">Đã trả</span>';
    return '<span class="px-2 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700">Đã huỷ</span>';
};

const renderTickets = (tickets) => {
    const list = document.querySelector('[data-mock-books="borrow-history-list"]');
    const empty = document.querySelector('section .bg-white.border.border-slate-200.rounded-2xl.p-8.text-center');
    if (!list) return;

    if (!tickets.length) {
        list.classList.add('hidden');
        if (empty) empty.classList.remove('hidden');
        return;
    }

    if (empty) empty.classList.add('hidden');
    list.classList.remove('hidden');

    list.innerHTML = tickets.map((ticket) => {
        const books = Array.isArray(ticket.books) ? ticket.books : [];
        const bookLines = books.slice(0, 3).map((b) => `<li class="truncate">${b.title}</li>`).join('');
        const remain = books.length > 3 ? `<li>+${books.length - 3} sách khác</li>` : '';
        const totalFine = Number(ticket.fineOverdue || 0) + Number(ticket.fineDamage || 0);

        return `
            <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
                <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                    <div>
                        <p class="text-xs text-slate-500">Mã phiếu</p>
                        <p class="font-mono text-sm font-semibold text-slate-800">${ticket.recordId || ticket.id}</p>
                    </div>
                    <div>${statusBadge(ticket)}</div>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                    <div><p class="text-slate-500 text-xs">Ngày đăng ký</p><p class="font-medium">${formatDate(ticket.requestDate)}</p></div>
                    <div><p class="text-slate-500 text-xs">Hạn trả</p><p class="font-medium">${formatDate(ticket.dueDate)}</p></div>
                    <div><p class="text-slate-500 text-xs">Tổng phạt</p><p class="font-semibold ${totalFine > 0 ? 'text-rose-600' : 'text-slate-700'}">${formatMoney(totalFine)}</p></div>
                </div>

                <div>
                    <p class="text-xs text-slate-500 mb-1">Danh sách sách</p>
                    <ul class="list-disc pl-5 text-sm text-slate-700 space-y-1">${bookLines}${remain}</ul>
                </div>
            </div>
        `;
    }).join('');
};

const initBorrowHistory = async () => {
    const root = document.querySelector('[data-mock-books="borrow-history-list"]');
    if (!root) return;

    await autoCleanup();

    onAuthStateChanged(auth, (user) => {
        if (!user) {
            renderTickets([]);
            return;
        }
        subscribeUserTickets(user.uid, renderTickets);
    });
};

document.addEventListener('turbo:load', initBorrowHistory);
document.addEventListener('turbo:render', initBorrowHistory);
if (document.readyState !== 'loading') initBorrowHistory();
else document.addEventListener('DOMContentLoaded', initBorrowHistory);

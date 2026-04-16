import { auth, db } from './firebase-config.js';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-auth.js";
import { autoCleanup, cleanupLegacyBorrowRecords, getTicketStatusView, subscribeUserTickets } from './borrow.js';

const formatDate = (tsLike) => {
    if (!tsLike || typeof tsLike.toDate !== 'function') return '--';
    return tsLike.toDate().toLocaleDateString('vi-VN');
};

const formatMoney = (value) => `${Number(value || 0).toLocaleString('vi-VN')} đ`;

let unsubscribeTickets = null;
let unsubscribeAuth = null;

const toMillis = (tsLike) => {
    if (!tsLike) return null;
    if (typeof tsLike.toMillis === 'function') return tsLike.toMillis();
    const date = new Date(tsLike);
    return Number.isNaN(date.getTime()) ? null : date.getTime();
};

const formatFallback = (value, fallback = 'Chưa cập nhật') => {
    const text = (value || '').toString().trim();
    return text || fallback;
};

const setText = (selector, value) => {
    const element = document.querySelector(selector);
    if (element) element.textContent = value;
};

const setHtml = (selector, value) => {
    const element = document.querySelector(selector);
    if (element) element.innerHTML = value;
};

const renderUserProfile = (user, userData) => {
    const displayName = formatFallback(userData?.displayName || user?.displayName || user?.email, 'Người dùng');
    const avatarUrl = userData?.photoURL || user?.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=random`;
    const accountLabel = userData?.memberCode || userData?.studentId || userData?.email || user?.email || user?.uid || 'Chưa cập nhật';
    const roleLabel = userData?.role === 'admin' ? 'Quản trị viên' : 'Độc giả';

    const avatar = document.getElementById('borrow-history-avatar');
    if (avatar) {
        avatar.src = avatarUrl;
        avatar.alt = displayName;
    }

    setText('#borrow-history-name', displayName);
    setText('#borrow-history-meta', `Tài khoản: ${accountLabel}`);
    setHtml('#borrow-history-role', `<i class="ph-fill ph-crown"></i> ${roleLabel}`);
};

const renderStats = (tickets) => {
    const rows = Array.isArray(tickets) ? tickets : [];
    const borrowing = rows.filter((ticket) => ticket.status === 'borrowing');
    const returned = rows.filter((ticket) => ticket.status === 'returned');
    const issues = rows.filter((ticket) => ticket.status === 'pending' || getTicketStatusView(ticket) === 'overdue');

    setText('#borrow-history-active-count', String(borrowing.length));
    setText('#borrow-history-active-nav-count', String(borrowing.length));
    setText('#borrow-history-returned-count', String(returned.length));
    setText('#borrow-history-issue-count', String(issues.length));

    const warning = document.getElementById('borrow-history-warning');
    const warningTitle = document.getElementById('borrow-history-warning-title');
    const warningText = document.getElementById('borrow-history-warning-text');
    const warningBook = document.getElementById('borrow-history-warning-book');
    const warningDate = document.getElementById('borrow-history-warning-date');

    const urgentTicket = borrowing
        .map((ticket) => {
            const dueMs = toMillis(ticket.dueDate);
            return { ticket, dueMs };
        })
        .filter(({ dueMs }) => Number.isFinite(dueMs))
        .sort((a, b) => a.dueMs - b.dueMs)[0];

    if (!urgentTicket) {
        if (warning) warning.hidden = true;
        return;
    }

    const now = Date.now();
    const daysLeft = Math.ceil((urgentTicket.dueMs - now) / (1000 * 60 * 60 * 24));
    const bookTitle = urgentTicket.ticket.books?.[0]?.title || 'Cuốn sách trong phiếu mượn';
    const dueLabel = new Date(urgentTicket.dueMs).toLocaleDateString('vi-VN');

    if (warning) warning.hidden = false;
    if (warningTitle) {
        warningTitle.textContent = urgentTicket.dueMs < now
            ? 'Cảnh báo: Có sách đã quá hạn!'
            : 'Cảnh báo: Có sách sắp quá hạn!';
    }
    if (warningBook) warningBook.textContent = bookTitle;
    if (warningDate) {
        warningDate.textContent = urgentTicket.dueMs < now
            ? `${Math.abs(daysLeft)} ngày quá hạn`
            : `${daysLeft <= 1 ? 'Hôm nay' : dueLabel}`;
    }

    if (warningText && urgentTicket.dueMs < now) {
        warningText.textContent = '';
        warningText.append('Cuốn sách ', warningBook, ' của bạn đã quá hạn trả vào ', warningDate, '. Vui lòng mang sách tới thư viện hoặc gia hạn ngay để tránh bị phạt phí.');
        return;
    }

    if (warningText) {
        warningText.textContent = '';
        warningText.append('Cuốn sách ', warningBook, ' của bạn sẽ hết hạn trả vào ', warningDate, '. Vui lòng mang sách tới thư viện hoặc gia hạn trực tuyến để tránh bị phạt phí.');
    }
};

const isRealTicket = (ticket) => {
    const recordId = (ticket?.recordId || '').toString().trim().toUpperCase();
    const userDetails = ticket?.userDetails || {};
    const hasUserDetails = !!(userDetails.fullName && userDetails.phone && userDetails.cccd);
    return recordId.startsWith('LIB-') && hasUserDetails;
};

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
    const empty = document.getElementById('borrow-history-empty');
    if (!list) return;

    const realTickets = (Array.isArray(tickets) ? tickets : []).filter(isRealTicket);
    renderStats(realTickets);

    if (!realTickets.length) {
        list.classList.add('hidden');
        if (empty) empty.classList.remove('hidden');
        return;
    }

    if (empty) empty.classList.add('hidden');
    list.classList.remove('hidden');

    list.innerHTML = realTickets.map((ticket) => {
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

    if (unsubscribeTickets) {
        unsubscribeTickets();
        unsubscribeTickets = null;
    }
    if (unsubscribeAuth) {
        unsubscribeAuth();
        unsubscribeAuth = null;
    }

    await cleanupLegacyBorrowRecords();
    await autoCleanup();

    unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
        if (!user) {
            renderUserProfile(null, null);
            renderTickets([]);
            return;
        }

        const userDoc = await getDoc(doc(db, 'users', user.uid));
        renderUserProfile(user, userDoc.exists() ? userDoc.data() : null);

        if (unsubscribeTickets) unsubscribeTickets();
        unsubscribeTickets = subscribeUserTickets(user.uid, renderTickets);
    });
};

document.addEventListener('turbo:load', initBorrowHistory);
document.addEventListener('turbo:render', initBorrowHistory);
if (document.readyState !== 'loading') initBorrowHistory();
else document.addEventListener('DOMContentLoaded', initBorrowHistory);

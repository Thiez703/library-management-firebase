import { auth, db } from './firebase-config.js';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-auth.js";
import { cleanupLegacyBorrowRecords, getTicketStatusView, subscribeUserTickets } from './borrow.js';
import { collection, query, where, getDocs, orderBy } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";
import { signOutUser } from './auth.js';

const formatDate = (tsLike) => {
    if (!tsLike || typeof tsLike.toDate !== 'function') return '--';
    return tsLike.toDate().toLocaleDateString('vi-VN');
};

const formatMoney = (value) => `${Number(value || 0).toLocaleString('vi-VN')} đ`;
const AVATAR_PLACEHOLDER = '../assets/images/avatar-placeholder.svg';

let unsubscribeTickets = null;
let unsubscribeAuth = null;

const historyState = {
    activeTab: 'borrowing', // borrowing, returned, issues, fines
    tickets: [],
    fines: []
};

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
    const avatarUrl = userData?.photoURL || user?.photoURL || AVATAR_PLACEHOLDER;
    const accountLabel = userData?.memberCode || userData?.studentId || userData?.email || user?.email || user?.uid || 'Chưa cập nhật';
    const roleLabel = userData?.role === 'admin' ? 'Quản trị viên' : 'Độc giả';

    const avatar = document.getElementById('borrow-history-avatar');
    if (avatar) {
        avatar.src = avatarUrl;
        avatar.alt = displayName;
        avatar.onerror = () => { avatar.src = AVATAR_PLACEHOLDER; };
    }

    setText('#borrow-history-name', displayName);
    setText('#borrow-history-meta', `Tài khoản: ${accountLabel}`);
    setHtml('#borrow-history-role', `<i class="ph-fill ph-crown"></i> ${roleLabel}`);
};

const getTicketBucket = (ticket) => {
    const view = getTicketStatusView(ticket);
    if (ticket?.status === 'returned') return 'returned';
    if (ticket?.status === 'pending' || view === 'overdue') return 'issues';
    if (view === 'borrowing') return 'borrowing';
    return 'others';
};

const renderStats = (tickets) => {
    const rows = Array.isArray(tickets) ? tickets : [];
    const borrowing = rows.filter((ticket) => getTicketBucket(ticket) === 'borrowing');

    const activeCount = historyState.tickets.filter((t) => {
        const view = getTicketStatusView(t);
        return view === 'borrowing' || view === 'overdue' || t.status === 'pending';
    }).length;
    const returnedCount = historyState.tickets.filter((t) => t.status === 'returned').length;

    const navActiveCount = document.getElementById('borrow-history-active-nav-count');
    const tabActiveCount = document.getElementById('borrow-history-active-count');
    const tabReturnedCount = document.getElementById('borrow-history-returned-count');

    if (navActiveCount) navActiveCount.textContent = activeCount;
    if (tabActiveCount) tabActiveCount.textContent = activeCount;
    if (tabReturnedCount) tabReturnedCount.textContent = returnedCount;

    // Fines count
    const finesCountEl = document.getElementById('borrow-history-fines-count');
    if (finesCountEl) {
        const unpaidFines = historyState.fines.filter(f => f.status === 'unpaid').length;
        if (unpaidFines > 0) {
            finesCountEl.textContent = unpaidFines;
            finesCountEl.classList.remove('hidden');
        } else {
            finesCountEl.classList.add('hidden');
        }
    }

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

const setActiveTab = (tab) => {
    historyState.activeTab = tab;
    document.querySelectorAll('[data-borrow-tab]').forEach((button) => {
        const isActive = button.getAttribute('data-borrow-tab') === tab;
        button.classList.toggle('active', isActive);
    });
};

const getVisibleTickets = () => historyState.tickets.filter((ticket) => getTicketBucket(ticket) === historyState.activeTab);

const getEmptyMessage = () => {
    if (historyState.activeTab === 'returned') return 'Bạn chưa có phiếu đã trả.';
    if (historyState.activeTab === 'issues') return 'Không có phiếu vi phạm hoặc chờ xử lý.';
    if (historyState.activeTab === 'fines') return 'Tuyệt vời! Bạn không có bất kỳ khoản nợ phạt nào.';
    return 'Bạn chưa có phiếu đang mượn.';
};

const statusBadge = (ticket) => {
    const view = getTicketStatusView(ticket);
    if (ticket.status === 'pending') return '<span class="px-2 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700">Chờ duyệt</span>';
    if (view === 'overdue') return '<span class="px-2 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700">Quá hạn</span>';
    if (ticket.status === 'borrowing') return '<span class="px-2 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700">Đang mượn</span>';
    if (ticket.status === 'returned') return '<span class="px-2 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700">Đã trả</span>';
    return '<span class="px-2 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700">Đã huỷ</span>';
};

const renderSkeleton = () => {
    const list = document.querySelector('[data-mock-books="borrow-history-list"]');
    const empty = document.getElementById('borrow-history-empty');
    if (!list) return;

    if (empty) empty.classList.add('hidden');
    list.classList.remove('hidden');

    list.innerHTML = Array(3).fill(`
        <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4 animate-pulse opacity-60">
            <div class="flex justify-between">
                <div>
                    <div class="h-3 w-16 bg-slate-200 rounded mb-2"></div>
                    <div class="h-4 w-32 bg-slate-200 rounded"></div>
                </div>
                <div class="h-6 w-20 bg-slate-200 rounded-full"></div>
            </div>
            <div class="grid grid-cols-3 gap-3">
                <div><div class="h-3 w-20 bg-slate-200 rounded mb-2"></div><div class="h-4 w-24 bg-slate-200 rounded"></div></div>
                <div><div class="h-3 w-16 bg-slate-200 rounded mb-2"></div><div class="h-4 w-24 bg-slate-200 rounded"></div></div>
                <div><div class="h-3 w-16 bg-slate-200 rounded mb-2"></div><div class="h-4 w-20 bg-slate-200 rounded"></div></div>
            </div>
            <div>
                <div class="h-3 w-24 bg-slate-200 rounded mb-2"></div>
                <div class="space-y-2">
                    <div class="h-4 w-3/4 bg-slate-200 rounded"></div>
                    <div class="h-4 w-1/2 bg-slate-200 rounded"></div>
                </div>
            </div>
        </div>
    `).join('');
};

const renderTickets = (tickets) => {
    const list = document.querySelector('[data-mock-books="borrow-history-list"]');
    const empty = document.getElementById('borrow-history-empty');
    if (!list) return;

    historyState.tickets = (Array.isArray(tickets) ? tickets : []).filter(isRealTicket);
    renderStats(historyState.tickets);

    const visibleTickets = getVisibleTickets();

    if (!visibleTickets.length) {
        list.classList.add('hidden');
        if (empty) {
            empty.classList.remove('hidden');
            const emptyText = empty.querySelector('p');
            if (emptyText) emptyText.textContent = getEmptyMessage();
        }
        return;
    }

    if (empty) empty.classList.add('hidden');
    list.classList.remove('hidden');

    list.innerHTML = visibleTickets.map((ticket) => {
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

const renderFinesList = () => {
    const list = document.getElementById('finesList');
    if (!list) return;

    if (!historyState.fines || historyState.fines.length === 0) {
        list.innerHTML = `
            <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-10 text-center">
                <i class="ph-fill ph-check-circle text-emerald-500 text-5xl mb-3"></i>
                <h3 class="text-lg font-bold text-slate-800">Không có tiền phạt</h3>
                <p class="text-slate-500 mt-1">Tuyệt vời! Bạn đang tuân thủ rất tốt các quy định mượn sách.</p>
            </div>
        `;
        return;
    }

    list.innerHTML = historyState.fines.map(f => {
        let statusHtml = '';
        if (f.status === 'unpaid') statusHtml = '<span class="px-3 py-1 bg-rose-50 text-rose-700 text-xs font-bold rounded-lg border border-rose-200">Chưa thanh toán</span>';
        else if (f.status === 'paid') statusHtml = '<span class="px-3 py-1 bg-emerald-50 text-emerald-700 text-xs font-bold rounded-lg border border-emerald-200">Đã thanh toán</span>';
        else if (f.status === 'waived') statusHtml = '<span class="px-3 py-1 bg-slate-50 text-slate-600 text-xs font-bold rounded-lg border border-slate-200">Đã miễn phạt</span>';

        return `
            <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
                <div class="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-100 pb-4">
                    <div>
                        <p class="text-xs text-slate-500 uppercase tracking-wider font-semibold">Mã Phiếu Phạt</p>
                        <p class="font-mono text-sm font-bold text-slate-800 mt-1">${f.fineId || '--'}</p>
                    </div>
                    <div>${statusHtml}</div>
                </div>
                
                <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                        <p class="text-slate-500 text-xs mb-1">Số ngày trễ</p>
                        <p class="font-semibold text-rose-600">${f.daysLate || 0} ngày</p>
                    </div>
                    <div>
                        <p class="text-slate-500 text-xs mb-1">Số tiền phạt</p>
                        <p class="font-bold text-slate-800 text-lg">${formatMoney(f.amount)}</p>
                    </div>
                    <div class="sm:col-span-2">
                        <p class="text-slate-500 text-xs mb-1">Sách vi phạm</p>
                        <p class="font-medium text-slate-700 line-clamp-2">${(f.bookTitles || []).join(', ')}</p>
                    </div>
                </div>
                
                ${f.status === 'unpaid' ? `
                <div class="bg-rose-50 rounded-xl p-3 mt-2 flex items-start gap-2 border border-rose-100">
                    <i class="ph-fill ph-info text-rose-500 mt-0.5"></i>
                    <p class="text-xs text-rose-700">Tài khoản của bạn tạm thời bị khóa mượn sách. Vui lòng đến quầy thủ thư để thanh toán khoản phạt này.</p>
                </div>
                ` : ''}
                ${f.status === 'waived' ? `
                <div class="bg-slate-50 rounded-xl p-3 mt-2 flex items-start gap-2 border border-slate-200">
                    <i class="ph-fill ph-info text-slate-500 mt-0.5"></i>
                    <p class="text-xs text-slate-600">Lý do miễn phạt: <span class="font-medium">${f.waivedReason || ''}</span></p>
                </div>
                ` : ''}
            </div>
        `;
    }).join('');
};

const bindTabs = () => {
    const tabButtons = Array.from(document.querySelectorAll('[data-borrow-tab]'));
    if (!tabButtons.length) return;

    tabButtons.forEach((button) => {
        if (button.dataset.bound === '1') return;
        button.dataset.bound = '1';

        button.addEventListener('click', () => {
            const tab = button.getAttribute('data-borrow-tab') || 'borrowing';
            setActiveTab(tab);
            
            // Toggle visibility between tickets list and fines list
            const ticketsList = document.getElementById('tab-content-tickets') || document.querySelector('[data-mock-books="borrow-history-list"]');
            const finesPane = document.getElementById('tab-content-fines');
            const emptyMsg = document.getElementById('borrow-history-empty');
            
            if (tab === 'fines') {
                if (ticketsList) ticketsList.classList.add('hidden');
                if (emptyMsg) emptyMsg.classList.add('hidden');
                if (finesPane) finesPane.classList.remove('hidden');
                renderFinesList();
            } else {
                if (finesPane) finesPane.classList.add('hidden');
                renderTickets(historyState.tickets);
            }
        });
    });
};

const bindSidebarActions = () => {
    const logoutBtn = document.getElementById('borrowHistoryLogoutBtn');
    if (logoutBtn && logoutBtn.dataset.bound !== '1') {
        logoutBtn.dataset.bound = '1';
        logoutBtn.addEventListener('click', async (event) => {
            event.preventDefault();
            await signOutUser();
        });
    }
};

const initBorrowHistory = async () => {
    const root = document.querySelector('[data-mock-books="borrow-history-list"]');
    if (!root) return;

    renderSkeleton();

    if (unsubscribeTickets) {
        unsubscribeTickets();
        unsubscribeTickets = null;
    }
    if (unsubscribeAuth) {
        unsubscribeAuth();
        unsubscribeAuth = null;
    }

    bindTabs();
    bindSidebarActions();
    setActiveTab('borrowing');
    historyState.tickets = [];

    await cleanupLegacyBorrowRecords();

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

        // Fetch fines
        const finesRef = collection(db, 'fines');
        const q = query(finesRef, where('userId', '==', user.uid), orderBy('createdAt', 'desc'));
        const fSnap = await getDocs(q);
        historyState.fines = fSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderStats(historyState.tickets);
        
        // Cập nhật lại UI nếu đang ở tab fines
        if (historyState.activeTab === 'fines') {
            renderFinesList();
        }
    });
};

document.addEventListener('turbo:load', initBorrowHistory);
document.addEventListener('turbo:render', initBorrowHistory);
if (document.readyState !== 'loading') initBorrowHistory();
else document.addEventListener('DOMContentLoaded', initBorrowHistory);

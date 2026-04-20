import { auth, db } from './firebase-config.js';
import { doc, getDoc, collection, query, where, getDocs, orderBy } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-auth.js";
import { cancelPendingTicket, cleanupLegacyBorrowRecords, getTicketStatusView, subscribeUserTickets, updatePendingTicket } from './borrow.js';
import { showToast, signOutUser } from './auth.js';

const escapeHtml = (v = '') => String(v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

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
    fines: [],
    currentUserId: '',
    editingTicketId: '',
    editSelectedBooks: [],
    editBookCatalog: [],
    editActiveBookId: ''
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
    const accountLabel = userData?.readerCode || userData?.studentId || userData?.email || user?.email || user?.uid || 'Chưa cập nhật';
    const roleLabels = { admin: 'Quản trị viên', librarian: 'Thủ thư' };
    const roleLabel = roleLabels[userData?.role] || 'Độc giả';

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
    if (view === 'overdue') return 'issues';
    if (ticket?.status === 'pending') return 'borrowing';
    if (view === 'borrowing') return 'borrowing';
    return 'others';
};

const toFineMillis = (value) => toMillis(value?.createdAt || value?.paidAt || value?.waivedAt || value?.returnDate || value?.dueDate);

const buildLegacyFineFromTicket = (ticket) => {
    const amount = Number(ticket?.fineOverdue || 0) + Number(ticket?.fineDamage || 0);
    if (amount <= 0) return null;

    return {
        id: `legacy-${ticket.id}`,
        fineId: ticket?.recordId || ticket?.id || '--',
        recordId: ticket?.recordId || ticket?.id || '',
        userId: ticket?.userId || '',
        userName: ticket?.userDetails?.fullName || 'Độc giả',
        bookTitles: Array.isArray(ticket?.books) ? ticket.books.map((book) => book?.title || 'Sách không tên') : [],
        dueDate: ticket?.dueDate,
        returnDate: ticket?.returnDate,
        daysLate: Number(ticket?.daysLate || 0),
        amount,
        overdueAmount: Number(ticket?.fineOverdue || 0),
        damageAmount: Number(ticket?.fineDamage || 0),
        status: amount > 0 ? 'unpaid' : 'paid',
        paidAt: null,
        waivedAt: null,
        waivedReason: null,
        waivedBy: null,
        createdAt: ticket?.returnDate || ticket?.dueDate || null,
        source: 'legacy'
    };
};

const getMergedFines = () => {
    const finesByRecordId = new Map();

    (Array.isArray(historyState.fines) ? historyState.fines : []).forEach((fine) => {
        const key = (fine?.recordId || fine?.fineId || fine?.id || '').toString().trim();
        if (key) finesByRecordId.set(key, fine);
    });

    (Array.isArray(historyState.tickets) ? historyState.tickets : []).forEach((ticket) => {
        const legacyFine = buildLegacyFineFromTicket(ticket);
        if (!legacyFine) return;

        const key = (legacyFine.recordId || legacyFine.fineId || legacyFine.id || '').toString().trim();
        if (!key || finesByRecordId.has(key)) return;

        finesByRecordId.set(key, legacyFine);
    });

    return [...finesByRecordId.values()].sort((a, b) => (toFineMillis(b) || 0) - (toFineMillis(a) || 0));
};

const renderStats = (tickets) => {
    const rows = Array.isArray(tickets) ? tickets : [];
    const borrowing = rows.filter((ticket) => getTicketBucket(ticket) === 'borrowing');
    const fines = getMergedFines();

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
        const unpaidFines = fines.filter(f => (f.status || '').toLowerCase() === 'unpaid').length;
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

const getEditTotalQty = () => historyState.editSelectedBooks.reduce((sum, item) => sum + Math.max(1, Number(item?.quantity || 1)), 0);

const closeEditModal = () => {
    document.getElementById('editPendingTicketModal')?.classList.add('hidden');
    document.getElementById('editPendingBookDropdown')?.classList.add('hidden');
    historyState.editingTicketId = '';
    historyState.editSelectedBooks = [];
    historyState.editBookCatalog = [];
    historyState.editActiveBookId = '';
    const input = document.getElementById('editPendingBookSearchInput');
    if (input) input.value = '';
};

const renderEditSelectedBooks = () => {
    const list = document.getElementById('editPendingSelectedBooksList');
    const totalText = document.getElementById('editPendingTotalQtyText');
    if (!list) return;

    const totalQty = getEditTotalQty();
    if (totalText) totalText.textContent = `Tổng số cuốn: ${totalQty}/5`;

    if (!historyState.editSelectedBooks.length) {
        list.innerHTML = '<p class="text-sm text-slate-500">Chưa có sách nào trong phiếu.</p>';
        return;
    }

    list.innerHTML = historyState.editSelectedBooks.map((item, idx) => {
        const title = item.title || 'Sách không rõ';
        return `
            <div class="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <p class="text-sm text-slate-700 truncate">${idx + 1}. ${escapeHtml(title)}</p>
                <div class="flex items-center gap-1">
                    <button type="button" data-edit-decrease="${item.bookId}" class="w-8 h-8 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100">-</button>
                    <span class="w-8 text-center text-sm font-semibold text-slate-700">${Math.max(1, Number(item.quantity || 1))}</span>
                    <button type="button" data-edit-increase="${item.bookId}" class="w-8 h-8 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100">+</button>
                    <button type="button" data-edit-remove="${item.bookId}" class="px-2.5 py-1.5 text-rose-600 hover:bg-rose-50 rounded-md text-sm font-medium">
                        <i class="ph ph-trash"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');
};

const getFilteredEditBooks = (keyword = '') => {
    const kw = (keyword || '').toLowerCase().trim();
    const rows = kw
        ? historyState.editBookCatalog.filter((b) => (b.title || '').toLowerCase().includes(kw))
        : historyState.editBookCatalog;
    return rows.slice(0, 80);
};

const renderEditBookDropdown = (keyword = '') => {
    const dropdown = document.getElementById('editPendingBookDropdown');
    if (!dropdown) return;
    const rows = getFilteredEditBooks(keyword);
    if (!rows.length) {
        dropdown.innerHTML = '<div class="px-3 py-2 text-sm text-slate-500">Không tìm thấy sách phù hợp.</div>';
        dropdown.classList.remove('hidden');
        return;
    }

    dropdown.innerHTML = rows.map((b) => `
        <button type="button" data-edit-book-id="${b.id}" class="w-full text-left px-3 py-2 hover:bg-slate-50 border-b border-slate-100 last:border-b-0">
            <span class="text-sm font-medium text-slate-700">${escapeHtml(b.title || 'Không rõ')}</span>
            <span class="text-xs text-slate-500 ml-1">(${Number(b.available || 0)})</span>
        </button>
    `).join('');
    dropdown.classList.remove('hidden');
};

const openEditModal = async (ticket) => {
    if (!ticket?.id) return;
    historyState.editingTicketId = ticket.id;
    historyState.editSelectedBooks = (Array.isArray(ticket.books) ? ticket.books : []).map((item) => ({
        bookId: item.bookId,
        title: item.title || 'Không rõ',
        quantity: Math.max(1, Number(item.quantity || 1))
    })).filter((item) => item.bookId);
    historyState.editActiveBookId = '';

    const booksSnap = await getDocs(collection(db, 'books'));
    const catalog = [];
    booksSnap.forEach((docSnap) => {
        const data = docSnap.data() || {};
        catalog.push({
            id: docSnap.id,
            title: data.title || 'Không rõ',
            available: Number(data.availableQuantity || 0)
        });
    });

    // Keep selected books visible even when currently out-of-stock.
    const selectedMap = new Map(historyState.editSelectedBooks.map((x) => [x.bookId, x.title]));
    selectedMap.forEach((title, id) => {
        if (!catalog.some((c) => c.id === id)) {
            catalog.push({ id, title, available: 0 });
        }
    });

    catalog.sort((a, b) => (a.title || '').localeCompare((b.title || ''), 'vi'));
    historyState.editBookCatalog = catalog;

    const input = document.getElementById('editPendingBookSearchInput');
    if (input) input.value = '';
    renderEditSelectedBooks();
    document.getElementById('editPendingTicketModal')?.classList.remove('hidden');
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
        const bookLines = books.slice(0, 3).map((b) => `<li class="truncate">${escapeHtml(b.title)}</li>`).join('');
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

                ${ticket.status === 'pending' ? `
                    <div class="pt-3 border-t border-slate-100 flex justify-end gap-2">
                        <button data-edit-ticket="${ticket.id}" class="px-3.5 py-2 text-sm font-semibold rounded-lg border border-primary-200 text-primary-600 hover:bg-primary-50">
                            <i class="ph ph-pencil-simple mr-1"></i> Chỉnh sửa phiếu
                        </button>
                        <button data-cancel-ticket="${ticket.id}" class="px-3.5 py-2 text-sm font-semibold rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50">
                            <i class="ph ph-x-circle mr-1"></i> Huỷ phiếu
                        </button>
                    </div>
                ` : ''}
            </div>
        `;
    }).join('');
};

const bindTicketActions = () => {
    const list = document.querySelector('[data-mock-books="borrow-history-list"]');
    if (!list || list.dataset.bound === '1') return;
    list.dataset.bound = '1';

    list.addEventListener('click', async (event) => {
        const cancelBtn = event.target.closest('[data-cancel-ticket]');
        const editBtn = event.target.closest('[data-edit-ticket]');

        if (editBtn) {
            const ticketId = editBtn.getAttribute('data-edit-ticket');
            const ticket = historyState.tickets.find((t) => t.id === ticketId);
            if (!ticket || ticket.status !== 'pending') return;
            try {
                await openEditModal(ticket);
            } catch (err) {
                showToast(err.message || 'Không thể mở màn hình chỉnh sửa phiếu.', 'error');
            }
            return;
        }

        if (!cancelBtn) return;
        const ticketId = cancelBtn.getAttribute('data-cancel-ticket');
        if (!ticketId || !historyState.currentUserId) return;

        const confirmed = window.confirm('Bạn chắc chắn muốn huỷ phiếu mượn này?');
        if (!confirmed) return;

        cancelBtn.setAttribute('disabled', 'disabled');
        try {
            await cancelPendingTicket(ticketId, historyState.currentUserId);
            showToast('Đã huỷ phiếu mượn thành công.', 'success');
        } catch (err) {
            showToast(err.message || 'Không thể huỷ phiếu mượn.', 'error');
        } finally {
            cancelBtn.removeAttribute('disabled');
        }
    });
};

const bindEditPendingModalActions = () => {
    const modal = document.getElementById('editPendingTicketModal');
    const closeBtn = document.getElementById('closeEditPendingTicketModalBtn');
    const cancelBtn = document.getElementById('cancelEditPendingTicketBtn');
    const saveBtn = document.getElementById('saveEditPendingTicketBtn');
    const searchInput = document.getElementById('editPendingBookSearchInput');
    const dropdown = document.getElementById('editPendingBookDropdown');
    const addBtn = document.getElementById('editPendingAddBookBtn');
    const selectedList = document.getElementById('editPendingSelectedBooksList');

    if (!modal || modal.dataset.bound === '1') return;
    modal.dataset.bound = '1';

    const close = () => closeEditModal();

    closeBtn?.addEventListener('click', close);
    cancelBtn?.addEventListener('click', close);

    searchInput?.addEventListener('focus', () => renderEditBookDropdown(searchInput.value || ''));
    searchInput?.addEventListener('input', () => {
        historyState.editActiveBookId = '';
        renderEditBookDropdown(searchInput.value || '');
    });

    searchInput?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            const firstRow = getFilteredEditBooks(searchInput.value || '')[0];
            if (firstRow) {
                historyState.editActiveBookId = firstRow.id;
                searchInput.value = firstRow.title;
                dropdown?.classList.add('hidden');
            }
        }
    });

    dropdown?.addEventListener('click', (event) => {
        const row = event.target.closest('[data-edit-book-id]');
        if (!row) return;
        const bookId = row.getAttribute('data-edit-book-id') || '';
        const selected = historyState.editBookCatalog.find((b) => b.id === bookId);
        historyState.editActiveBookId = bookId;
        if (searchInput) searchInput.value = selected?.title || '';
        dropdown.classList.add('hidden');
    });

    addBtn?.addEventListener('click', () => {
        if (!historyState.editActiveBookId) {
            showToast('Vui lòng chọn sách từ danh sách gợi ý.', 'error');
            return;
        }

        const total = getEditTotalQty();
        if (total >= 5) {
            showToast('Tối đa 5 cuốn mỗi phiếu.', 'error');
            return;
        }

        const existing = historyState.editSelectedBooks.find((x) => x.bookId === historyState.editActiveBookId);
        if (existing) {
            existing.quantity = Math.min(5, Number(existing.quantity || 1) + 1);
        } else {
            const book = historyState.editBookCatalog.find((x) => x.id === historyState.editActiveBookId);
            historyState.editSelectedBooks.push({
                bookId: historyState.editActiveBookId,
                title: book?.title || 'Không rõ',
                quantity: 1
            });
        }

        historyState.editActiveBookId = '';
        if (searchInput) searchInput.value = '';
        renderEditSelectedBooks();
    });

    selectedList?.addEventListener('click', (event) => {
        const decBtn = event.target.closest('[data-edit-decrease]');
        const incBtn = event.target.closest('[data-edit-increase]');
        const removeBtn = event.target.closest('[data-edit-remove]');
        const btn = decBtn || incBtn || removeBtn;
        if (!btn) return;

        const bookId = btn.getAttribute('data-edit-decrease')
            || btn.getAttribute('data-edit-increase')
            || btn.getAttribute('data-edit-remove')
            || '';
        if (!bookId) return;

        const idx = historyState.editSelectedBooks.findIndex((x) => x.bookId === bookId);
        if (idx < 0) return;

        if (removeBtn) {
            historyState.editSelectedBooks.splice(idx, 1);
            renderEditSelectedBooks();
            return;
        }

        if (decBtn) {
            historyState.editSelectedBooks[idx].quantity = Math.max(1, Number(historyState.editSelectedBooks[idx].quantity || 1) - 1);
            renderEditSelectedBooks();
            return;
        }

        const total = getEditTotalQty();
        if (total >= 5) {
            showToast('Tối đa 5 cuốn mỗi phiếu.', 'error');
            return;
        }
        historyState.editSelectedBooks[idx].quantity = Math.min(5, Number(historyState.editSelectedBooks[idx].quantity || 1) + 1);
        renderEditSelectedBooks();
    });

    saveBtn?.addEventListener('click', async () => {
        if (!historyState.editingTicketId || !historyState.currentUserId) return;
        if (!historyState.editSelectedBooks.length) {
            showToast('Phiếu mượn phải có ít nhất một cuốn sách.', 'error');
            return;
        }

        saveBtn.setAttribute('disabled', 'disabled');
        try {
            await updatePendingTicket(
                historyState.editingTicketId,
                historyState.currentUserId,
                historyState.editSelectedBooks.map((item) => ({ bookId: item.bookId, quantity: item.quantity }))
            );
            showToast('Đã cập nhật phiếu mượn thành công.', 'success');
            closeEditModal();
        } catch (err) {
            showToast(err.message || 'Không thể cập nhật phiếu mượn.', 'error');
        } finally {
            saveBtn.removeAttribute('disabled');
        }
    });

    document.addEventListener('click', (event) => {
        if (modal.classList.contains('hidden')) return;
        const target = event.target;
        if (!(target instanceof Element)) return;
        if (!target.closest('#editPendingBookSearchInput') && !target.closest('#editPendingBookDropdown')) {
            dropdown?.classList.add('hidden');
        }
    });
};

const renderFinesList = () => {
    const list = document.getElementById('finesList');
    if (!list) return;

    const fines = getMergedFines();

    if (!fines.length) {
        list.innerHTML = `
            <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-10 text-center">
                <i class="ph-fill ph-check-circle text-emerald-500 text-5xl mb-3"></i>
                <h3 class="text-lg font-bold text-slate-800">Không có tiền phạt</h3>
                <p class="text-slate-500 mt-1">Tuyệt vời! Bạn đang tuân thủ rất tốt các quy định mượn sách.</p>
            </div>
        `;
        return;
    }

    list.innerHTML = fines.map(f => {
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
    bindTicketActions();
    bindEditPendingModalActions();
    setActiveTab('borrowing');
    historyState.tickets = [];

    unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
        if (!user) {
            historyState.currentUserId = '';
            renderUserProfile(null, null);
            renderTickets([]);
            return;
        }

        historyState.currentUserId = user.uid;

        const userDoc = await getDoc(doc(db, 'users', user.uid));
        renderUserProfile(user, userDoc.exists() ? userDoc.data() : null);

        if (unsubscribeTickets) unsubscribeTickets();
        unsubscribeTickets = subscribeUserTickets(user.uid, renderTickets);

        // Fetch fines (No orderBy to avoid composite index requirement, sort in memory)
        const finesRef = collection(db, 'fines');
        const q = query(finesRef, where('userId', '==', user.uid));
        
        try {
            const fSnap = await getDocs(q);
            historyState.fines = fSnap.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .sort((a, b) => {
                    const aTime = a.createdAt?.toMillis?.() || 0;
                    const bTime = b.createdAt?.toMillis?.() || 0;
                    return bTime - aTime; // descending
                });
            renderStats(historyState.tickets);
            
            // Cập nhật lại UI nếu đang ở tab fines
            if (historyState.activeTab === 'fines') {
                renderFinesList();
            }
        } catch (e) {
            console.error('Error fetching fines:', e);
        }
        
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

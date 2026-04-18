import { db } from './firebase-config.js';
import { showToast } from './notify.js';
import { requireAdmin } from './admin-guard.js';
import {
    collection,
    onSnapshot
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

const getElem = (id) => document.getElementById(id);

const state = {
    tickets: [],
    users: [],
    books: [],
    startMs: null,
    endMs: null,
    unsubscribers: []
};

const BORROW_COLLECTION = 'borrowRecords';
const USER_COLLECTION = 'users';
const BOOK_COLLECTION = 'books';

const toMs = (tsLike) => {
    if (!tsLike) return null;
    if (typeof tsLike.toMillis === 'function') return tsLike.toMillis();
    const dt = new Date(tsLike);
    return Number.isNaN(dt.getTime()) ? null : dt.getTime();
};

const escapeHtml = (value = '') => value
    .toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const formatNumber = (value) => Number(value || 0).toLocaleString('vi-VN');

const toDateInputValue = (date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
};

const parseInputDate = (value, isEnd = false) => {
    if (!value) return null;
    const dt = new Date(`${value}T00:00:00`);
    if (Number.isNaN(dt.getTime())) return null;
    if (isEnd) {
        dt.setHours(23, 59, 59, 999);
    }
    return dt.getTime();
};

const getCurrentMonthRange = () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    return { startMs: start.getTime(), endMs: end.getTime(), startDate: start, endDate: end };
};

const isBorrowing = (ticket) => ticket?.status === 'borrowing';

const isOverdue = (ticket) => {
    if (!isBorrowing(ticket)) return false;
    const dueMs = toMs(ticket?.dueDate);
    return !!(dueMs && Date.now() > dueMs);
};

const inRange = (ms, startMs, endMs) => {
    if (!ms || !startMs || !endMs) return false;
    return ms >= startMs && ms <= endMs;
};

const getReaderKey = (ticket) => {
    if (ticket?.userId) return `uid:${ticket.userId}`;
    if (ticket?.userDetails?.cccd) return `cccd:${ticket.userDetails.cccd}`;
    return `anon:${ticket?.id || Math.random().toString(36).slice(2)}`;
};

const getReaderDisplay = (ticket) => ({
    name: ticket?.userDetails?.fullName || 'Độc giả chưa cập nhật',
    id: ticket?.userId || ticket?.userDetails?.cccd || '--'
});

const getBookDisplay = (book) => ({
    id: book?.bookId || `book:${book?.title || 'unknown'}`,
    title: book?.title || 'Không rõ tên sách',
    author: book?.author || 'Tác giả chưa cập nhật'
});

const renderTopReaders = (rows) => {
    const host = getElem('topReadersList');
    if (!host) return;

    if (!rows.length) {
        host.innerHTML = '<div class="px-6 py-6 text-sm text-slate-500">Chưa có dữ liệu độc giả trong khoảng lọc.</div>';
        return;
    }

    const tone = [
        'bg-violet-100 text-violet-600',
        'bg-rose-100 text-rose-600',
        'bg-blue-100 text-blue-600',
        'bg-emerald-100 text-emerald-600',
        'bg-amber-100 text-amber-700'
    ];

    host.innerHTML = rows.map((item, index) => {
        const initials = item.name
            .split(' ')
            .filter(Boolean)
            .slice(0, 2)
            .map((part) => part[0]?.toUpperCase() || '')
            .join('') || '--';
        return `
            <div class="px-6 py-4 flex items-center justify-between hover:bg-slate-50/50">
                <div class="flex items-center gap-3 min-w-0">
                    <div class="w-10 h-10 rounded-full ${tone[index % tone.length]} flex items-center justify-center font-bold text-sm">${escapeHtml(initials)}</div>
                    <div class="min-w-0">
                        <p class="text-sm font-semibold text-slate-800 truncate">${escapeHtml(item.name)}</p>
                        <p class="text-xs text-slate-500 truncate">ID: ${escapeHtml(item.id)}</p>
                    </div>
                </div>
                <p class="text-sm font-bold text-slate-800 ml-3">${formatNumber(item.count)} lần</p>
            </div>
        `;
    }).join('');
};

const renderTopBooks = (rows) => {
    const host = getElem('topBooksList');
    if (!host) return;

    if (!rows.length) {
        host.innerHTML = '<div class="px-6 py-6 text-sm text-slate-500">Chưa có dữ liệu sách trong khoảng lọc.</div>';
        return;
    }

    host.innerHTML = rows.map((item) => `
        <div class="px-6 py-4 flex items-center justify-between hover:bg-slate-50/50 gap-3">
            <div class="flex-1 min-w-0">
                <p class="text-sm font-semibold text-slate-800 truncate">${escapeHtml(item.title)}</p>
                <p class="text-xs text-slate-500 truncate">${escapeHtml(item.author)}</p>
            </div>
            <p class="text-sm font-bold text-slate-800">${formatNumber(item.count)} lần</p>
        </div>
    `).join('');
};

const renderMonthlyTable = (rows) => {
    const body = getElem('monthlyStatsBody');
    if (!body) return;

    if (!rows.length) {
        body.innerHTML = '<tr><td colspan="6" class="px-6 py-6 text-center text-slate-500">Không có dữ liệu thống kê tháng.</td></tr>';
        return;
    }

    body.innerHTML = rows.map((item) => `
        <tr class="hover:bg-slate-50/80">
            <td class="px-6 py-4 font-semibold">${escapeHtml(item.label)}</td>
            <td class="px-6 py-4 text-center">${formatNumber(item.transactions)}</td>
            <td class="px-6 py-4 text-center text-emerald-600 font-semibold">${formatNumber(item.newReaders)}</td>
            <td class="px-6 py-4 text-center text-blue-600 font-semibold">${formatNumber(item.borrowedBooks)}</td>
            <td class="px-6 py-4 text-center text-emerald-600 font-semibold">${formatNumber(item.returnedBooks)}</td>
            <td class="px-6 py-4 text-center text-rose-600 font-semibold">${formatNumber(item.overdueBooks)}</td>
        </tr>
    `).join('');
};

const setText = (id, value) => {
    const el = getElem(id);
    if (el) el.textContent = value;
};

const buildMetrics = () => {
    const tickets = state.tickets;
    const users = state.users;
    const books = state.books;
    const startMs = state.startMs;
    const endMs = state.endMs;

    const duration = Math.max(1, endMs - startMs + 1);
    const previousStartMs = startMs - duration;
    const previousEndMs = startMs - 1;

    const rangeTickets = tickets.filter((ticket) => inRange(toMs(ticket.requestDate), startMs, endMs));
    const rangeUsers = users.filter((user) => inRange(toMs(user.createdAt), startMs, endMs));
    const previousUsers = users.filter((user) => inRange(toMs(user.createdAt), previousStartMs, previousEndMs));

    const transactions = rangeTickets.length;
    const newReaders = rangeUsers.length;
    const previousReaders = previousUsers.length;

    const overdueBooks = tickets
        .filter((ticket) => isOverdue(ticket))
        .reduce((sum, ticket) => sum + (Array.isArray(ticket.books) ? ticket.books.length : 0), 0);

    const currentBorrowedBooks = tickets
        .filter((ticket) => isBorrowing(ticket))
        .reduce((sum, ticket) => sum + (Array.isArray(ticket.books) ? ticket.books.length : 0), 0);

    const totalInventoryBooks = books.reduce((sum, book) => sum + Number(book.totalQuantity || 0), 0);
    const borrowRate = totalInventoryBooks > 0
        ? Math.round((currentBorrowedBooks / totalInventoryBooks) * 100)
        : 0;

    const readerCountMap = new Map();
    rangeTickets.forEach((ticket) => {
        const key = getReaderKey(ticket);
        const base = readerCountMap.get(key) || {
            ...getReaderDisplay(ticket),
            count: 0
        };
        base.count += 1;
        readerCountMap.set(key, base);
    });

    const topReaders = [...readerCountMap.values()]
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

    const bookCountMap = new Map();
    rangeTickets.forEach((ticket) => {
        const list = Array.isArray(ticket.books) ? ticket.books : [];
        list.forEach((book) => {
            const data = getBookDisplay(book);
            const base = bookCountMap.get(data.id) || { ...data, count: 0 };
            base.count += 1;
            bookCountMap.set(data.id, base);
        });
    });

    const topBooks = [...bookCountMap.values()]
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

    const monthlyRows = [];
    const now = new Date();

    for (let i = 5; i >= 0; i -= 1) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const monthStart = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0).getTime();
        const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999).getTime();

        const monthTickets = tickets.filter((ticket) => inRange(toMs(ticket.requestDate), monthStart, monthEnd));
        const monthUsers = users.filter((user) => inRange(toMs(user.createdAt), monthStart, monthEnd));

        const borrowedBooks = monthTickets.reduce((sum, ticket) => sum + (Array.isArray(ticket.books) ? ticket.books.length : 0), 0);

        const returnedBooks = tickets
            .filter((ticket) => inRange(toMs(ticket.returnDate), monthStart, monthEnd))
            .reduce((sum, ticket) => sum + (Array.isArray(ticket.books) ? ticket.books.length : 0), 0);

        const overdueBooksByMonth = tickets
            .filter((ticket) => {
                const dueMs = toMs(ticket.dueDate);
                if (!inRange(dueMs, monthStart, monthEnd)) return false;
                return isOverdue(ticket) || Number(ticket.fineOverdue || 0) > 0;
            })
            .reduce((sum, ticket) => sum + (Array.isArray(ticket.books) ? ticket.books.length : 0), 0);

        monthlyRows.push({
            label: `Tháng ${d.getMonth() + 1}/${d.getFullYear()}`,
            transactions: monthTickets.length,
            newReaders: monthUsers.length,
            borrowedBooks,
            returnedBooks,
            overdueBooks: overdueBooksByMonth
        });
    }

    return {
        transactions,
        newReaders,
        previousReaders,
        overdueBooks,
        currentBorrowedBooks,
        totalInventoryBooks,
        borrowRate,
        topReaders,
        topBooks,
        monthlyRows
    };
};

const render = () => {
    const metrics = buildMetrics();

    setText('statTotalTransactions', formatNumber(metrics.transactions));
    setText('statTotalTransactionsSub', 'Trong khoảng lọc');

    setText('statNewReaders', formatNumber(metrics.newReaders));

    if (metrics.previousReaders > 0) {
        const delta = metrics.newReaders - metrics.previousReaders;
        const pct = Math.round((delta / metrics.previousReaders) * 100);
        const sign = pct > 0 ? '+' : '';
        setText('statNewReadersSub', `${sign}${pct}% so với kỳ trước`);
    } else {
        setText('statNewReadersSub', metrics.newReaders > 0 ? 'Kỳ trước chưa có độc giả mới' : 'So với kỳ trước: --');
    }

    setText('statOverdueBooks', formatNumber(metrics.overdueBooks));
    setText('statOverdueBooksSub', 'Sách đang quá hạn hiện tại');

    setText('statBorrowRate', `${formatNumber(metrics.borrowRate)}%`);
    setText('statBorrowRateSub', `${formatNumber(metrics.currentBorrowedBooks)} / ${formatNumber(metrics.totalInventoryBooks)} cuốn`);

    renderTopReaders(metrics.topReaders);
    renderTopBooks(metrics.topBooks);
    renderMonthlyTable(metrics.monthlyRows);
};

const normalizeUsers = (docs) => docs
    .map((snap) => ({ id: snap.id, ...snap.data() }))
    .filter((user) => (user.role || 'user') !== 'admin');

const normalizeTickets = (docs) => docs.map((snap) => ({ id: snap.id, ...snap.data() }));
const normalizeBooks = (docs) => docs.map((snap) => ({ id: snap.id, ...snap.data() }));

const bindRangeEvents = () => {
    const startInput = getElem('reportStartDate');
    const endInput = getElem('reportEndDate');
    if (!startInput || !endInput) return;
    if (startInput.dataset.bound === '1' && endInput.dataset.bound === '1') return;

    const applyRange = () => {
        const nextStart = parseInputDate(startInput.value, false);
        const nextEnd = parseInputDate(endInput.value, true);

        if (!nextStart || !nextEnd) return;
        if (nextStart > nextEnd) {
            showToast('Ngày bắt đầu không được lớn hơn ngày kết thúc.', 'error');
            return;
        }

        state.startMs = nextStart;
        state.endMs = nextEnd;
        render();
    };

    startInput.addEventListener('change', applyRange);
    endInput.addEventListener('change', applyRange);
    startInput.dataset.bound = '1';
    endInput.dataset.bound = '1';
};

// ─── Export CSV ───────────────────────────────────────────────────────────────

const escapeCsvCell = (value = '') => {
    const str = String(value ?? '').replace(/"/g, '""');
    return /[,"\n\r]/.test(str) ? `"${str}"` : str;
};

const downloadCsv = (filename, rows) => {
    const BOM = '\uFEFF'; // BOM để Excel nhận đúng UTF-8
    const csv = BOM + rows.map(row => row.map(escapeCsvCell).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 300);
};

const exportTicketsCsv = () => {
    const metrics = buildMetrics();
    const formatDateCell = (tsLike) => {
        const ms = toMs(tsLike);
        return ms ? new Date(ms).toLocaleDateString('vi-VN') : '--';
    };

    // Header
    const header = ['Mã Phiếu', 'Độc Giả', 'SĐT', 'Sách Mượn', 'Ngày Đăng Ký', 'Hạn Trả', 'Ngày Trả', 'Trạng Thái', 'Phí Trễ', 'Ghi Chú'];

    // Lấy tickets trong khoảng lọc
    const filtered = state.tickets.filter(t => {
        const ms = toMs(t.requestDate) || toMs(t.borrowDate);
        if (!ms) return false;
        if (state.startMs && ms < state.startMs) return false;
        if (state.endMs && ms > state.endMs) return false;
        return true;
    });

    const statusLabel = { pending: 'Chờ duyệt', borrowing: 'Đang mượn', returned: 'Đã trả', cancelled: 'Đã huỷ' };

    const rows = filtered.map(t => {
        const books = Array.isArray(t.books) ? t.books.map(b => b.title).join(' | ') : (t.bookTitle || '--');
        const fine = Number(t.fineOverdue || 0) + Number(t.fineDamage || 0);
        return [
            t.recordId || t.id,
            t.userDetails?.fullName || t.readerName || '--',
            t.userDetails?.phone || '--',
            books,
            formatDateCell(t.requestDate || t.borrowDate),
            formatDateCell(t.dueDate),
            formatDateCell(t.returnDate),
            statusLabel[t.status] || t.status || '--',
            fine > 0 ? `${fine.toLocaleString('vi-VN')} đ` : '0',
            t.adminNote || t.note || ''
        ];
    });

    if (!rows.length) {
        showToast('Không có dữ liệu trong khoảng thời gian đã chọn.', 'error');
        return;
    }

    const startLabel = getElem('reportStartDate')?.value || 'all';
    const endLabel = getElem('reportEndDate')?.value || 'all';
    const filename = `bao-cao-muon-sach_${startLabel}_${endLabel}.csv`;

    downloadCsv(filename, [header, ...rows]);
    showToast(`Đã xuất ${rows.length} phiếu mượn thành file CSV.`, 'success');
};

const bindExport = () => {
    const pdfBtn = getElem('exportReportPdfBtn');
    if (pdfBtn && pdfBtn.dataset.bound !== '1') {
        pdfBtn.addEventListener('click', () => {
            showToast('Đang mở cửa sổ in để xuất PDF...', 'info', { duration: 1800 });
            window.print();
        });
        pdfBtn.dataset.bound = '1';
    }

    const csvBtn = getElem('exportCsvBtn');
    if (csvBtn && csvBtn.dataset.bound !== '1') {
        csvBtn.addEventListener('click', exportTicketsCsv);
        csvBtn.dataset.bound = '1';
    }
};

const clearUnsubs = () => {
    state.unsubscribers.forEach((unsub) => {
        if (typeof unsub === 'function') unsub();
    });
    state.unsubscribers = [];
};

const subscribeRealtime = () => {
    clearUnsubs();

    const unsubTickets = onSnapshot(collection(db, BORROW_COLLECTION), (snap) => {
        state.tickets = normalizeTickets(snap.docs);
        render();
    }, (err) => {
        console.error('reports tickets snapshot error:', err);
    });

    const unsubUsers = onSnapshot(collection(db, USER_COLLECTION), (snap) => {
        state.users = normalizeUsers(snap.docs);
        render();
    }, (err) => {
        console.error('reports users snapshot error:', err);
    });

    const unsubBooks = onSnapshot(collection(db, BOOK_COLLECTION), (snap) => {
        state.books = normalizeBooks(snap.docs);
        render();
    }, (err) => {
        console.error('reports books snapshot error:', err);
    });

    state.unsubscribers.push(unsubTickets, unsubUsers, unsubBooks);
};

const initDateRange = () => {
    const startInput = getElem('reportStartDate');
    const endInput = getElem('reportEndDate');
    if (!startInput || !endInput) return;

    const range = getCurrentMonthRange();
    startInput.value = toDateInputValue(range.startDate);
    endInput.value = toDateInputValue(range.endDate);
    state.startMs = range.startMs;
    state.endMs = range.endMs;
};

const initReportsPage = () => {
    if (!getElem('monthlyStatsBody')) return;

    clearUnsubs();
    initDateRange();
    bindRangeEvents();
    bindExport();
    subscribeRealtime();
};

// Khởi chạy — bảo vệ bằng admin guard
const guardedInit = () => {
    if (document.getElementById('monthlyStatsBody')) {
        requireAdmin(() => initReportsPage());
    }
};
document.addEventListener('turbo:load', guardedInit);
document.addEventListener('turbo:render', guardedInit);
if (document.readyState !== 'loading') guardedInit();
else document.addEventListener('DOMContentLoaded', guardedInit);

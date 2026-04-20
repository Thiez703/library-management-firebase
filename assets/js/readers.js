import { db } from './firebase-config.js';
import { requireAdmin } from './admin-guard.js';
import {
    collection,
    onSnapshot,
    addDoc,
    updateDoc,
    getDoc,
    getDocs,
    query,
    where,
    writeBatch,
    doc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";
import { showToast } from './auth.js';
import { calculateReputationFromMetrics, getBorrowTierByScore } from './identity.js';

const getElem = (id) => document.getElementById(id);
const AVATAR_PLACEHOLDER = '../assets/images/avatar-placeholder.svg';

const state = {
    readers: [],
    allUsers: [],
    borrowRecords: [],
    fines: [],
    readerMetricsByUser: new Map(),
    searchTerm: '',
    activeFilter: 'all',
    selectedReaderId: '',
    currentPage: 1,
    itemsPerPage: 10
};

const pageStartInfo = getElem('page-start-info');
const pageEndInfo = getElem('page-end-info');
const totalItemsInfo = getElem('total-items-info');
const paginationControls = getElem('pagination-controls');

let unsubscribeUsers = null;
let unsubscribeBorrowRecords = null;
let unsubscribeFines = null;

// Debounce: gom nhiều snapshot updates thành 1 lần render
let renderTimer = null;
const scheduleRender = () => {
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
        computeReaderMetrics();
        renderStats();
        renderTable();
        renderTimer = null;
    }, 60);
};

// Chống vòng lặp vô hạn: track uid+score đã sync, không sync lại
const syncedScores = new Map();

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

const toMillis = (value) => {
    if (!value) return null;
    if (typeof value.toMillis === 'function') return value.toMillis();
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.getTime();
};

const formatDate = (value) => {
    const ms = toMillis(value);
    if (!ms) return '--';
    return new Date(ms).toLocaleDateString('vi-VN');
};

const formatCurrency = (value) => `${Number(value || 0).toLocaleString('vi-VN')} ₫`;

const makeReaderCode = (id, user) => {
    const code = (user?.readerCode || user?.memberCode || '').toString().trim();
    if (code) return code;
    return 'US-' + (id || '').slice(0, 5).toUpperCase();
};

const makeInitials = (displayName, email) => {
    const base = (displayName || email || 'DG').toString().trim();
    const words = base.split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
        return (words[0][0] + words[words.length - 1][0]).toUpperCase();
    }
    return base.slice(0, 2).toUpperCase();
};

const getAvatarUrl = (user = {}) => {
    const avatar = (user?.photoURL || user?.avatar || user?.profileImage || '').toString().trim();
    return avatar || AVATAR_PLACEHOLDER;
};

const renderAvatarHTML = (user = {}, className = 'w-9 h-9') => {
    const initials = makeInitials(user?.displayName || user?.fullName, user?.email);
    return `
        <img src="${escapeHtml(getAvatarUrl(user))}" alt="Avatar" class="${className} rounded-full object-cover border border-slate-200"
            onerror="this.onerror=null;this.src='${AVATAR_PLACEHOLDER}';this.alt='${initials}'">
    `;
};

const isBlockedUser = (user = {}) => {
    if (user?.isBlocked === true) return true;
    const status = (user?.status || user?.accountStatus || '').toString().toLowerCase();
    return ['disabled', 'locked', 'blocked', 'inactive', 'banned'].includes(status);
};

const getTrustRankMeta = (score) => {
    const trust = Math.max(0, Math.min(100, Number(score || 0)));
    const tier = getBorrowTierByScore(trust);
    if (trust >= 80) return { label: `${tier.label} (${tier.maxBooks} cuốn)`, barClass: 'bg-emerald-500', badgeClass: 'bg-emerald-50 text-emerald-700' };
    if (trust >= 70) return { label: `${tier.label} (${tier.maxBooks} cuốn)`, barClass: 'bg-blue-500', badgeClass: 'bg-blue-50 text-blue-700' };
    if (trust >= 60) return { label: `${tier.label} (${tier.maxBooks} cuốn)`, barClass: 'bg-cyan-500', badgeClass: 'bg-cyan-700/10 text-cyan-700' };
    if (trust >= 50) return { label: `${tier.label} (${tier.maxBooks} cuốn)`, barClass: 'bg-amber-500', badgeClass: 'bg-amber-50 text-amber-700' };
    if (trust >= 40) return { label: `${tier.label} (${tier.maxBooks} cuốn)`, barClass: 'bg-orange-500', badgeClass: 'bg-orange-50 text-orange-700' };
    return { label: tier.label, barClass: 'bg-rose-500', badgeClass: 'bg-rose-50 text-rose-700' };
};

const calcTrustScore = (user, metric) => {
    const baseScore = Number.isFinite(Number(user?.reputationScore))
        ? Number(user.reputationScore)
        : (Number.isFinite(Number(user?.trustScore)) ? Number(user.trustScore) : 100);

    return calculateReputationFromMetrics(baseScore, metric);
};

const syncReaderReputationScore = async (uid, userData, metric) => {
    if (!uid || !metric) return;
    const storedScore = Number.isFinite(Number(userData?.reputationScore))
        ? Number(userData.reputationScore)
        : (Number.isFinite(Number(userData?.trustScore)) ? Number(userData.trustScore) : 100);
    const nextScore = Number(metric.trustScore);
    if (!Number.isFinite(nextScore) || nextScore === storedScore) return;
    // Chống vòng lặp: nếu uid+score đã sync rồi thì bỏ qua
    const key = `${uid}:${nextScore}`;
    if (syncedScores.has(key)) return;
    syncedScores.set(key, true);
    try {
        await updateDoc(doc(db, 'users', uid), { reputationScore: nextScore, trustScore: nextScore, updatedAt: serverTimestamp() });
    } catch (error) {
        syncedScores.delete(key);
        console.error('syncReaderReputationScore error:', error);
    }
};

const getReaderStatusMeta = (metric) => {
    if (metric.isBlocked) return { label: 'Bị khóa', badgeClass: 'bg-rose-50 text-rose-700', dotClass: 'bg-rose-500' };
    if (metric.unpaidFine > 0) return { label: 'Nợ phạt', badgeClass: 'bg-orange-50 text-orange-700', dotClass: 'bg-orange-500' };
    if (metric.overdueItems > 0) return { label: 'Quá hạn', badgeClass: 'bg-amber-50 text-amber-700', dotClass: 'bg-amber-500' };
    return { label: 'Hoạt động', badgeClass: 'bg-emerald-50 text-emerald-700', dotClass: 'bg-emerald-500' };
};

const getRiskRowClass = (metric) => {
    if (metric.isBlocked || metric.trustScore < 40) return 'bg-[#fff5f5] hover:bg-[#ffecec]';
    if (metric.unpaidFine > 0) return 'bg-[#fffbeb] hover:bg-[#fff5dc]';
    return 'bg-white hover:bg-slate-50/80';
};

const buildTrustTimeline = (user, metric) => {
    const customHistory = Array.isArray(user?.trustHistory) ? user.trustHistory : [];
    const customRows = customHistory.map((event) => ({
        dateMs: toMillis(event?.createdAt || event?.date || event?.timestamp),
        dateLabel: formatDate(event?.createdAt || event?.date || event?.timestamp),
        message: event?.reason || event?.message || 'Cập nhật điểm uy tín',
        delta: Number(event?.delta || event?.pointChange || 0)
    })).sort((a, b) => (b.dateMs || 0) - (a.dateMs || 0));
    if (customRows.length) return customRows;
    const events = [];
    if (metric.unpaidFine > 0) events.push({ dateMs: Date.now(), dateLabel: 'Hiện tại', message: 'Có phiếu phạt chưa thanh toán', delta: -20 });
    if (metric.overdueItems > 0) events.push({ dateMs: Date.now() - 1, dateLabel: 'Hiện tại', message: `${metric.overdueItems} đầu sách đang quá hạn`, delta: -12 });
    if (metric.isBlocked) events.push({ dateMs: Date.now() - 2, dateLabel: 'Hiện tại', message: 'Tài khoản đang ở trạng thái bị khóa', delta: -25 });
    if (!events.length) events.push({ dateMs: Date.now(), dateLabel: 'Hiện tại', message: 'Không có vi phạm đáng chú ý', delta: 0 });
    return events;
};

const computeReaderMetrics = () => {
    const map = new Map();
    const fineRecordIds = new Set();
    state.readers.forEach((reader) => {
        map.set(reader.id, {
            borrowCount: 0, overdueItems: 0, unpaidFine: 0, violationCount: 0,
            activeBorrowItems: [], finesHistory: [], trustScore: 100, isBlocked: isBlockedUser(reader.data),
            statusMeta: getReaderStatusMeta({ isBlocked: isBlockedUser(reader.data), unpaidFine: 0, overdueItems: 0 }),
            trustMeta: getTrustRankMeta(100), trustTimeline: []
        });
    });
    state.readerMetricsByUser = map;
    const now = Date.now();
    state.fines.forEach((fine) => {
        const userId = fine?.userId || fine?.uid || fine?.readerId;
        if (!userId || !map.has(userId)) return;
        const metric = map.get(userId);
        const amount = Number(fine?.amount || fine?.fineAmount || 0);
        const recordId = (fine?.recordId || '').toString().trim();
        if (recordId) fineRecordIds.add(recordId);
        if (fine?.status === 'unpaid') metric.unpaidFine += amount;
        metric.violationCount += 1;
        metric.finesHistory.push({ fineId: fine?.fineId || '--', amount, status: fine?.status || '--', daysLate: Number(fine?.daysLate || 0), createdAt: fine?.createdAt });
    });
    state.borrowRecords.forEach((record) => {
        const userId = record?.userId || record?.uid || record?.readerId;
        if (!userId || !map.has(userId)) return;
        const metric = map.get(userId);
        const books = Array.isArray(record?.books) && record.books.length ? record.books : [{ title: record?.bookTitle || 'Sách chưa rõ tên' }];
        const normalizedStatus = (record?.status || '').toString().toLowerCase();
        if (['borrowing', 'borrowed', 'overdue'].includes(normalizedStatus)) {
            metric.borrowCount += books.length;
            books.forEach((book) => {
                const dueMs = toMillis(record?.dueDate);
                const remainDays = dueMs ? Math.ceil((dueMs - now) / 86400000) : null;
                const isOverdue = remainDays !== null && remainDays < 0;
                if (isOverdue) metric.overdueItems += 1;
                metric.activeBorrowItems.push({ title: book?.title || record?.bookTitle || 'Sách chưa rõ tên', borrowDate: record?.borrowDate || record?.requestDate, dueDate: record?.dueDate, remainDays, isOverdue });
            });
        }
        const recordPenalty = Number(record?.fineOverdue || 0) + Number(record?.fineDamage || 0);
        const recordKey = (record?.recordId || '').toString().trim();
        if (recordPenalty > 0 && (!recordKey || !fineRecordIds.has(recordKey))) {
            metric.unpaidFine += recordPenalty;
            metric.violationCount += 1;
            metric.finesHistory.push({ fineId: recordKey || `legacy-${record.id}`, amount: recordPenalty, status: 'unpaid', daysLate: Number(record?.daysLate || 0), createdAt: record?.returnDate || record?.updatedAt });
        }
    });
    state.readers.forEach((reader) => {
        const metric = map.get(reader.id);
        if (!metric) return;
        metric.trustScore = calcTrustScore(reader.data, metric);
        metric.trustMeta = getTrustRankMeta(metric.trustScore);
        metric.statusMeta = getReaderStatusMeta(metric);
        metric.trustTimeline = buildTrustTimeline(reader.data, metric);
        void syncReaderReputationScore(reader.id, reader.data, metric);
    });
};

const renderStats = () => {
    const total = state.readers.length;
    const blocked = state.readers.filter((item) => state.readerMetricsByUser.get(item.id)?.isBlocked).length;
    const librarianCount = state.allUsers.filter(u => (u.data?.role || '').toLowerCase() === 'librarian').length;
    let totalUnpaid = 0;
    state.readerMetricsByUser.forEach((m) => totalUnpaid += m.unpaidFine);
    getElem('stat-total-readers').textContent = total.toLocaleString('vi-VN');
    getElem('stat-active-readers').textContent = Math.max(0, total - blocked).toLocaleString('vi-VN');
    getElem('stat-blocked-readers').textContent = blocked.toLocaleString('vi-VN');
    if (getElem('stat-librarian-count')) getElem('stat-librarian-count').textContent = librarianCount.toLocaleString('vi-VN');
    if (getElem('stat-total-unpaid-fines')) getElem('stat-total-unpaid-fines').textContent = formatCurrency(totalUnpaid);
};

const passesFilter = (reader, metric) => {
    if (!metric) return false;
    const user = reader?.data || {};
    const role = (user.role || 'user').toLowerCase();
    const type = (user.accountType || '').toLowerCase();
    switch (state.activeFilter) {
        case 'member': return role === 'user' && type !== 'guest';
        case 'guest': return type === 'guest';
        case 'librarian': return role === 'librarian';
        case 'borrowing': return metric.borrowCount > 0;
        case 'fines': return metric.unpaidFine > 0;
        case 'risk': return metric.trustScore < 50 || metric.isBlocked;
        default: return true;
    }
};

const renderPagination = (totalPages) => {
    if (!paginationControls || totalPages <= 1) { paginationControls.innerHTML = ''; return; }
    let html = `<button id="prevPage" class="p-2 rounded-lg border ${state.currentPage === 1 ? 'opacity-50 cursor-not-allowed' : 'hover:bg-slate-50'}"><i class="ph ph-caret-left"></i></button>`;
    for (let i = 1; i <= totalPages; i++) {
        if (totalPages > 5 && i !== 1 && i !== totalPages && Math.abs(i - state.currentPage) > 1) {
            if (i === 2 || i === totalPages - 1) html += '<span class="p-2 text-slate-400">...</span>';
            continue;
        }
        html += `<button data-page="${i}" class="min-w-[36px] h-9 px-2 rounded-lg text-sm font-medium ${i === state.currentPage ? 'bg-primary-600 text-white' : 'text-slate-600 hover:bg-slate-100'}">${i}</button>`;
    }
    html += `<button id="nextPage" class="p-2 rounded-lg border ${state.currentPage === totalPages ? 'opacity-50 cursor-not-allowed' : 'hover:bg-slate-50'}"><i class="ph ph-caret-right"></i></button>`;
    paginationControls.innerHTML = html;

    paginationControls.querySelector('#prevPage').onclick = () => { if (state.currentPage > 1) { state.currentPage--; renderTable(); } };
    paginationControls.querySelector('#nextPage').onclick = () => { if (state.currentPage < totalPages) { state.currentPage++; renderTable(); } };
    paginationControls.querySelectorAll('[data-page]').forEach(btn => {
        btn.onclick = () => { state.currentPage = parseInt(btn.dataset.page); renderTable(); };
    });
};

document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (!btn.closest('#readersTableBody') && !btn.closest('#readerDetailModal')) return;

    const action = btn.dataset.action;
    const uid = btn.dataset.uid;
    const reader = state.readers.find(r => r.id === uid);
    // Lưu ý: Nếu là nút trong Detail Modal, state.readers có thể không chứa nó nếu nó là Admin
    // Nhưng ở đây chúng ta chỉ quản lý Độc giả (User/Librarian)

    if (action === 'view') {
        const userData = reader ? reader.data : state.allUsers.find(u => u.id === uid)?.data;
        if (userData) openReaderDetail(uid, userData);
    } else if (action === 'edit') {
        if (reader) openReaderEdit(uid, reader.data);
    } else if (action === 'lock') {
        toggleLockReader(uid);
    } else if (action === 'settle-debt') {
        settleReaderDebt(uid);
    }
});

const renderTable = () => {
    const body = getElem('readersTableBody');
    if (!body) return;
    const term = normalizeText(state.searchTerm);
    const filtered = state.readers.filter(item => {
        const m = state.readerMetricsByUser.get(item.id);
        if (!passesFilter(item, m)) return false;
        if (!term) return true;
        const u = item.data || {};
        return normalizeText(u.displayName || u.fullName || '').includes(term) || normalizeText(u.email || '').includes(term) || normalizeText(u.phone || '').includes(term);
    });

    if (!filtered.length) {
        body.innerHTML = '<tr><td colspan="8" class="px-6 py-10 text-center text-slate-500 italic">Không có độc giả phù hợp.</td></tr>';
        return;
    }

    const totalPages = Math.ceil(filtered.length / state.itemsPerPage);
    const start = (state.currentPage - 1) * state.itemsPerPage;
    const rows = filtered.slice(start, start + state.itemsPerPage);

    if (pageStartInfo) pageStartInfo.textContent = start + 1;
    if (pageEndInfo) pageEndInfo.textContent = start + rows.length;
    if (totalItemsInfo) totalItemsInfo.textContent = filtered.length;

    body.innerHTML = rows.map(item => {
        const uid = item.id;
        const u = item.data || {};
        const m = state.readerMetricsByUser.get(uid) || { borrowCount: 0, unpaidFine: 0, trustScore: 100, isBlocked: false };
        const tm = getTrustRankMeta(m.trustScore);
        const sm = getReaderStatusMeta(m);
        const isLib = (u.role || '').toLowerCase() === 'librarian';

        return `
            <tr class="${getRiskRowClass(m)} transition-all duration-200 group" data-uid="${uid}">
                <td class="px-6 py-4">
                    <div class="flex items-center gap-3">
                        <div class="w-9 h-9 shrink-0">${renderAvatarHTML(u)}</div>
                        <div class="min-w-0">
                            <button type="button" data-action="view" data-uid="${uid}" class="font-semibold text-slate-800 hover:text-primary-600 text-left truncate block w-full">
                                ${escapeHtml(u.displayName || u.fullName || 'DG')}${isLib ? '<span class="ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-violet-100 text-violet-700 uppercase">Thủ thư</span>' : ''}
                            </button>
                            <p class="text-xs text-slate-500 truncate">${escapeHtml(u.phone || '---')}</p>
                        </div>
                    </div>
                </td>
                <td class="px-6 py-4 font-mono text-xs text-slate-600 hidden lg:table-cell">${makeReaderCode(uid, u)}</td>
                <td class="px-6 py-4 text-slate-600 hidden lg:table-cell truncate max-w-[150px]">${escapeHtml(u.email || '---')}</td>
                <td class="px-6 py-4 text-center font-semibold text-blue-700">${m.borrowCount}</td>
                <td class="px-6 py-4 text-right font-bold ${m.unpaidFine > 0 ? 'text-rose-700' : 'text-slate-400'}">${m.unpaidFine > 0 ? formatCurrency(m.unpaidFine) : '—'}</td>
                <td class="px-6 py-4">
                    <div class="flex items-center gap-2">
                        <div class="w-12 h-[5px] bg-slate-200 rounded-full overflow-hidden shrink-0"><div class="h-full ${tm.barClass}" style="width:${m.trustScore}%"></div></div>
                        <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${tm.badgeClass}">${tm.label}</span>
                    </div>
                </td>
                <td class="px-6 py-4">
                    <span class="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-medium whitespace-nowrap ${sm.badgeClass}">
                        <span class="w-1.5 h-1.5 rounded-full ${sm.dotClass}"></span>${sm.label}
                    </span>
                </td>
                <td class="px-6 py-4 text-right">
                    <div class="flex items-center justify-end gap-1">
                        <button type="button" title="Xem" data-action="view" data-uid="${uid}" class="p-2 text-blue-600 hover:bg-blue-50 rounded-lg"><i class="ph ph-eye text-lg pointer-events-none"></i></button>
                        ${m.unpaidFine > 0 ? `<button type="button" title="Thu nợ" data-action="settle-debt" data-uid="${uid}" class="p-2 text-emerald-600 hover:bg-emerald-50 rounded-lg"><i class="ph ph-hand-coins text-lg pointer-events-none"></i></button>` : ''}
                        <button type="button" title="Sửa" data-action="edit" data-uid="${uid}" class="p-2 text-slate-600 hover:bg-slate-50 rounded-lg"><i class="ph ph-pencil-simple text-lg pointer-events-none"></i></button>
                        <button type="button" title="${m.isBlocked ? 'Mở khóa' : 'Khóa'}" data-action="lock" data-uid="${uid}" class="p-2 ${m.isBlocked ? 'text-emerald-600 hover:bg-emerald-50' : 'text-rose-600 hover:bg-rose-50'} rounded-lg"><i class="ph ph-${m.isBlocked ? 'lock-open' : 'lock'} text-lg pointer-events-none"></i></button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    renderPagination(totalPages);
};

const openReaderDetail = (uid, userData) => {
    state.selectedReaderId = uid;
    const m = state.readerMetricsByUser.get(uid) || { borrowCount: 0, unpaidFine: 0, violationCount: 0, trustScore: 100, statusMeta: { label: 'Hoạt động' }, trustMeta: { label: 'Đồng' }, activeBorrowItems: [], finesHistory: [], trustTimeline: [] };
    const setText = (id, val) => { const el = getElem(id); if (el) el.textContent = val ?? '--'; };
    const trustMeta = getTrustRankMeta(m.trustScore);

    setText('readerDetailName', userData?.displayName || userData?.fullName || 'DG');
    setText('readerDetailCode', makeReaderCode(uid, userData));
    setText('readerDetailEmail', userData?.email);
    setText('readerDetailPhone', userData?.phone || userData?.phoneNumber);
    setText('readerDetailCreatedAt', formatDate(userData?.createdAt));
    setText('readerDetailMemberCode', makeReaderCode(uid, userData));
    setText('readerDetailStatus', m.statusMeta.label);
    setText('readerDetailTrustScore', m.trustScore);
    setText('readerDetailTrustRank', trustMeta.label);
    setText('readerDetailTotalDebt', formatCurrency(m.unpaidFine));
    setText('readerDetailViolationCount', m.violationCount || 0);
    setText('readerDetailBorrowing', m.borrowCount || 0);

    const avatarWrap = getElem('readerDetailAvatar');
    if (avatarWrap) {
        const avatarUrl = getAvatarUrl(userData);
        avatarWrap.innerHTML = `<img src="${escapeHtml(avatarUrl)}" alt="Avatar" class="w-16 h-16 rounded-full object-cover border border-slate-200" onerror="this.onerror=null;this.src='${AVATAR_PLACEHOLDER}'">`;
    }

    const trustBar = getElem('readerDetailTrustBar');
    if (trustBar) {
        trustBar.style.width = `${Math.max(0, Math.min(100, Number(m.trustScore || 0)))}%`;
        trustBar.className = `h-full ${trustMeta.barClass}`;
    }

    const trustRankEl = getElem('readerDetailTrustRank');
    if (trustRankEl) trustRankEl.className = `px-2.5 py-1 rounded-full text-xs font-semibold ${trustMeta.badgeClass}`;

    const trustTimeline = getElem('readerDetailTrustTimeline');
    if (trustTimeline) {
        trustTimeline.innerHTML = (m.trustTimeline || []).length
            ? m.trustTimeline.slice(0, 10).map((item) => `
                <div class="flex items-start justify-between gap-3 border border-slate-100 rounded-lg px-3 py-2 bg-white">
                    <div>
                        <p class="text-sm font-medium text-slate-700">${escapeHtml(item.message || '--')}</p>
                        <p class="text-xs text-slate-400 mt-0.5">${escapeHtml(item.dateLabel || '--')}</p>
                    </div>
                    <span class="text-xs font-semibold ${Number(item.delta) < 0 ? 'text-rose-600' : 'text-emerald-600'}">${Number(item.delta) > 0 ? '+' : ''}${Number(item.delta || 0)}</span>
                </div>
            `).join('')
            : '<p class="text-sm text-slate-400">Chưa có lịch sử uy tín.</p>';
    }

    const borrowingList = getElem('readerDetailBorrowingList');
    if (borrowingList) {
        borrowingList.innerHTML = (m.activeBorrowItems || []).length
            ? m.activeBorrowItems.map((item) => `
                <div class="border border-slate-100 rounded-lg px-3 py-2">
                    <p class="text-sm font-medium text-slate-700">${escapeHtml(item.title || '--')}</p>
                    <div class="text-xs text-slate-500 mt-1 flex flex-wrap gap-3">
                        <span>Mượn: ${formatDate(item.borrowDate)}</span>
                        <span>Hạn trả: ${formatDate(item.dueDate)}</span>
                        <span class="${item.isOverdue ? 'text-rose-600 font-semibold' : 'text-emerald-600'}">${item.remainDays === null ? '--' : (item.remainDays < 0 ? `Quá hạn ${Math.abs(item.remainDays)} ngày` : `Còn ${item.remainDays} ngày`)}</span>
                    </div>
                </div>
            `).join('')
            : '<p class="text-sm text-slate-400">Không có sách đang mượn.</p>';
    }

    const finesList = getElem('readerDetailFinesList');
    if (finesList) {
        finesList.innerHTML = (m.finesHistory || []).length
            ? m.finesHistory.slice(0, 10).map((fine) => `
                <div class="border border-slate-100 rounded-lg px-3 py-2">
                    <div class="flex items-center justify-between gap-3">
                        <p class="text-sm font-medium text-slate-700">${escapeHtml(fine.fineId || '--')}</p>
                        <span class="text-xs font-semibold ${fine.status === 'unpaid' ? 'text-rose-600' : 'text-emerald-600'}">${fine.status === 'unpaid' ? 'Chưa thanh toán' : 'Đã xử lý'}</span>
                    </div>
                    <div class="text-xs text-slate-500 mt-1 flex flex-wrap gap-3">
                        <span>Số tiền: ${formatCurrency(fine.amount)}</span>
                        <span>Trễ: ${Number(fine.daysLate || 0)} ngày</span>
                        <span>Ngày: ${formatDate(fine.createdAt)}</span>
                    </div>
                </div>
            `).join('')
            : '<p class="text-sm text-slate-400">Không có lịch sử phạt.</p>';
    }

    const detailEditBtn = getElem('readerDetailEditBtn');
    if (detailEditBtn) detailEditBtn.onclick = () => openReaderEdit(uid, userData);

    getElem('readerDetailModal')?.classList.remove('hidden');

    const lockBtn = getElem('readerDetailLockBtn');
    if (lockBtn) {
        lockBtn.innerHTML = m.isBlocked ? '<i class="ph ph-lock-open mr-1"></i> Mở khóa' : '<i class="ph ph-lock mr-1"></i> Khóa';
        lockBtn.onclick = () => toggleLockReader(uid);
    }
};

const openReaderEdit = (uid, userData) => {
    getElem('editReaderId').value = uid;
    getElem('editReaderName').value = userData?.displayName || userData?.fullName || '';
    getElem('editReaderPhone').value = userData?.phone || '';
    getElem('editReaderEmail').value = userData?.email || '';
    getElem('readerEditModal')?.classList.remove('hidden');
};

const toggleLockReader = async (uid) => {
    const reader = state.readers.find(r => r.id === uid);
    if (!reader) return;
    const isLocked = isBlockedUser(reader.data);
    if (!window.confirm(`Bạn có chắc muốn ${isLocked ? 'Mở khóa' : 'Khóa'} tài khoản này?`)) return;
    try {
        await updateDoc(doc(db, 'users', uid), { status: isLocked ? 'active' : 'locked', isBlocked: !isLocked, updatedAt: serverTimestamp() });
        showToast('Thành công!', 'success');
        getElem('readerDetailModal')?.classList.add('hidden');
    } catch (e) { showToast(e.message, 'error'); }
};

const settleReaderDebt = async (uid) => {
    if (!window.confirm('Xác nhận đã thu đủ tiền phạt?')) return;
    try {
        const snap = await getDocs(query(collection(db, 'fines'), where('userId', '==', uid), where('status', '==', 'unpaid')));
        const batch = writeBatch(db);
        snap.forEach(d => batch.update(d.ref, { status: 'paid', paidAt: serverTimestamp() }));
        await batch.commit();
        showToast('Đã thu nợ thành công!', 'success');
    } catch (e) { showToast(e.message, 'error'); }
};

// ── Export Excel ─────────────────────────────────────────────────────────────
const exportReadersExcel = () => {
    if (typeof XLSX === 'undefined') {
        showToast('Thư viện xuất Excel chưa được tải.', 'error');
        return;
    }
    const rows = state.readers.map(item => {
        const u = item.data || {};
        const m = state.readerMetricsByUser.get(item.id) || {};
        return {
            'Họ và Tên': u.displayName || u.fullName || '',
            'Mã Độc Giả': makeReaderCode(item.id, u),
            'Email': u.email || '',
            'Số ĐT': u.phone || '',
            'Vai trò': u.role === 'librarian' ? 'Thủ thư' : 'Độc giả',
            'Đang mượn': m.borrowCount || 0,
            'Nợ phạt': m.unpaidFine || 0,
            'Điểm uy tín': m.trustScore || 100,
            'Trạng thái': m.statusMeta?.label || 'Hoạt động',
            'Ngày tạo': formatDate(u.createdAt)
        };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Độc Giả');
    XLSX.writeFile(wb, `danh-sach-doc-gia-${new Date().toISOString().slice(0, 10)}.xlsx`);
    showToast('Đã xuất Excel thành công!', 'success');
};

// ── Promote Librarian ─────────────────────────────────────────────────────────
const initPromoteLibrarianModal = () => {
    const modal = getElem('promoteLibrarianModal');
    const closeModal = () => {
        modal?.classList.add('hidden');
        getElem('promoteUserSearch').value = '';
        getElem('promoteUserId').value = '';
        getElem('promoteUserSelected')?.classList.add('hidden');
        getElem('promoteUserDropdown')?.classList.add('hidden');
        getElem('promoteNote').value = '';
    };

    getElem('closePromoteLibrarianModal')?.addEventListener('click', closeModal);
    getElem('cancelPromoteLibrarianBtn')?.addEventListener('click', closeModal);

    const renderPromoteDropdown = (term) => {
        const dropdown = getElem('promoteUserDropdown');
        if (!dropdown) return;
        const candidates = state.allUsers.filter(u => {
            const role = (u.data?.role || '').toLowerCase();
            if (role === 'admin' || role === 'librarian') return false;
            if (!term) return true;
            return normalizeText(u.data?.displayName || '').includes(term)
                || normalizeText(u.data?.email || '').includes(term)
                || normalizeText(u.data?.phone || '').includes(term);
        }).slice(0, 10);

        if (!candidates.length) { dropdown.classList.add('hidden'); return; }

        dropdown.innerHTML = candidates.map(u => `
            <button type="button" data-promote-uid="${u.id}"
                class="w-full text-left px-4 py-3 hover:bg-violet-50 active:bg-violet-100 transition-colors flex items-center gap-3 border-b border-slate-100 last:border-0">
                <div class="w-8 h-8 rounded-full bg-violet-100 text-violet-600 flex items-center justify-center font-bold text-xs shrink-0">
                    ${makeInitials(u.data?.displayName, u.data?.email)}
                </div>
                <div class="min-w-0">
                    <p class="text-sm font-medium text-slate-800 truncate">${escapeHtml(u.data?.displayName || u.data?.email || '')}</p>
                    <p class="text-xs text-slate-500 truncate">${escapeHtml(u.data?.email || '')}${u.data?.phone ? ' · ' + escapeHtml(u.data.phone) : ''}</p>
                </div>
            </button>
        `).join('');
        dropdown.classList.remove('hidden');
    };

    const selectPromoteUser = (uid) => {
        const user = state.allUsers.find(u => u.id === uid);
        if (!user) return;
        getElem('promoteUserId').value = uid;
        getElem('promoteUserSearch').value = user.data?.displayName || user.data?.email || '';
        getElem('promoteUserAvatar').textContent = makeInitials(user.data?.displayName, user.data?.email);
        getElem('promoteUserName').textContent = user.data?.displayName || '---';
        getElem('promoteUserEmail').textContent = user.data?.email || '---';
        getElem('promoteUserSelected')?.classList.remove('hidden');
        getElem('promoteUserDropdown')?.classList.add('hidden');
    };

    // Dùng event delegation trên dropdown để không cần re-bind sau mỗi render
    getElem('promoteUserDropdown')?.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-promote-uid]');
        if (btn) selectPromoteUser(btn.dataset.promoteUid);
    });

    // Input: gợi ý từ 1 ký tự
    getElem('promoteUserSearch')?.addEventListener('input', (e) => {
        const term = normalizeText(e.target.value);
        renderPromoteDropdown(term);
    });

    // Click vào ô input → hiện tất cả user (nếu chưa có giá trị)
    getElem('promoteUserSearch')?.addEventListener('focus', (e) => {
        if (!getElem('promoteUserId')?.value) {
            renderPromoteDropdown(normalizeText(e.target.value));
        }
    });

    // Ẩn dropdown khi click ra ngoài
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#promoteLibrarianModal')) return;
        if (!e.target.closest('#promoteUserSearch') && !e.target.closest('#promoteUserDropdown')) {
            getElem('promoteUserDropdown')?.classList.add('hidden');
        }
    });

    getElem('promoteUserClear')?.addEventListener('click', () => {
        getElem('promoteUserId').value = '';
        getElem('promoteUserSearch').value = '';
        getElem('promoteUserSelected')?.classList.add('hidden');
        getElem('promoteUserDropdown')?.classList.add('hidden');
    });

    getElem('promoteLibrarianForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const uid = getElem('promoteUserId')?.value?.trim();
        if (!uid) { showToast('Vui lòng chọn tài khoản cần nâng cấp.', 'error'); return; }
        const permissions = [...document.querySelectorAll('#promoteLibrarianForm input[name="perm"]:checked')]
            .map(cb => cb.value);
        const note = getElem('promoteNote')?.value?.trim() || '';
        try {
            await updateDoc(doc(db, 'users', uid), {
                role: 'librarian',
                permissions,
                promotedAt: serverTimestamp(),
                ...(note && { promoteNote: note }),
                updatedAt: serverTimestamp()
            });
            showToast('Nâng cấp thành Thủ Thư thành công!', 'success');
            closeModal();
        } catch (err) {
            showToast(err.message || 'Lỗi khi nâng cấp.', 'error');
        }
    });
};

// ── Guest Reader ──────────────────────────────────────────────────────────────
const initGuestReaderModal = () => {
    const modal = getElem('guestReaderModal');
    const closeModal = () => {
        modal?.classList.add('hidden');
        getElem('guestReaderForm')?.reset();
    };

    getElem('closeGuestReaderModal')?.addEventListener('click', closeModal);
    getElem('cancelGuestReaderBtn')?.addEventListener('click', closeModal);

    getElem('guestReaderForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fullName = getElem('guestFullName')?.value?.trim();
        const phone = getElem('guestPhone')?.value?.trim();
        const cccd = getElem('guestCccd')?.value?.trim();
        const email = getElem('guestEmail')?.value?.trim() || null;
        const note = getElem('guestNote')?.value?.trim() || '';

        if (!fullName || !phone || !cccd) {
            showToast('Vui lòng điền đầy đủ họ tên, SĐT và CCCD.', 'error');
            return;
        }
        if (!/^0\d{9}$/.test(phone)) {
            showToast('Số điện thoại không hợp lệ (10 số, bắt đầu bằng 0).', 'error');
            return;
        }

        try {
            const newUser = {
                displayName: fullName,
                phone,
                cccdLast4: cccd.slice(-4),
                email,
                role: 'user',
                accountType: 'guest',
                status: 'active',
                isVerified: true,
                reputationScore: 100,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                ...(note && { adminNote: note })
            };
            const ref = await addDoc(collection(db, 'users'), newUser);
            showToast(`Đã tạo độc giả vãng lai: ${fullName} (${makeReaderCode(ref.id, {})})`, 'success');
            closeModal();
        } catch (err) {
            showToast(err.message || 'Lỗi khi tạo độc giả.', 'error');
        }
    });
};

const initReaders = () => {
    let searchTimer = null;
    getElem('readerSearchInput')?.addEventListener('input', (e) => {
        state.searchTerm = e.target.value;
        state.currentPage = 1;
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = setTimeout(() => renderTable(), 150);
    });
    document.querySelectorAll('.reader-filter-tab').forEach(tab => {
        tab.onclick = () => {
            state.activeFilter = tab.dataset.filter; state.currentPage = 1;
            document.querySelectorAll('.reader-filter-tab').forEach(t => t.classList.remove('bg-primary-600', 'text-white'));
            tab.classList.add('bg-primary-600', 'text-white');
            renderTable();
        };
    });
    getElem('closeReaderDetailModal')?.addEventListener('click', () => getElem('readerDetailModal')?.classList.add('hidden'));
    getElem('closeReaderEditModal')?.addEventListener('click', () => getElem('readerEditModal')?.classList.add('hidden'));
    getElem('cancelReaderEditBtn')?.addEventListener('click', () => getElem('readerEditModal')?.classList.add('hidden'));

    // Export Excel
    getElem('exportReadersBtn')?.addEventListener('click', exportReadersExcel);

    // Mở modal Thêm Vãng Lai
    getElem('addGuestReaderBtn')?.addEventListener('click', () => getElem('guestReaderModal')?.classList.remove('hidden'));

    // Mở modal Tạo Thủ Thư
    getElem('promoteLibrarianBtn')?.addEventListener('click', () => getElem('promoteLibrarianModal')?.classList.remove('hidden'));

    // Init sub-modal handlers
    initGuestReaderModal();
    initPromoteLibrarianModal();

    getElem('readerEditForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const uid = getElem('editReaderId')?.value?.trim();
        const displayName = getElem('editReaderName')?.value?.trim();
        const phone = getElem('editReaderPhone')?.value?.trim();
        const email = getElem('editReaderEmail')?.value?.trim();
        if (!uid || !displayName) {
            showToast('Họ tên không được để trống.', 'error');
            return;
        }
        try {
            await updateDoc(doc(db, 'users', uid), {
                displayName,
                ...(phone && { phone }),
                ...(email && { email }),
                updatedAt: serverTimestamp()
            });
            showToast('Cập nhật thông tin độc giả thành công!', 'success');
            getElem('readerEditModal')?.classList.add('hidden');
        } catch (err) {
            showToast(err.message || 'Lỗi khi lưu thông tin.', 'error');
        }
    });

    onSnapshot(collection(db, 'users'), snap => {
        const docs = snap.docs.map(d => ({ id: d.id, data: d.data() }));
        state.allUsers = docs;
        state.readers = docs.filter(u => (u.data.role || '').toLowerCase() !== 'admin');
        scheduleRender();
    });
    onSnapshot(collection(db, 'borrowRecords'), snap => {
        state.borrowRecords = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        scheduleRender();
    });
    onSnapshot(collection(db, 'fines'), snap => {
        state.fines = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        scheduleRender();
    });
};

requireAdmin(() => initReaders());

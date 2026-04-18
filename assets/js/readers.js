import { db } from './firebase-config.js';
import { requireAdmin } from './admin-guard.js';
import {
    collection,
    onSnapshot,
    addDoc,
    updateDoc,
    doc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";
import { showToast } from './auth.js';

const getElem = (id) => document.getElementById(id);

const state = {
    readers: [],
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

const isBlockedUser = (user = {}) => {
    if (user?.isBlocked === true) return true;
    const status = (user?.status || user?.accountStatus || '').toString().toLowerCase();
    return ['disabled', 'locked', 'blocked', 'inactive', 'banned'].includes(status);
};

const getTrustRankMeta = (score) => {
    const trust = Math.max(0, Math.min(100, Number(score || 0)));
    if (trust >= 90) {
        return { label: 'Xuất sắc', barClass: 'bg-emerald-500', badgeClass: 'bg-emerald-50 text-emerald-700' };
    }
    if (trust >= 70) {
        return { label: 'Tốt', barClass: 'bg-blue-500', badgeClass: 'bg-blue-50 text-blue-700' };
    }
    if (trust >= 50) {
        return { label: 'Trung bình', barClass: 'bg-amber-500', badgeClass: 'bg-amber-50 text-amber-700' };
    }
    return { label: 'Kém', barClass: 'bg-rose-500', badgeClass: 'bg-rose-50 text-rose-700' };
};

const calcTrustScore = (user, metric) => {
    if (Number.isFinite(Number(user?.trustScore))) {
        return Math.max(0, Math.min(100, Number(user.trustScore)));
    }

    let score = 100;
    score -= Math.min(35, metric.overdueItems * 12);
    score -= Math.min(30, metric.unpaidFine > 0 ? 20 : 0);
    score -= Math.min(20, metric.violationCount * 4);
    score -= metric.isBlocked ? 25 : 0;
    return Math.max(0, Math.min(100, Math.round(score)));
};

const getReaderStatusMeta = (metric) => {
    if (metric.isBlocked) {
        return {
            label: 'Bị khóa',
            badgeClass: 'bg-rose-50 text-rose-700',
            dotClass: 'bg-rose-500'
        };
    }

    if (metric.unpaidFine > 0) {
        return {
            label: 'Nợ phạt',
            badgeClass: 'bg-orange-50 text-orange-700',
            dotClass: 'bg-orange-500'
        };
    }

    if (metric.overdueItems > 0) {
        return {
            label: 'Quá hạn',
            badgeClass: 'bg-amber-50 text-amber-700',
            dotClass: 'bg-amber-500'
        };
    }

    return {
        label: 'Hoạt động',
        badgeClass: 'bg-emerald-50 text-emerald-700',
        dotClass: 'bg-emerald-500'
    };
};

const getRiskRowClass = (metric) => {
    if (metric.isBlocked || metric.trustScore < 40) {
        return 'bg-[#fff5f5] hover:bg-[#ffecec]';
    }
    if (metric.unpaidFine > 0) {
        return 'bg-[#fffbeb] hover:bg-[#fff5dc]';
    }
    return 'bg-white hover:bg-slate-50/80';
};

const buildTrustTimeline = (user, metric) => {
    const customHistory = Array.isArray(user?.trustHistory) ? user.trustHistory : [];
    const customRows = customHistory
        .map((event) => ({
            dateMs: toMillis(event?.createdAt || event?.date || event?.timestamp),
            dateLabel: formatDate(event?.createdAt || event?.date || event?.timestamp),
            message: event?.reason || event?.message || 'Cập nhật điểm uy tín',
            delta: Number(event?.delta || event?.pointChange || 0)
        }))
        .sort((a, b) => (b.dateMs || 0) - (a.dateMs || 0));

    if (customRows.length) return customRows;

    const events = [];
    if (metric.unpaidFine > 0) {
        events.push({
            dateMs: Date.now(),
            dateLabel: 'Hiện tại',
            message: 'Có phiếu phạt chưa thanh toán',
            delta: -20
        });
    }
    if (metric.overdueItems > 0) {
        events.push({
            dateMs: Date.now() - 1,
            dateLabel: 'Hiện tại',
            message: `${metric.overdueItems} đầu sách đang quá hạn`,
            delta: -12
        });
    }
    if (metric.isBlocked) {
        events.push({
            dateMs: Date.now() - 2,
            dateLabel: 'Hiện tại',
            message: 'Tài khoản đang ở trạng thái bị khóa',
            delta: -25
        });
    }

    if (!events.length) {
        events.push({
            dateMs: Date.now(),
            dateLabel: 'Hiện tại',
            message: 'Không có vi phạm đáng chú ý',
            delta: 0
        });
    }

    return events;
};

const computeReaderMetrics = () => {
    const map = new Map();

    state.readers.forEach((reader) => {
        map.set(reader.id, {
            borrowCount: 0,
            overdueItems: 0,
            unpaidFine: 0,
            violationCount: 0,
            activeBorrowItems: [],
            finesHistory: [],
            trustScore: 100,
            isBlocked: isBlockedUser(reader.data),
            statusMeta: getReaderStatusMeta({ isBlocked: isBlockedUser(reader.data), unpaidFine: 0, overdueItems: 0 }),
            trustMeta: getTrustRankMeta(100),
            trustTimeline: []
        });
    });

    // Keep defaults available even if any later record has unexpected shape.
    state.readerMetricsByUser = map;

    const now = Date.now();

    state.borrowRecords.forEach((record) => {
        if (!record || typeof record !== 'object') return;
        const userId = record?.userId;
        if (!userId || !map.has(userId)) return;

        const metric = map.get(userId);
        const books = Array.isArray(record?.books) && record.books.length ? record.books : [{ title: record?.bookTitle || 'Sách chưa rõ tên' }];

        if (record?.status === 'borrowing') {
            metric.borrowCount += books.length;

            books.forEach((book) => {
                const dueMs = toMillis(record?.dueDate);
                const remainDays = dueMs ? Math.ceil((dueMs - now) / 86400000) : null;
                const isOverdue = remainDays !== null && remainDays < 0;

                if (isOverdue) metric.overdueItems += 1;

                metric.activeBorrowItems.push({
                    title: (book?.title || record?.bookTitle || 'Sách chưa rõ tên').toString(),
                    borrowDate: record?.borrowDate || record?.requestDate,
                    dueDate: record?.dueDate,
                    remainDays,
                    isOverdue
                });
            });
        }

        if (Number(record?.fineOverdue || 0) > 0 || Number(record?.fineDamage || 0) > 0) {
            metric.violationCount += 1;
        }
    });

    state.fines.forEach((fine) => {
        if (!fine || typeof fine !== 'object') return;
        const userId = fine?.userId;
        if (!userId || !map.has(userId)) return;

        const metric = map.get(userId);
        const amount = Number(fine?.amount || fine?.fineAmount || 0);

        if ((fine?.status || '').toString().toLowerCase() === 'unpaid') {
            metric.unpaidFine += amount;
        }

        metric.violationCount += 1;
        metric.finesHistory.push({
            fineId: fine?.fineId || '--',
            amount,
            status: fine?.status || '--',
            daysLate: Number(fine?.daysLate || 0),
            createdAt: fine?.createdAt,
            paidAt: fine?.paidAt,
            waivedAt: fine?.waivedAt,
            waivedReason: fine?.waivedReason || '',
            bookTitles: Array.isArray(fine?.bookTitles) ? fine.bookTitles : []
        });
    });

    state.readers.forEach((reader) => {
        const metric = map.get(reader.id);
        if (!metric) return;
        metric.activeBorrowItems.sort((a, b) => (toMillis(a?.dueDate) || 0) - (toMillis(b?.dueDate) || 0));
        metric.finesHistory.sort((a, b) => (toMillis(b?.createdAt || b?.paidAt || b?.waivedAt) || 0) - (toMillis(a?.createdAt || a?.paidAt || a?.waivedAt) || 0));
        metric.trustScore = calcTrustScore(reader.data, metric);
        metric.trustMeta = getTrustRankMeta(metric.trustScore);
        metric.statusMeta = getReaderStatusMeta(metric);
        metric.trustTimeline = buildTrustTimeline(reader.data, metric);
    });
};

const renderStats = () => {
    const total = state.readers.length;
    const blocked = state.readers.filter((item) => state.readerMetricsByUser.get(item.id)?.isBlocked).length;
    const active = Math.max(0, total - blocked);

    let totalUnpaid = 0;
    state.readerMetricsByUser.forEach((metric) => {
        totalUnpaid += Number(metric.unpaidFine || 0);
    });

    getElem('stat-total-readers').textContent = total.toLocaleString('vi-VN');
    getElem('stat-active-readers').textContent = active.toLocaleString('vi-VN');
    getElem('stat-blocked-readers').textContent = blocked.toLocaleString('vi-VN');

    const unpaidElem = getElem('stat-total-unpaid-fines');
    if (unpaidElem) {
        unpaidElem.textContent = formatCurrency(totalUnpaid);
        unpaidElem.classList.remove('text-slate-800', 'text-rose-600');
        unpaidElem.classList.add(totalUnpaid > 0 ? 'text-rose-600' : 'text-slate-800');
    }
};

const passesFilter = (metric) => {
    if (!metric) return false;

    if (state.activeFilter === 'borrowing') {
        return metric.borrowCount > 0;
    }
    if (state.activeFilter === 'fines') {
        return metric.unpaidFine > 0;
    }
    if (state.activeFilter === 'risk') {
        return metric.trustScore < 50 || metric.isBlocked;
    }
    return true;
};

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
        prevBtn.addEventListener('click', () => {
            state.currentPage -= 1;
            renderTable();
        });
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
        pageBtn.addEventListener('click', () => {
            state.currentPage = i;
            renderTable();
        });
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
        nextBtn.addEventListener('click', () => {
            state.currentPage += 1;
            renderTable();
        });
    }
    paginationControls.appendChild(nextBtn);
};

const renderTable = () => {
    const body = getElem('readersTableBody');
    if (!body) return;

    const term = normalizeText(state.searchTerm);
    const filtered = state.readers.filter((item) => {
        const user = item.data || {};
        const uid = item.id;
        const metric = state.readerMetricsByUser.get(uid);
        if (!passesFilter(metric)) return false;

        if (!term) return true;

        const displayName = normalizeText(user.displayName || user.fullName || '');
        const email = normalizeText(user.email || '');
        const phone = normalizeText(user.phone || user.phoneNumber || '');
        const code = normalizeText(makeMemberCode(uid, user));

        return displayName.includes(term) || email.includes(term) || phone.includes(term) || code.includes(term);
    });

    if (!filtered.length) {
        body.innerHTML = '<tr><td colspan="8" class="px-6 py-10 text-center text-slate-500">Không có độc giả phù hợp.</td></tr>';
        if (pageStartInfo) pageStartInfo.textContent = '0';
        if (pageEndInfo) pageEndInfo.textContent = '0';
        if (totalItemsInfo) totalItemsInfo.textContent = '0';
        if (paginationControls) paginationControls.innerHTML = '';
        return;
    }

    const totalItems = filtered.length;
    const totalPages = Math.ceil(totalItems / state.itemsPerPage) || 1;
    if (state.currentPage > totalPages) state.currentPage = totalPages;
    if (state.currentPage < 1) state.currentPage = 1;

    const startIndex = (state.currentPage - 1) * state.itemsPerPage;
    const endIndex = Math.min(startIndex + state.itemsPerPage, totalItems);

    if (pageStartInfo) pageStartInfo.textContent = totalItems === 0 ? '0' : String(startIndex + 1);
    if (pageEndInfo) pageEndInfo.textContent = String(endIndex);
    if (totalItemsInfo) totalItemsInfo.textContent = String(totalItems);

    const currentRows = filtered.slice(startIndex, endIndex);

    body.innerHTML = currentRows.map((item) => {
        const uid = item.id;
        const user = item.data || {};
        const metric = state.readerMetricsByUser.get(uid) || {
            borrowCount: 0,
            unpaidFine: 0,
            trustScore: 100,
            trustMeta: getTrustRankMeta(100),
            statusMeta: getReaderStatusMeta({ isBlocked: false, unpaidFine: 0, overdueItems: 0 }),
            isBlocked: false
        };
        const trustMeta = metric.trustMeta || getTrustRankMeta(metric.trustScore || 100);
        const statusMeta = metric.statusMeta || getReaderStatusMeta(metric);

        const displayName = (user.displayName || user.fullName || user.email || 'Độc giả').toString();
        const phone = (user.phone || user.phoneNumber || '---').toString();
        const email = (user.email || '---').toString();
        const memberCode = makeMemberCode(uid, user);
        const initials = makeInitials(displayName, email);
        const riskClass = getRiskRowClass(metric);

        const debtCell = metric.unpaidFine > 0
            ? `<span class="font-bold text-rose-700">${formatCurrency(metric.unpaidFine)}</span>`
            : '<span class="text-slate-400">—</span>';

        return `
            <tr class="${riskClass} transition-colors group" data-uid="${uid}">
                <td class="px-6 py-4">
                    <div class="flex items-center gap-3">
                        <div class="w-9 h-9 rounded-full bg-violet-100 text-violet-600 flex items-center justify-center font-bold text-sm">${escapeHtml(initials)}</div>
                        <div>
                            <button data-action="view" data-uid="${uid}" class="font-semibold text-slate-800 hover:text-primary-600 text-left">${escapeHtml(displayName)}</button>
                            <p class="text-xs text-slate-500">${escapeHtml(phone)}</p>
                        </div>
                    </div>
                </td>
                <td class="px-6 py-4 font-mono text-xs text-slate-600 hidden lg:table-cell">${escapeHtml(memberCode)}</td>
                <td class="px-6 py-4 text-slate-600 hidden lg:table-cell">${escapeHtml(email)}</td>
                <td class="px-6 py-4 text-center font-semibold text-blue-700">${metric.borrowCount.toLocaleString('vi-VN')}</td>
                <td class="px-6 py-4 text-right">${debtCell}</td>
                <td class="px-6 py-4">
                    <div class="flex items-center gap-2">
                        <div class="w-12 h-[5px] bg-slate-200 rounded-full overflow-hidden">
                            <div class="h-full ${trustMeta.barClass}" style="width:${metric.trustScore}%"></div>
                        </div>
                        <span class="px-2 py-0.5 rounded-full text-[11px] font-semibold ${trustMeta.badgeClass}">${trustMeta.label}</span>
                    </div>
                </td>
                <td class="px-6 py-4">
                    <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${statusMeta.badgeClass}">
                        <span class="w-1.5 h-1.5 rounded-full ${statusMeta.dotClass}"></span>${statusMeta.label}
                    </span>
                </td>
                <td class="px-6 py-4 text-right">
                    <div class="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button title="Chi tiết" data-action="view" data-uid="${uid}" class="px-2.5 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md">Chi tiết</button>
                        <button title="Chỉnh sửa" data-action="edit" data-uid="${uid}" class="p-1.5 text-slate-600 hover:bg-slate-100 rounded-md"><i class="ph ph-pencil-simple text-lg"></i></button>
                        <button title="${metric.isBlocked ? 'Mở khóa' : 'Khóa'} tài khoản" data-action="lock" data-uid="${uid}" class="p-1.5 ${metric.isBlocked ? 'text-emerald-600 hover:bg-emerald-50' : 'text-rose-600 hover:bg-rose-50'} rounded-md"><i class="ph ph-${metric.isBlocked ? 'lock-open' : 'lock'} text-lg"></i></button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    body.querySelectorAll('[data-action]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const action = btn.getAttribute('data-action');
            const uid = btn.getAttribute('data-uid');
            const readerItem = state.readers.find((r) => r.id === uid);
            if (!readerItem) return;

            if (action === 'view') openReaderDetail(uid, readerItem.data);
            if (action === 'edit') openReaderEdit(uid, readerItem.data);
            if (action === 'lock') toggleLockReader(uid);
        });
    });

    renderPagination(totalPages);
};

const setFilterTabUI = () => {
    const tabs = document.querySelectorAll('.reader-filter-tab');
    tabs.forEach((tab) => {
        const value = tab.getAttribute('data-filter') || 'all';
        const isActive = value === state.activeFilter;
        tab.classList.remove('bg-primary-600', 'text-white', 'shadow-md', 'border-primary-600', 'text-slate-600', 'border-slate-200');
        if (isActive) {
            tab.classList.add('bg-primary-600', 'text-white', 'shadow-md', 'border-primary-600');
        } else {
            tab.classList.add('text-slate-600', 'border-slate-200');
        }
    });
};

const renderTrustTimeline = (timeline = []) => {
    const host = getElem('readerDetailTrustTimeline');
    if (!host) return;

    if (!timeline.length) {
        host.innerHTML = '<p class="text-sm text-slate-400">Chưa có sự kiện điểm uy tín.</p>';
        return;
    }

    host.innerHTML = timeline.slice(0, 10).map((event) => {
        const delta = Number(event.delta || 0);
        const deltaClass = delta > 0 ? 'text-emerald-600' : delta < 0 ? 'text-rose-600' : 'text-slate-500';
        const deltaLabel = delta > 0 ? `+${delta}` : `${delta}`;

        return `
            <div class="flex items-start justify-between gap-2 border border-slate-200 rounded-lg px-3 py-2 bg-white">
                <div>
                    <p class="text-sm font-medium text-slate-700">${escapeHtml(event.message || 'Cập nhật điểm uy tín')}</p>
                    <p class="text-xs text-slate-400 mt-0.5">${escapeHtml(event.dateLabel || '--')}</p>
                </div>
                <span class="text-xs font-semibold ${deltaClass}">${deltaLabel}</span>
            </div>
        `;
    }).join('');
};

const renderBorrowingList = (items = []) => {
    const host = getElem('readerDetailBorrowingList');
    if (!host) return;

    if (!items.length) {
        host.innerHTML = '<p class="text-sm text-slate-400">Hiện không có sách đang mượn.</p>';
        return;
    }

    host.innerHTML = items.map((item) => {
        let remainLabel = '--';
        let remainClass = 'text-slate-500';

        if (Number.isFinite(item.remainDays)) {
            if (item.remainDays < 0) {
                remainLabel = `Quá hạn ${Math.abs(item.remainDays)} ngày`;
                remainClass = 'text-rose-600';
            } else {
                remainLabel = `Còn ${item.remainDays} ngày`;
                remainClass = 'text-emerald-600';
            }
        }

        return `
            <div class="border border-slate-200 rounded-lg px-3 py-2 bg-slate-50/60">
                <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0">
                        <p class="text-sm font-semibold text-slate-800 truncate">${escapeHtml(item.title || 'Sách chưa rõ tên')}</p>
                        <p class="text-xs text-slate-500 mt-1">Mượn: ${formatDate(item.borrowDate)} · Hạn trả: ${formatDate(item.dueDate)}</p>
                    </div>
                    <p class="text-xs font-semibold ${remainClass}">${remainLabel}</p>
                </div>
            </div>
        `;
    }).join('');
};

const renderFineHistory = (rows = []) => {
    const host = getElem('readerDetailFinesList');
    if (!host) return;

    if (!rows.length) {
        host.innerHTML = '<p class="text-sm text-slate-400">Chưa có lịch sử phạt.</p>';
        return;
    }

    host.innerHTML = rows.slice(0, 10).map((fine) => {
        let statusClass = 'bg-slate-100 text-slate-600';
        let statusLabel = 'Không rõ';

        if (fine.status === 'unpaid') {
            statusClass = 'bg-rose-50 text-rose-700';
            statusLabel = 'Chưa thanh toán';
        } else if (fine.status === 'paid') {
            statusClass = 'bg-emerald-50 text-emerald-700';
            statusLabel = 'Đã thanh toán';
        } else if (fine.status === 'waived') {
            statusClass = 'bg-slate-100 text-slate-700';
            statusLabel = 'Đã miễn phạt';
        }

        return `
            <div class="border border-slate-200 rounded-lg px-3 py-2 bg-slate-50/60">
                <div class="flex items-center justify-between gap-2">
                    <p class="text-sm font-semibold text-slate-800">${escapeHtml(fine.fineId || '--')}</p>
                    <span class="px-2 py-0.5 rounded-full text-xs font-medium ${statusClass}">${statusLabel}</span>
                </div>
                <div class="flex items-center justify-between mt-1">
                    <p class="text-xs text-slate-500">${fine.daysLate || 0} ngày trễ · ${formatDate(fine.createdAt || fine.paidAt || fine.waivedAt)}</p>
                    <p class="text-sm font-bold ${fine.status === 'unpaid' ? 'text-rose-700' : 'text-slate-700'}">${formatCurrency(fine.amount)}</p>
                </div>
            </div>
        `;
    }).join('');
};

const openReaderDetail = (uid, userData) => {
    state.selectedReaderId = uid;

    const displayName = userData?.displayName || userData?.fullName || userData?.email || 'Độc giả';
    const email = userData?.email || '--';
    const phone = userData?.phone || userData?.phoneNumber || '--';
    const initials = makeInitials(displayName, email);
    const memberCode = makeMemberCode(uid, userData);

    const metric = state.readerMetricsByUser.get(uid) || {
        borrowCount: 0,
        unpaidFine: 0,
        violationCount: 0,
        trustScore: 100,
        trustMeta: getTrustRankMeta(100),
        statusMeta: getReaderStatusMeta({ isBlocked: false, unpaidFine: 0, overdueItems: 0 }),
        trustTimeline: [],
        activeBorrowItems: [],
        finesHistory: []
    };

    const setText = (id, value) => {
        const el = getElem(id);
        if (el) el.textContent = value ?? '--';
    };

    setText('readerDetailAvatar', initials);
    setText('readerDetailName', displayName);
    setText('readerDetailCode', memberCode);
    setText('readerDetailEmail', email);
    setText('readerDetailPhone', phone);
    setText('readerDetailCreatedAt', formatDate(userData?.createdAt));
    setText('readerDetailMemberCode', memberCode);
    setText('readerDetailStatus', metric.statusMeta.label);
    setText('readerDetailBorrowing', `${metric.borrowCount.toLocaleString('vi-VN')} cuốn`);
    setText('readerDetailTotalDebt', formatCurrency(metric.unpaidFine));
    setText('readerDetailViolationCount', `${metric.violationCount.toLocaleString('vi-VN')}`);
    setText('readerDetailTrustScore', `${metric.trustScore}`);
    setText('readerDetailTrustRank', metric.trustMeta.label);

    const trustBar = getElem('readerDetailTrustBar');
    if (trustBar) {
        trustBar.style.width = `${metric.trustScore}%`;
        trustBar.className = `h-full ${metric.trustMeta.barClass}`;
    }

    const trustBadge = getElem('readerDetailTrustRank');
    if (trustBadge) {
        trustBadge.className = `px-2.5 py-1 rounded-full text-xs font-semibold ${metric.trustMeta.badgeClass}`;
    }

    renderBorrowingList(metric.activeBorrowItems);
    renderFineHistory(metric.finesHistory);
    renderTrustTimeline(metric.trustTimeline);

    const lockBtn = getElem('readerDetailLockBtn');
    if (lockBtn) {
        lockBtn.innerHTML = metric.isBlocked
            ? '<i class="ph ph-lock-open mr-1"></i> Mở khóa tài khoản'
            : '<i class="ph ph-lock mr-1"></i> Khóa tài khoản';
        lockBtn.className = `flex-1 px-4 py-2.5 rounded-xl border font-semibold text-sm transition-colors ${
            metric.isBlocked
                ? 'border-emerald-200 text-emerald-600 hover:bg-emerald-50'
                : 'border-rose-200 text-rose-600 hover:bg-rose-50'
        }`;
        lockBtn.onclick = () => toggleLockReader(uid);
    }

    const editBtn = getElem('readerDetailEditBtn');
    if (editBtn) {
        editBtn.onclick = () => openReaderEdit(uid, userData);
    }

    getElem('readerDetailModal')?.classList.remove('hidden');
};

const openReaderEdit = (uid, userData) => {
    state.selectedReaderId = uid;

    if (getElem('editReaderId')) getElem('editReaderId').value = uid;
    if (getElem('editReaderName')) getElem('editReaderName').value = userData?.displayName || userData?.fullName || '';
    if (getElem('editReaderPhone')) getElem('editReaderPhone').value = userData?.phone || userData?.phoneNumber || '';
    if (getElem('editReaderEmail')) getElem('editReaderEmail').value = userData?.email || '';

    getElem('readerDetailModal')?.classList.add('hidden');
    getElem('readerEditModal')?.classList.remove('hidden');
};

const toggleLockReader = async (uid) => {
    const readerItem = state.readers.find((r) => r.id === uid);
    if (!readerItem) return;

    const currentlyBlocked = isBlockedUser(readerItem.data);
    const nextBlocked = !currentlyBlocked;
    const actionLabel = nextBlocked ? 'khóa' : 'mở khóa';

    try {
        await updateDoc(doc(db, 'users', uid), {
            status: nextBlocked ? 'locked' : 'active',
            isBlocked: nextBlocked,
            updatedAt: serverTimestamp()
        });

        showToast(`Đã ${actionLabel} tài khoản thành công.`, 'success');
        getElem('readerDetailModal')?.classList.add('hidden');
    } catch (error) {
        showToast(error?.message || `Không thể ${actionLabel} tài khoản.`, 'error');
    }
};

const bindReaderModals = () => {
    const detailCloseBtn = getElem('closeReaderDetailModal');
    if (detailCloseBtn && detailCloseBtn.dataset.bound !== '1') {
        detailCloseBtn.addEventListener('click', () => {
            getElem('readerDetailModal')?.classList.add('hidden');
            state.selectedReaderId = '';
        });
        detailCloseBtn.dataset.bound = '1';
    }

    const closeEditBtn = getElem('closeReaderEditModal');
    if (closeEditBtn && closeEditBtn.dataset.bound !== '1') {
        closeEditBtn.addEventListener('click', () => getElem('readerEditModal')?.classList.add('hidden'));
        closeEditBtn.dataset.bound = '1';
    }

    const cancelEditBtn = getElem('cancelReaderEditBtn');
    if (cancelEditBtn && cancelEditBtn.dataset.bound !== '1') {
        cancelEditBtn.addEventListener('click', () => getElem('readerEditModal')?.classList.add('hidden'));
        cancelEditBtn.dataset.bound = '1';
    }

    const editForm = getElem('readerEditForm');
    if (editForm && editForm.dataset.bound !== '1') {
        editForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const uid = getElem('editReaderId')?.value;
            if (!uid) return;

            const displayName = (getElem('editReaderName')?.value || '').trim();
            const phone = (getElem('editReaderPhone')?.value || '').trim();
            const email = (getElem('editReaderEmail')?.value || '').trim();

            if (!displayName) {
                showToast('Vui lòng nhập họ tên.', 'error');
                return;
            }

            try {
                await updateDoc(doc(db, 'users', uid), {
                    displayName,
                    phone,
                    email,
                    updatedAt: serverTimestamp()
                });
                showToast('Đã cập nhật thông tin độc giả thành công.', 'success');
                getElem('readerEditModal')?.classList.add('hidden');
            } catch (error) {
                showToast(error?.message || 'Không thể cập nhật thông tin.', 'error');
            }
        });
        editForm.dataset.bound = '1';
    }
};

const createGuestReader = async (fullName, phone, cccd, email = '', note = '') => {
    if (!fullName?.trim() || !phone?.trim() || !cccd?.trim()) {
        showToast('Vui lòng điền đầy đủ Họ tên, Số điện thoại và CCCD.', 'error');
        return;
    }

    try {
        const docRef = await addDoc(collection(db, 'users'), {
            displayName: fullName.trim(),
            email: email.trim() || '',
            phone: phone.trim(),
            role: 'user',
            status: 'active',
            isBlocked: false,
            accountType: 'guest',
            userDetails: {
                fullName: fullName.trim(),
                phone: phone.trim(),
                cccd: cccd.trim(),
                email: email.trim() || ''
            },
            guestNote: note.trim() || '',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });

        showToast(`✓ Tạo độc giả vãng lai thành công! ID: ${docRef.id}`, 'success');
        getElem('guestReaderModal')?.classList.add('hidden');
        getElem('guestReaderForm')?.reset();
        return docRef.id;
    } catch (error) {
        showToast('Lỗi: ' + (error?.message || 'Không thể tạo độc giả'), 'error');
    }
};

const bindGuestReaderModal = () => {
    const openBtn = getElem('addGuestReaderBtn');
    const closeBtn = getElem('closeGuestReaderModal');
    const cancelBtn = getElem('cancelGuestReaderBtn');
    const modal = getElem('guestReaderModal');
    const form = getElem('guestReaderForm');

    if (form?.dataset.bound === '1') return;

    if (openBtn) {
        openBtn.addEventListener('click', () => {
            modal?.classList.remove('hidden');
            form?.reset();
        });
    }

    const closeModal = () => modal?.classList.add('hidden');
    closeBtn?.addEventListener('click', closeModal);
    cancelBtn?.addEventListener('click', closeModal);

    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fullName = getElem('guestFullName')?.value || '';
            const phone = getElem('guestPhone')?.value || '';
            const cccd = getElem('guestCccd')?.value || '';
            const email = getElem('guestEmail')?.value || '';
            const note = getElem('guestNote')?.value || '';

            await createGuestReader(fullName, phone, cccd, email, note);
        });
        form.dataset.bound = '1';
    }
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

const bindFilterTabs = () => {
    const tabsHost = getElem('readerFilterTabs');
    if (!tabsHost || tabsHost.dataset.bound === '1') return;

    tabsHost.querySelectorAll('.reader-filter-tab').forEach((tab) => {
        tab.addEventListener('click', () => {
            state.activeFilter = tab.getAttribute('data-filter') || 'all';
            state.currentPage = 1;
            setFilterTabUI();
            renderTable();
        });
    });

    tabsHost.dataset.bound = '1';
    setFilterTabUI();
};

const renderAll = () => {
    try {
        computeReaderMetrics();
    } catch (error) {
        console.error('computeReaderMetrics error:', error);
        // Fallback: keep minimal metrics so table can still render.
        const fallbackMap = new Map();
        state.readers.forEach((reader) => {
            fallbackMap.set(reader.id, {
                borrowCount: 0,
                overdueItems: 0,
                unpaidFine: 0,
                violationCount: 0,
                activeBorrowItems: [],
                finesHistory: [],
                trustScore: 100,
                isBlocked: isBlockedUser(reader.data),
                trustMeta: getTrustRankMeta(100),
                statusMeta: getReaderStatusMeta({ isBlocked: isBlockedUser(reader.data), unpaidFine: 0, overdueItems: 0 }),
                trustTimeline: []
            });
        });
        state.readerMetricsByUser = fallbackMap;
    }

    renderStats();
    setFilterTabUI();
    renderTable();
};

const initReaders = () => {
    bindSearch();
    bindFilterTabs();
    bindGuestReaderModal();
    bindReaderModals();

    if (unsubscribeUsers) unsubscribeUsers();
    if (unsubscribeBorrowRecords) unsubscribeBorrowRecords();
    if (unsubscribeFines) unsubscribeFines();

    unsubscribeUsers = onSnapshot(
        collection(db, 'users'),
        (snapshot) => {
            state.readers = snapshot.docs
                .map((docSnap) => ({ id: docSnap.id, data: docSnap.data() || {} }))
                .filter((item) => {
                    const role = (item.data.role || '').toString().toLowerCase();
                    return role !== 'admin';
                });
            renderAll();
        },
        (error) => {
            console.error('users snapshot error:', error);
            showToast('Không tải được danh sách người dùng.', 'error');
        }
    );

    unsubscribeBorrowRecords = onSnapshot(
        collection(db, 'borrowRecords'),
        (snapshot) => {
            state.borrowRecords = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }));
            renderAll();
        },
        (error) => {
            console.error('borrowRecords snapshot error:', error);
        }
    );

    unsubscribeFines = onSnapshot(
        collection(db, 'fines'),
        (snapshot) => {
            state.fines = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }));
            renderAll();
        },
        (error) => {
            console.error('fines snapshot error:', error);
            // Keep page usable even if fines are temporarily unavailable.
            state.fines = [];
            renderAll();
        }
    );
};

const guardedInit = () => requireAdmin(() => initReaders());
document.addEventListener('turbo:load', guardedInit);
document.addEventListener('turbo:render', guardedInit);
if (document.readyState !== 'loading') guardedInit();
else document.addEventListener('DOMContentLoaded', guardedInit);

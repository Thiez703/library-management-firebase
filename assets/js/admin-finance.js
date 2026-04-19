/**
 * admin-finance.js — Trang tài chính & biểu phí
 * Tabs: Tổng quan | Biểu phí | Định giá sách | Lịch sử giao dịch
 */

import { db, auth } from './firebase-config.js';
import {
    collection, doc, getDoc, getDocs, setDoc, updateDoc,
    query, orderBy, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.0.0/firebase-auth.js';
import { showToast } from './notify.js';

// ── Constants ──────────────────────────────────────────────────────────────

const FEE_SCHEDULE_REF = () => doc(db, 'system', 'feeSchedule');

const DEFAULT_FEE_SCHEDULE = {
    lateFees: [
        { maxDays: 7, ratePerDay: 1000 },
        { maxDays: 30, ratePerDay: 2000 },
        { maxDays: null, ratePerDay: 5000 }
    ],
    damageLevels: [
        { id: 'light', label: 'Hư nhẹ', amount: 10000 },
        { id: 'medium', label: 'Hư vừa', amount: 50000 },
        { id: 'heavy', label: 'Hư nặng/Rách', amount: 150000 }
    ],
    lostBookMultiplier: 1.5,
    renewalFeeEnabled: false,
    renewalFee: 0
};

const PAGE_SIZE_BOOKS = 15;
const PAGE_SIZE_TX = 20;

// ── Helpers ────────────────────────────────────────────────────────────────

const getElem = (id) => document.getElementById(id);

const escHtml = (str) =>
    String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

const formatMoney = (n) => {
    const num = Number(n || 0);
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(1).replace(/\.0$/, '') + ' tr đ';
    if (num >= 1_000) return num.toLocaleString('vi-VN') + ' đ';
    return num + ' đ';
};

const formatMoneyShort = (n) => {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'tr';
    if (n >= 1_000) return Math.round(n / 1_000) + 'k';
    return String(n);
};

const formatDate = (ts) => {
    if (!ts) return '--';
    const d = ts?.toDate?.() || new Date(ts);
    if (isNaN(d.getTime())) return '--';
    return d.toLocaleDateString('vi-VN');
};

const getFineType = (fine) => {
    if (fine.type) return fine.type;
    if ((fine.overdueAmount > 0) && (fine.damageAmount > 0)) return 'both';
    if (fine.damageAmount > 0) return 'damage';
    return 'overdue';
};

const renderFineTypeBadge = (fine) => {
    const type = getFineType(fine);
    const map = {
        overdue: ['bg-rose-50 text-rose-700', 'Trễ hạn'],
        damage: ['bg-amber-50 text-amber-700', 'Hư hỏng'],
        lost: ['bg-purple-50 text-purple-700', 'Mất sách'],
        both: ['bg-orange-50 text-orange-700', 'Trễ + Hỏng']
    };
    const [cls, label] = map[type] || map.overdue;
    return `<span class="px-2 py-0.5 rounded-full text-xs font-semibold ${cls}">${label}</span>`;
};

const renderStatusBadge = (status) => {
    const map = {
        unpaid: ['bg-rose-50 text-rose-700', 'Chưa thu'],
        paid: ['bg-emerald-50 text-emerald-700', 'Đã thu'],
        waived: ['bg-slate-100 text-slate-600', 'Đã miễn']
    };
    const [cls, label] = map[status] || map.unpaid;
    return `<span class="px-2 py-0.5 rounded-full text-xs font-semibold ${cls}">${label}</span>`;
};

const renderPagination = (containerId, currentPage, totalPages, onPageChange) => {
    const container = getElem(containerId);
    if (!container) return;
    if (totalPages <= 1) { container.innerHTML = ''; return; }

    const btnCls = (active) =>
        `px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
            active
                ? 'bg-primary-600 text-white border-primary-600'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
        }`;

    let html = '';
    if (currentPage > 1) html += `<button data-page="${currentPage - 1}" class="${btnCls(false)}"><i class="ph ph-caret-left"></i></button>`;

    for (let i = 1; i <= totalPages; i++) {
        if (i === 1 || i === totalPages || Math.abs(i - currentPage) <= 1) {
            html += `<button data-page="${i}" class="${btnCls(i === currentPage)}">${i}</button>`;
        } else if (Math.abs(i - currentPage) === 2) {
            html += `<span class="px-1 text-slate-400">…</span>`;
        }
    }
    if (currentPage < totalPages) html += `<button data-page="${currentPage + 1}" class="${btnCls(false)}"><i class="ph ph-caret-right"></i></button>`;

    container.innerHTML = html;
    container.querySelectorAll('[data-page]').forEach(btn => {
        btn.addEventListener('click', () => onPageChange(parseInt(btn.dataset.page)));
    });
};

// ── Tab switching ──────────────────────────────────────────────────────────

let activeTab = 'dashboard';
const tabLoaded = new Set();

const switchTab = (tabName) => {
    activeTab = tabName;

    document.querySelectorAll('.finance-tab-btn').forEach(btn => {
        const isActive = btn.dataset.tab === tabName;
        btn.classList.toggle('bg-white', isActive);
        btn.classList.toggle('shadow-sm', isActive);
        btn.classList.toggle('text-primary-600', isActive);
        btn.classList.toggle('text-slate-600', !isActive);
    });

    document.querySelectorAll('.tab-panel').forEach(panel => {
        panel.classList.toggle('active', panel.id === `tab-${tabName}`);
    });

    if (!tabLoaded.has(tabName)) {
        tabLoaded.add(tabName);
        loadTabData(tabName);
    }
};

const loadTabData = (tabName) => {
    if (tabName === 'dashboard') loadDashboard();
    else if (tabName === 'fee-schedule') loadFeeSchedule();
    else if (tabName === 'book-pricing') loadBookPricing();
    else if (tabName === 'transactions') loadTransactions();
};

// ── Tab 1: Dashboard ───────────────────────────────────────────────────────

let allFinesCache = null;

const loadDashboard = async () => {
    try {
        const snap = await getDocs(collection(db, 'fines'));
        allFinesCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderDashboardStats(allFinesCache);
        renderMonthlyChart(allFinesCache);
        renderTopDebtors(allFinesCache);
        renderRecentFines(allFinesCache);
    } catch (err) {
        console.error('Dashboard load error:', err);
        showToast('Không thể tải dữ liệu tài chính.', 'error');
    }
};

const renderDashboardStats = (fines) => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const unpaid = fines.filter(f => f.status === 'unpaid');
    const paidMonth = fines.filter(f => {
        if (f.status !== 'paid') return false;
        const d = f.paidAt?.toDate?.();
        return d && d >= monthStart;
    });
    const waived = fines.filter(f => f.status === 'waived');
    const resolved = fines.filter(f => f.status !== 'unpaid');

    const recoveryRate = fines.length > 0 ? Math.round(resolved.length / fines.length * 100) : 0;

    const setText = (id, val) => { const el = getElem(id); if (el) el.textContent = val; };
    setText('statUnpaid', formatMoney(unpaid.reduce((s, f) => s + (f.amount || 0), 0)));
    setText('statUnpaidCount', `${unpaid.length} phiếu`);
    setText('statPaidMonth', formatMoney(paidMonth.reduce((s, f) => s + (f.amount || 0), 0)));
    setText('statPaidMonthCount', `${paidMonth.length} phiếu`);
    setText('statWaived', formatMoney(waived.reduce((s, f) => s + (f.amount || 0), 0)));
    setText('statWaivedCount', `${waived.length} phiếu`);
    setText('statRecoveryRate', `${recoveryRate}%`);
};

const renderMonthlyChart = (fines) => {
    const container = getElem('monthlyChart');
    if (!container) return;

    const now = new Date();
    const months = Array.from({ length: 6 }, (_, i) => {
        const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
        return {
            label: d.toLocaleDateString('vi-VN', { month: 'short', year: '2-digit' }),
            year: d.getFullYear(),
            month: d.getMonth(),
            total: 0
        };
    });

    for (const fine of fines) {
        if (fine.status !== 'paid' || !fine.paidAt) continue;
        const paidDate = fine.paidAt?.toDate?.();
        if (!paidDate) continue;
        const m = months.find(m => m.year === paidDate.getFullYear() && m.month === paidDate.getMonth());
        if (m) m.total += fine.amount || 0;
    }

    const maxVal = Math.max(...months.map(m => m.total), 1);
    const maxBarPx = 120;

    container.innerHTML = months.map(m => {
        const h = Math.max(4, Math.round((m.total / maxVal) * maxBarPx));
        return `
            <div class="flex-1 flex flex-col items-center gap-1">
                <span class="text-[10px] text-slate-500 font-medium leading-none">${m.total > 0 ? formatMoneyShort(m.total) : ''}</span>
                <div class="w-full rounded-t-md bar-chart-bar ${m.total > 0 ? 'bg-primary-400 hover:bg-primary-500' : 'bg-slate-100'}"
                    style="height:${h}px" title="${m.label}: ${formatMoney(m.total)}"></div>
                <span class="text-[10px] text-slate-400 text-center leading-tight">${m.label}</span>
            </div>`;
    }).join('');
};

const renderTopDebtors = (fines) => {
    const container = getElem('topDebtorsList');
    if (!container) return;

    const debtorMap = {};
    for (const fine of fines) {
        if (fine.status !== 'unpaid') continue;
        const uid = fine.userId || 'unknown';
        if (!debtorMap[uid]) debtorMap[uid] = { name: fine.userName || 'Độc giả', total: 0, count: 0 };
        debtorMap[uid].total += fine.amount || 0;
        debtorMap[uid].count += 1;
    }

    const sorted = Object.values(debtorMap).sort((a, b) => b.total - a.total).slice(0, 5);

    if (sorted.length === 0) {
        container.innerHTML = '<p class="text-sm text-slate-400 text-center py-6">Không có khoản nợ nào.</p>';
        return;
    }

    container.innerHTML = sorted.map((d, i) => `
        <div class="flex items-center gap-3 p-3 rounded-xl bg-slate-50">
            <span class="w-6 h-6 rounded-full bg-rose-100 text-rose-700 text-xs font-bold flex items-center justify-center shrink-0">${i + 1}</span>
            <div class="flex-1 min-w-0">
                <p class="text-sm font-semibold text-slate-800 truncate">${escHtml(d.name)}</p>
                <p class="text-xs text-slate-400">${d.count} phiếu chưa thu</p>
            </div>
            <span class="text-sm font-bold text-rose-600 shrink-0">${formatMoney(d.total)}</span>
        </div>`).join('');
};

const renderRecentFines = (fines) => {
    const tbody = getElem('recentFinesBody');
    if (!tbody) return;

    const sorted = [...fines]
        .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
        .slice(0, 10);

    if (sorted.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="py-8 text-center text-slate-400">Chưa có phiếu phạt nào.</td></tr>';
        return;
    }

    tbody.innerHTML = sorted.map(f => `
        <tr class="border-b border-slate-50 hover:bg-slate-50/60 transition-colors">
            <td class="py-3 pr-3 text-xs font-mono text-slate-400">${escHtml(f.fineId || f.id?.slice(0, 8) || '--')}</td>
            <td class="py-3 text-sm font-medium text-slate-800">${escHtml(f.userName || '--')}</td>
            <td class="py-3">${renderFineTypeBadge(f)}</td>
            <td class="py-3 text-right font-semibold text-slate-800">${formatMoney(f.amount)}</td>
            <td class="py-3 text-center">${renderStatusBadge(f.status)}</td>
        </tr>`).join('');
};

// ── Tab 2: Fee Schedule ────────────────────────────────────────────────────

let feeScheduleData = null;

const loadFeeSchedule = async () => {
    try {
        const snap = await getDoc(FEE_SCHEDULE_REF());
        feeScheduleData = snap.exists()
            ? { ...DEFAULT_FEE_SCHEDULE, ...snap.data() }
            : { ...DEFAULT_FEE_SCHEDULE };
    } catch {
        feeScheduleData = { ...DEFAULT_FEE_SCHEDULE };
    }
    renderFeeScheduleUI(feeScheduleData);
};

const renderFeeScheduleUI = (schedule) => {
    renderLateFees(schedule.lateFees);
    renderDamageLevels(schedule.damageLevels);

    const multiplierEl = getElem('lostBookMultiplier');
    if (multiplierEl) multiplierEl.value = schedule.lostBookMultiplier ?? 1.5;

    const renewalToggle = getElem('renewalFeeEnabled');
    if (renewalToggle) {
        renewalToggle.checked = !!schedule.renewalFeeEnabled;
        getElem('renewalFeeAmountRow')?.classList.toggle('hidden', !schedule.renewalFeeEnabled);
    }
    const renewalAmtEl = getElem('renewalFeeAmount');
    if (renewalAmtEl) renewalAmtEl.value = schedule.renewalFee ?? 0;
};

const renderLateFees = (tiers) => {
    const container = getElem('lateFeesTiers');
    if (!container) return;
    container.innerHTML = '';

    tiers.forEach((tier, idx) => {
        const isLast = idx === tiers.length - 1;
        const row = document.createElement('div');
        row.className = 'flex items-center gap-3 p-3 bg-slate-50 rounded-xl';
        row.innerHTML = `
            <div class="flex-1 grid grid-cols-2 gap-2">
                <div>
                    <label class="text-xs text-slate-500 font-medium block mb-1">Đến ngày thứ</label>
                    <input type="number" class="tier-maxdays w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                        value="${isLast ? '' : (tier.maxDays ?? '')}"
                        placeholder="${isLast ? '∞ (còn lại)' : 'VD: 7'}"
                        ${isLast ? 'disabled' : ''} min="1">
                </div>
                <div>
                    <label class="text-xs text-slate-500 font-medium block mb-1">Phí / ngày (đ)</label>
                    <input type="number" class="tier-rate w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                        value="${tier.ratePerDay ?? ''}" placeholder="VD: 1000" min="0" step="500">
                </div>
            </div>
            <button class="remove-tier-btn p-1.5 text-slate-400 hover:text-rose-500 transition-colors rounded-lg hover:bg-rose-50 disabled:opacity-30 disabled:cursor-not-allowed"
                title="Xóa bậc" ${tiers.length <= 1 ? 'disabled' : ''}>
                <i class="ph ph-trash text-base"></i>
            </button>`;

        row.querySelector('.remove-tier-btn').addEventListener('click', () => {
            feeScheduleData.lateFees.splice(idx, 1);
            renderLateFees(feeScheduleData.lateFees);
        });

        container.appendChild(row);
    });
};

const renderDamageLevels = (levels) => {
    const container = getElem('damageLevelsList');
    if (!container) return;

    container.innerHTML = levels.map(level => `
        <div class="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
            <i class="ph ph-warning text-amber-500 text-lg shrink-0"></i>
            <div class="flex-1 min-w-0">
                <p class="text-sm font-semibold text-slate-700">${escHtml(level.label)}</p>
                <p class="text-xs text-slate-400">ID: ${escHtml(level.id)}</p>
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
                <input type="number" class="damage-amount w-28 px-2.5 py-1.5 border border-slate-200 rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                    data-id="${escHtml(level.id)}" value="${level.amount ?? ''}" min="0" step="1000">
                <span class="text-xs text-slate-400">đ</span>
            </div>
        </div>`).join('');
};

const saveFeeSchedule = async () => {
    if (!feeScheduleData) return;

    // Read late fee tiers from DOM
    const lateFees = [];
    const tierRows = getElem('lateFeesTiers')?.children || [];
    Array.from(tierRows).forEach((row, idx) => {
        const isLast = idx === tierRows.length - 1;
        const maxDaysVal = row.querySelector('.tier-maxdays')?.value;
        const rateVal = row.querySelector('.tier-rate')?.value;
        lateFees.push({
            maxDays: isLast ? null : (parseInt(maxDaysVal) || null),
            ratePerDay: parseInt(rateVal) || 0
        });
    });

    // Read damage levels from DOM
    const damageLevels = feeScheduleData.damageLevels.map(level => ({
        ...level,
        amount: parseInt(document.querySelector(`.damage-amount[data-id="${level.id}"]`)?.value || '0') || 0
    }));

    const multiplier = parseFloat(getElem('lostBookMultiplier')?.value || '1.5') || 1.5;
    const renewalEnabled = !!getElem('renewalFeeEnabled')?.checked;
    const renewalFee = parseInt(getElem('renewalFeeAmount')?.value || '0') || 0;

    const schedule = {
        lateFees,
        damageLevels,
        lostBookMultiplier: multiplier,
        renewalFeeEnabled: renewalEnabled,
        renewalFee,
        updatedAt: serverTimestamp()
    };

    const btn = getElem('saveFeeScheduleBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ph ph-spinner animate-spin mr-1.5"></i>Đang lưu...'; }

    try {
        await setDoc(FEE_SCHEDULE_REF(), schedule);
        feeScheduleData = { ...feeScheduleData, ...schedule };
        showToast('Đã lưu biểu phí thành công!', 'success');
    } catch (err) {
        showToast(err.message || 'Không thể lưu biểu phí.', 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ph ph-floppy-disk mr-1.5"></i>Lưu biểu phí'; }
    }
};

// ── Tab 3: Book Pricing ────────────────────────────────────────────────────

let allBooksCache = [];
let bookPage = 1;
let bookFiltered = [];

const loadBookPricing = async () => {
    try {
        const snap = await getDocs(collection(db, 'books'));
        allBooksCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderBookPricingStats(allBooksCache);
        filterBooks();
    } catch (err) {
        console.error('Book pricing load error:', err);
        showToast('Không thể tải danh sách sách.', 'error');
    }
};

const renderBookPricingStats = (books) => {
    const withPrice = books.filter(b => b.price > 0);
    const totalValue = books.reduce((s, b) => s + (Number(b.price || 0) * Number(b.totalQuantity || b.quantity || 1)), 0);
    const setText = (id, val) => { const el = getElem(id); if (el) el.textContent = val; };
    setText('totalLibraryValue', formatMoney(totalValue));
    setText('booksWithPrice', `${withPrice.length} / ${books.length} sách`);
    setText('booksWithoutPrice', `${books.length - withPrice.length} sách`);
};

const filterBooks = () => {
    const search = (getElem('bookPricingSearch')?.value || '').toLowerCase().trim();
    const filter = getElem('bookPricingFilter')?.value || 'all';

    bookFiltered = allBooksCache.filter(b => {
        const matchSearch = !search ||
            (b.title || '').toLowerCase().includes(search) ||
            (b.author || '').toLowerCase().includes(search);
        const matchFilter = filter === 'all' ||
            (filter === 'no-price' && !(b.price > 0)) ||
            (filter === 'has-price' && b.price > 0);
        return matchSearch && matchFilter;
    });

    bookPage = 1;
    renderBookPricingTable();
};

const renderBookPricingTable = () => {
    const tbody = getElem('bookPricingBody');
    if (!tbody) return;

    const start = (bookPage - 1) * PAGE_SIZE_BOOKS;
    const paginated = bookFiltered.slice(start, start + PAGE_SIZE_BOOKS);

    if (paginated.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="py-10 text-center text-slate-400">Không tìm thấy sách nào.</td></tr>';
    } else {
        tbody.innerHTML = paginated.map(b => {
            const hasPrice = b.price > 0;
            const coverHtml = b.coverUrl
                ? `<img src="${escHtml(b.coverUrl)}" class="w-8 h-10 object-cover rounded shadow-sm shrink-0" loading="lazy">`
                : `<div class="w-8 h-10 bg-slate-100 rounded flex items-center justify-center shrink-0"><i class="ph ph-book text-slate-300"></i></div>`;
            return `
                <tr class="border-b border-slate-50 hover:bg-slate-50/60 transition-colors">
                    <td class="px-4 py-3">
                        <div class="flex items-center gap-3">
                            ${coverHtml}
                            <span class="text-sm font-medium text-slate-800 line-clamp-2">${escHtml(b.title || '--')}</span>
                        </div>
                    </td>
                    <td class="px-4 py-3 text-sm text-slate-500 hidden md:table-cell">${escHtml(b.author || '--')}</td>
                    <td class="px-4 py-3 text-sm text-slate-400 hidden lg:table-cell">${escHtml(b.category || '--')}</td>
                    <td class="px-4 py-3 text-center text-sm text-slate-600">${b.totalQuantity ?? b.quantity ?? '--'}</td>
                    <td class="px-4 py-3 text-right">
                        <input type="number" class="book-price-input w-32 px-2.5 py-1.5 border rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-primary-500/20 ${hasPrice ? 'border-slate-200' : 'border-amber-200 bg-amber-50'}"
                            value="${hasPrice ? b.price : ''}" placeholder="Chưa có giá" min="0" step="1000">
                    </td>
                    <td class="px-4 py-3 text-center">
                        <button class="save-price-btn px-2.5 py-1.5 text-xs font-semibold text-primary-600 bg-primary-50 hover:bg-primary-100 rounded-lg transition-colors"
                            data-book-id="${b.id}">
                            <i class="ph ph-floppy-disk mr-1"></i>Lưu
                        </button>
                    </td>
                </tr>`;
        }).join('');

        tbody.querySelectorAll('.save-price-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const bookId = btn.dataset.bookId;
                const priceInput = btn.closest('tr')?.querySelector('.book-price-input');
                const price = parseInt(priceInput?.value || '0') || 0;
                await saveBookPrice(bookId, price, btn, priceInput);
            });
        });
    }

    const infoEl = getElem('bookPricingInfo');
    if (infoEl) infoEl.textContent = `${bookFiltered.length} sách`;

    renderPagination('bookPricingPagination', bookPage, Math.ceil(bookFiltered.length / PAGE_SIZE_BOOKS), (p) => {
        bookPage = p;
        renderBookPricingTable();
    });
};

const saveBookPrice = async (bookId, price, btn, input) => {
    if (!bookId) return;
    const origHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="ph ph-spinner animate-spin mr-1"></i>...';

    try {
        await updateDoc(doc(db, 'books', bookId), { price });
        const cached = allBooksCache.find(b => b.id === bookId);
        if (cached) cached.price = price;
        if (input) {
            input.classList.toggle('bg-amber-50', !(price > 0));
            input.classList.toggle('border-amber-200', !(price > 0));
            input.classList.toggle('border-slate-200', price > 0);
        }
        renderBookPricingStats(allBooksCache);
        showToast('Đã lưu giá sách.', 'success');
    } catch (err) {
        showToast(err.message || 'Không thể lưu giá.', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = origHtml;
    }
};

// ── Tab 4: Transactions ────────────────────────────────────────────────────

let allTxCache = [];
let txPage = 1;
let txFiltered = [];

const loadTransactions = async () => {
    try {
        const snap = await getDocs(query(collection(db, 'fines'), orderBy('createdAt', 'desc')));
        allTxCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch {
        // Fallback: use dashboard cache if already loaded, or plain getDocs
        if (allFinesCache) {
            allTxCache = [...allFinesCache].sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
        } else {
            try {
                const snap = await getDocs(collection(db, 'fines'));
                allTxCache = snap.docs.map(d => ({ id: d.id, ...d.data() }))
                    .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
            } catch (err2) {
                showToast('Không thể tải lịch sử giao dịch.', 'error');
                return;
            }
        }
    }
    filterTransactions();
};

const filterTransactions = () => {
    const search = (getElem('txSearchInput')?.value || '').toLowerCase().trim();
    const status = getElem('txStatusFilter')?.value || 'all';
    const type = getElem('txTypeFilter')?.value || 'all';
    const dateFrom = getElem('txDateFrom')?.value;
    const dateTo = getElem('txDateTo')?.value;

    txFiltered = allTxCache.filter(f => {
        if (search) {
            const nameMatch = (f.userName || '').toLowerCase().includes(search);
            const idMatch = (f.fineId || f.id || '').toLowerCase().includes(search);
            const recordMatch = (f.recordId || '').toLowerCase().includes(search);
            if (!nameMatch && !idMatch && !recordMatch) return false;
        }
        if (status !== 'all' && f.status !== status) return false;
        if (type !== 'all') {
            const fineType = getFineType(f);
            if (type === 'overdue' && fineType !== 'overdue' && fineType !== 'both') return false;
            if (type === 'damage' && fineType !== 'damage' && fineType !== 'both') return false;
            if (type === 'lost' && fineType !== 'lost') return false;
        }
        if (dateFrom) {
            const d = f.createdAt?.toDate?.();
            if (!d || d < new Date(dateFrom)) return false;
        }
        if (dateTo) {
            const d = f.createdAt?.toDate?.();
            const end = new Date(dateTo);
            end.setHours(23, 59, 59, 999);
            if (!d || d > end) return false;
        }
        return true;
    });

    txPage = 1;
    renderTransactionsTable();
};

const renderTransactionsTable = () => {
    const tbody = getElem('transactionBody');
    if (!tbody) return;

    const start = (txPage - 1) * PAGE_SIZE_TX;
    const paginated = txFiltered.slice(start, start + PAGE_SIZE_TX);

    if (paginated.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="py-10 text-center text-slate-400">Không tìm thấy giao dịch nào.</td></tr>';
    } else {
        tbody.innerHTML = paginated.map(f => `
            <tr class="border-b border-slate-50 hover:bg-slate-50/60 transition-colors">
                <td class="px-4 py-3 text-xs font-mono text-slate-400">${escHtml(f.fineId || f.id?.slice(0, 8) || '--')}</td>
                <td class="px-4 py-3 text-sm font-medium text-slate-800">${escHtml(f.userName || '--')}</td>
                <td class="px-4 py-3 text-sm text-slate-500 hidden lg:table-cell max-w-[200px]">
                    <span class="line-clamp-1">${escHtml((f.bookTitles || []).join(', ') || '--')}</span>
                </td>
                <td class="px-4 py-3 text-center">${renderFineTypeBadge(f)}</td>
                <td class="px-4 py-3 text-right font-semibold text-slate-800">${formatMoney(f.amount)}</td>
                <td class="px-4 py-3 text-center">${renderStatusBadge(f.status)}</td>
                <td class="px-4 py-3 text-right text-xs text-slate-500">${formatDate(f.createdAt)}</td>
            </tr>`).join('');
    }

    const infoEl = getElem('txInfo');
    if (infoEl) infoEl.textContent = `${txFiltered.length} giao dịch`;

    renderPagination('txPagination', txPage, Math.ceil(txFiltered.length / PAGE_SIZE_TX), (p) => {
        txPage = p;
        renderTransactionsTable();
    });
};

// ── CSV Export ─────────────────────────────────────────────────────────────

const exportCSV = () => {
    let headers, rows, filename;

    if (activeTab === 'transactions') {
        headers = ['Mã phạt', 'Độc giả', 'Sách', 'Loại', 'Số tiền (đ)', 'Trạng thái', 'Ngày tạo'];
        rows = txFiltered.map(f => [
            f.fineId || f.id || '',
            f.userName || '',
            (f.bookTitles || []).join('; '),
            getFineType(f),
            f.amount || 0,
            f.status || '',
            formatDate(f.createdAt)
        ]);
        filename = `fines_${new Date().toISOString().slice(0, 10)}.csv`;
    } else if (activeTab === 'book-pricing') {
        headers = ['Tên sách', 'Tác giả', 'Thể loại', 'Số lượng', 'Giá bìa (đ)'];
        rows = bookFiltered.map(b => [
            b.title || '',
            b.author || '',
            b.category || '',
            b.totalQuantity ?? b.quantity ?? 0,
            b.price || 0
        ]);
        filename = `book_pricing_${new Date().toISOString().slice(0, 10)}.csv`;
    } else {
        headers = ['Mã phạt', 'Độc giả', 'Sách', 'Loại', 'Số tiền (đ)', 'Trạng thái', 'Ngày tạo'];
        rows = (allFinesCache || []).map(f => [
            f.fineId || f.id || '',
            f.userName || '',
            (f.bookTitles || []).join('; '),
            getFineType(f),
            f.amount || 0,
            f.status || '',
            formatDate(f.createdAt)
        ]);
        filename = `all_fines_${new Date().toISOString().slice(0, 10)}.csv`;
    }

    const csv = [headers, ...rows]
        .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
        .join('\n');

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Đã xuất CSV thành công!', 'success');
};

// ── Init ──────────────────────────────────────────────────────────────────

const initFinancePage = () => {
    if (!getElem('tab-dashboard')) return;

    onAuthStateChanged(auth, async (user) => {
        if (!user) { window.location.replace('login.html'); return; }

        try {
            const snap = await getDoc(doc(db, 'users', user.uid));
            if (snap.data()?.role !== 'admin') {
                window.location.replace('../user/index.html');
                return;
            }
        } catch {
            window.location.replace('login.html');
            return;
        }

        // Tab buttons
        document.querySelectorAll('.finance-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => switchTab(btn.dataset.tab));
        });

        // Renewal fee toggle visibility
        getElem('renewalFeeEnabled')?.addEventListener('change', (e) => {
            getElem('renewalFeeAmountRow')?.classList.toggle('hidden', !e.target.checked);
        });

        // Add late fee tier — insert before the final "infinity" tier
        getElem('addLateTierBtn')?.addEventListener('click', () => {
            if (!feeScheduleData) return;
            const tiers = feeScheduleData.lateFees;
            tiers.splice(tiers.length - 1, 0, { maxDays: 0, ratePerDay: 0 });
            renderLateFees(tiers);
        });

        // Save fee schedule
        getElem('saveFeeScheduleBtn')?.addEventListener('click', saveFeeSchedule);

        // Book pricing filters
        getElem('bookPricingSearch')?.addEventListener('input', filterBooks);
        getElem('bookPricingFilter')?.addEventListener('change', filterBooks);

        // Transaction filters
        ['txSearchInput', 'txStatusFilter', 'txTypeFilter', 'txDateFrom', 'txDateTo'].forEach(id => {
            const el = getElem(id);
            if (!el) return;
            el.addEventListener('input', filterTransactions);
            el.addEventListener('change', filterTransactions);
        });

        // CSV export
        getElem('exportCsvBtn')?.addEventListener('click', exportCSV);

        // Logout
        getElem('adminLogoutBtn')?.addEventListener('click', async () => {
            await signOut(auth);
            window.location.replace('login.html');
        });

        // Load initial tab
        switchTab('dashboard');
    });
};

initFinancePage();

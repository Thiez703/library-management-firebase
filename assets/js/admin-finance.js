import { auth, db } from './firebase-config.js';
import {
    collection,
    doc,
    getDoc,
    getDocs,
    query,
    where,
    writeBatch,
    updateDoc,
    serverTimestamp,
    orderBy
} from 'https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js';
import { requireAdmin } from './admin-guard.js';
import { showToast } from './notify.js';

const escapeHtml = (v = '') => String(v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const formatMoney = (amount) => Number(amount || 0).toLocaleString('vi-VN') + ' ₫';

const toMillis = (ts) => {
    if (!ts) return 0;
    if (typeof ts === 'number') return ts;
    if (ts instanceof Date) return ts.getTime();
    if (ts.toMillis) return ts.toMillis();
    return 0;
};

const formatDateTime = (ts) => {
    if (!ts) return '--';
    const date = ts.toDate ? ts.toDate() : new Date(ts);
    return date.toLocaleDateString('vi-VN') + ' ' + date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
};

const normalizeMoney = (n) => {
    const x = Number(n);
    if (!Number.isFinite(x)) return 0;
    return Math.max(0, Math.round(x));
};

const methodLabel = (m) => {
    if (m === 'cash') return 'Tiền mặt';
    if (m === 'bank_transfer') return 'Chuyển khoản';
    return m ? escapeHtml(String(m)) : '--';
};

const startOfLocalDay = (d) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
};

const addDaysLocal = (d, days) => {
    const x = new Date(d);
    x.setDate(x.getDate() + days);
    return x;
};

const getRangeFromSelect = (selectValue, customFromStr, customToStr) => {
    const now = new Date();
    if (selectValue === 'all') return { startMs: 0, endMs: Number.MAX_SAFE_INTEGER };

    if (selectValue === 'custom') {
        const from = customFromStr ? startOfLocalDay(`${customFromStr}T00:00:00`) : startOfLocalDay(now);
        const to = customToStr ? startOfLocalDay(`${customToStr}T00:00:00`) : startOfLocalDay(now);
        const startMs = Math.min(from.getTime(), to.getTime());
        const endDay = Math.max(from.getTime(), to.getTime());
        const endMs = endDay + 24 * 60 * 60 * 1000 - 1;
        return { startMs, endMs };
    }

    if (selectValue === 'today') {
        const s = startOfLocalDay(now);
        const e = s.getTime() + 24 * 60 * 60 * 1000 - 1;
        return { startMs: s.getTime(), endMs: e };
    }

    if (selectValue === 'week') {
        const day = now.getDay(); // 0 Sun
        const mondayOffset = (day + 6) % 7; // Mon=0
        const s = startOfLocalDay(addDaysLocal(now, -mondayOffset));
        const e = s.getTime() + 7 * 24 * 60 * 60 * 1000 - 1;
        return { startMs: s.getTime(), endMs: e };
    }

    if (selectValue === 'month') {
        const s = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
        const e = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0) - 1;
        return { startMs: s.getTime(), endMs: e };
    }

    if (selectValue === 'lastMonth') {
        const s = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
        const e = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0) - 1;
        return { startMs: s.getTime(), endMs: e };
    }

    if (selectValue === 'year') {
        const s = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
        const e = new Date(now.getFullYear() + 1, 0, 1, 0, 0, 0, 0) - 1;
        return { startMs: s.getTime(), endMs: e };
    }

    return { startMs: 0, endMs: Number.MAX_SAFE_INTEGER };
};

const buildFineRecordIdSetForUser = (allUserFines) => {
    const set = new Set();
    (allUserFines || []).forEach((f) => {
        const rid = (f?.recordId || '').toString().trim();
        if (rid) set.add(rid);
    });
    return set;
};

const legacyDebtAmount = (recordData) => normalizeMoney(
    Number(recordData?.fineOverdue || 0) + Number(recordData?.fineDamage || 0)
);

const buildLegacyReason = (recordData) => {
    const overdue = normalizeMoney(recordData?.fineOverdue || 0);
    const damage = normalizeMoney(recordData?.fineDamage || 0);
    const parts = [];
    if (overdue > 0) parts.push(`Phạt quá hạn: ${formatMoney(overdue)}`);
    if (damage > 0) parts.push(`Phạt hư hỏng/mất: ${formatMoney(damage)}`);
    return parts.join(' • ') || 'Nợ phạt (legacy)';
};

const buildFineReason = (fine) => {
    const overdue = normalizeMoney(fine?.overdueAmount ?? fine?.fineOverdue ?? 0);
    const damage = normalizeMoney(fine?.damageAmount ?? fine?.fineDamage ?? 0);
    const parts = [];
    if (overdue > 0) parts.push(`Quá hạn: ${formatMoney(overdue)}`);
    if (damage > 0) parts.push(`Hư hỏng/mất: ${formatMoney(damage)}`);
    const late = Number(fine?.daysLate || 0);
    if (late > 0) parts.push(`Trễ ${late} ngày`);
    return parts.join(' • ') || 'Phạt mượn/trả';
};

const getReaderDisplayName = (fineOrRecord) => {
    const fromFine = (fineOrRecord?.userName || '').trim();
    if (fromFine) return fromFine;
    const ud = fineOrRecord?.userDetails || {};
    return (ud.fullName || ud.name || 'Độc giả').toString();
};

let state = {
    tab: 'unpaid', // unpaid | paid
    rangeSelect: 'month',
    customFrom: '',
    customTo: '',
    search: '',
    fines: [],
    borrowRecords: [],
    payments: []
};

const computeOpenRows = () => {
    const finesByUser = new Map();
    state.fines.forEach((f) => {
        const uid = (f.userId || '').toString();
        if (!uid) return;
        if (!finesByUser.has(uid)) finesByUser.set(uid, []);
        finesByUser.get(uid).push(f);
    });

    const rows = [];

    // fines unpaid
    state.fines.forEach((f) => {
        if ((f.status || '').toString().toLowerCase() !== 'unpaid') return;
        const amount = normalizeMoney(f.amount);
        if (amount <= 0) return;
        rows.push({
            kind: 'fine',
            key: `fine:${f.id}`,
            time: f.createdAt,
            userId: f.userId,
            userName: getReaderDisplayName(f),
            reason: buildFineReason(f),
            amount,
            meta: { fineDocId: f.id, fineId: f.fineId || '', recordId: f.recordId || '' }
        });
    });

    // legacy borrowRecords penalties not covered by fines recordId mapping
    state.borrowRecords.forEach((r) => {
        const uid = (r.userId || '').toString();
        if (!uid) return;
        const debt = legacyDebtAmount(r);
        if (debt <= 0) return;
        const recordKey = (r.recordId || '').toString().trim();
        const userFines = finesByUser.get(uid) || [];
        const fineRecordIdSet = buildFineRecordIdSetForUser(userFines);
        if (recordKey && fineRecordIdSet.has(recordKey)) return;

        rows.push({
            kind: 'legacy',
            key: `legacy:${r.id}`,
            time: r.returnDate || r.updatedAt || r.createdAt || r.borrowDate || null,
            userId: uid,
            userName: getReaderDisplayName(r),
            reason: buildLegacyReason(r),
            amount: debt,
            meta: { borrowDocId: r.id, recordId: recordKey || r.recordId || '' }
        });
    });

    return rows.sort((a, b) => (toMillis(b.time) || 0) - (toMillis(a.time) || 0));
};

const inRange = (ts, startMs, endMs) => {
    const ms = toMillis(ts);
    if (!ms) {
        // Không có timestamp: vẫn hiển thị trong “Toàn bộ”, tránh “mất” nợ legacy
        return startMs == 0 && endMs == Number.MAX_SAFE_INTEGER;
    }
    return ms >= startMs && ms <= endMs;
};

const userHasAnyOpenDebt = async (userId) => {
    if (!userId) return false;

    const unpaidFinesSnap = await getDocs(query(collection(db, 'fines'), where('userId', '==', userId), where('status', '==', 'unpaid')));
    if (!unpaidFinesSnap.empty) return true;

    const [borrowSnap, allFineSnap] = await Promise.all([
        getDocs(query(collection(db, 'borrowRecords'), where('userId', '==', userId))),
        getDocs(query(collection(db, 'fines'), where('userId', '==', userId)))
    ]);

    const fineRecordIdSet = new Set(
        allFineSnap.docs
            .map((snap) => (snap.data()?.recordId || '').toString().trim())
            .filter(Boolean)
    );

    return borrowSnap.docs.some((snap) => {
        const data = snap.data() || {};
        const legacyDebt = legacyDebtAmount(data);
        if (legacyDebt <= 0) return false;
        const recordId = (data.recordId || '').toString().trim();
        return !recordId || !fineRecordIdSet.has(recordId);
    });
};

const applyUserPaySideEffects = async (userId) => {
    if (!userId) return;

    const userRef = doc(db, 'users', userId);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) return;
    const userData = userSnap.data() || {};

    const currentScore = typeof userData.reputationScore === 'number'
        ? userData.reputationScore
        : (typeof userData.trustScore === 'number' ? userData.trustScore : 100);
    const boostedScore = Math.max(0, Math.min(100, currentScore + 10));

    const stillHasDebt = await userHasAnyOpenDebt(userId);

    const status = (userData.status || '').toString().toLowerCase();
    const isPermanentBlocked = ['banned', 'permanent_ban', 'permanently_banned'].includes(status);

    const nextStatus = (!isPermanentBlocked && boostedScore >= 40 && !stillHasDebt)
        ? 'active'
        : (userData.status || 'active');

    const nextIsBlocked = (!isPermanentBlocked && boostedScore >= 40)
        ? stillHasDebt
        : !!userData.isBlocked;

    await updateDoc(userRef, {
        reputationScore: boostedScore,
        trustScore: boostedScore,
        status: nextStatus,
        isBlocked: nextIsBlocked,
        updatedAt: serverTimestamp()
    });
};

const loadDataset = async () => {
    const [allFinesSnap, unpaidFinesSnap, overdueSnap, damageSnap, paymentsSnap] = await Promise.all([
        getDocs(collection(db, 'fines')),
        getDocs(query(collection(db, 'fines'), where('status', '==', 'unpaid'))),
        getDocs(query(collection(db, 'borrowRecords'), where('fineOverdue', '>', 0))),
        getDocs(query(collection(db, 'borrowRecords'), where('fineDamage', '>', 0))),
        getDocs(query(collection(db, 'financePayments'), orderBy('paidAt', 'desc')))
    ]);

    state.fines = allFinesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    const penaltyMap = new Map();
    const addPenaltyDocs = (snap) => {
        snap.docs.forEach((d) => {
            penaltyMap.set(d.id, { id: d.id, ...d.data() });
        });
    };
    addPenaltyDocs(overdueSnap);
    addPenaltyDocs(damageSnap);

    // Nếu không có field penalty, vẫn đảm bảo các phiếu unpaid nằm trong tập borrowRecords để lọc legacy chính xác
    unpaidFinesSnap.docs.forEach((fs) => {
        const fine = fs.data() || {};
        const rid = (fine.recordId || '').toString().trim();
        if (!rid) return;
        // recordId trên fines thường là id doc borrowRecords
        if (!penaltyMap.has(rid)) {
            penaltyMap.set(rid, { id: rid, __placeholder: true });
        }
    });

    state.borrowRecords = Array.from(penaltyMap.values());

    // Prefetch borrow docs referenced by fines (để hiển thị tên độc giả nếu thiếu)
    const missingIds = state.borrowRecords
        .filter((r) => r.__placeholder)
        .map((r) => r.id)
        .filter(Boolean);

    if (missingIds.length) {
        const snaps = await Promise.all(missingIds.map((id) => getDoc(doc(db, 'borrowRecords', id))));
        snaps.forEach((s, idx) => {
            const id = missingIds[idx];
            if (!s.exists()) {
                penaltyMap.delete(id);
                return;
            }
            penaltyMap.set(id, { id, ...s.data() });
        });
        state.borrowRecords = Array.from(penaltyMap.values()).filter((r) => !r.__placeholder);
    }

    state.payments = paymentsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
};

const getActiveRange = () => getRangeFromSelect(
    state.rangeSelect,
    state.customFrom,
    state.customTo
);

const matchesSearch = (row) => {
    const q = (state.search || '').trim().toLowerCase();
    if (!q) return true;
    const hay = [
        row.userName,
        row.reason,
        row.meta?.fineId,
        row.meta?.recordId,
        row.kind
    ].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q);
};

const matchesPaymentSearch = (p) => {
    const q = (state.search || '').trim().toLowerCase();
    if (!q) return true;
    const hay = [
        p.userName,
        p.reason,
        p.note,
        p.sourceFineId,
        p.sourceRecordId,
        p.sourceBorrowDocId,
        p.sourceType,
        p.paymentMethod
    ].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q);
};

const renderSummary = ({ startMs, endMs }) => {
    const openRows = computeOpenRows().filter((r) => inRange(r.time, startMs, endMs));
    const unpaidTotal = openRows.reduce((s, r) => s + normalizeMoney(r.amount), 0);

    const paidRows = (state.payments || []).filter((p) => inRange(p.paidAt, startMs, endMs));
    const paidTotal = paidRows.reduce((s, p) => s + normalizeMoney(p.amount), 0);

    const unpaidTotalEl = document.getElementById('financeUnpaidTotal');
    const unpaidCountEl = document.getElementById('financeUnpaidCount');
    const paidTotalEl = document.getElementById('financePaidTotal');
    const paidCountEl = document.getElementById('financePaidCount');

    if (unpaidTotalEl) unpaidTotalEl.textContent = formatMoney(unpaidTotal);
    if (unpaidCountEl) unpaidCountEl.textContent = `${openRows.length} khoản`;
    if (paidTotalEl) paidTotalEl.textContent = formatMoney(paidTotal);
    if (paidCountEl) paidCountEl.textContent = `${paidRows.length} biên lai`;
};

const renderTable = ({ startMs, endMs }) => {
    const tbody = document.getElementById('financeTableBody');
    const methodHeader = document.getElementById('financePaidMethodHeader');
    const lastColHeader = document.getElementById('financeLastColHeader');
    if (!tbody) return;

    if (methodHeader) {
        methodHeader.classList.toggle('hidden', state.tab !== 'paid');
    }
    if (lastColHeader) {
        lastColHeader.textContent = state.tab === 'paid' ? 'Ghi chú' : 'Thao tác';
    }

    if (state.tab === 'unpaid') {
        const rows = computeOpenRows()
            .filter((r) => inRange(r.time, startMs, endMs))
            .filter(matchesSearch);

        if (rows.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="px-6 py-10 text-center text-slate-500">Không có khoản nợ trong khoảng thời gian đã chọn.</td></tr>`;
            return;
        }

        tbody.innerHTML = rows.map((r) => {
            const kindLabel = r.kind === 'legacy' ? 'Nợ legacy (phiếu mượn)' : 'Phiếu phạt (fines)';
            const payload = encodeURIComponent(JSON.stringify({
                kind: r.kind,
                fineDocId: r.meta?.fineDocId || '',
                borrowDocId: r.meta?.borrowDocId || '',
                userName: r.userName,
                amount: r.amount,
                reason: r.reason,
                sourceLabel: kindLabel
            }));

            return `
                <tr class="hover:bg-slate-50">
                    <td class="px-6 py-4 text-slate-700 whitespace-nowrap">${formatDateTime(r.time)}</td>
                    <td class="px-6 py-4">
                        <p class="font-semibold text-slate-900">${escapeHtml(r.userName)}</p>
                        <p class="text-xs text-slate-400 mt-0.5">${escapeHtml(r.meta?.recordId || r.meta?.fineId || '')}</p>
                    </td>
                    <td class="px-6 py-4 text-slate-700">${escapeHtml(r.reason)}</td>
                    <td class="px-6 py-4 text-right font-extrabold text-rose-700">${formatMoney(r.amount)}</td>
                    <td class="px-6 py-4 text-right">
                        <button type="button" class="px-3 py-1.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-lg text-xs font-bold border border-emerald-200"
                            data-action="open-pay" data-payload="${payload}">
                            Xác nhận thanh toán
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    } else {
        const rows = (state.payments || [])
            .filter((p) => inRange(p.paidAt, startMs, endMs))
            .filter(matchesPaymentSearch);

        if (rows.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="px-6 py-10 text-center text-slate-500">Chưa có biên lai thanh toán trong khoảng thời gian đã chọn.</td></tr>`;
            return;
        }

        tbody.innerHTML = rows.map((p) => `
            <tr class="hover:bg-slate-50">
                <td class="px-6 py-4 text-slate-700 whitespace-nowrap">${formatDateTime(p.paidAt)}</td>
                <td class="px-6 py-4">
                    <p class="font-semibold text-slate-900">${escapeHtml(p.userName || 'Độc giả')}</p>
                    <p class="text-xs text-slate-400 mt-0.5">${escapeHtml(p.sourceType || '')}</p>
                </td>
                <td class="px-6 py-4 text-slate-700">${escapeHtml(p.reason || '')}</td>
                <td class="px-6 py-4 text-right font-extrabold text-emerald-700">${formatMoney(p.amount)}</td>
                <td class="px-6 py-4 text-slate-700">${methodLabel(p.paymentMethod)}</td>
                <td class="px-6 py-4 text-right text-xs text-slate-400">${escapeHtml((p.note || '').trim() || '--')}</td>
            </tr>
        `).join('');
    }

    tbody.querySelectorAll('button[data-action="open-pay"]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const raw = btn.getAttribute('data-payload') || '';
            try {
                const payload = JSON.parse(decodeURIComponent(raw));
                openPayModal(payload);
            } catch {
                showToast('Không đọc được dữ liệu dòng thanh toán.', 'error');
            }
        });
    });
};

const rerender = () => {
    const range = getActiveRange();
    renderSummary(range);
    renderTable(range);
};

const openPayModal = (payload) => {
    const modal = document.getElementById('financePayModal');
    if (!modal) return;

    document.getElementById('financePayKind').value = payload.kind || '';
    document.getElementById('financePayFineDocId').value = payload.fineDocId || '';
    document.getElementById('financePayBorrowDocId').value = payload.borrowDocId || '';
    document.getElementById('financePayReader').textContent = payload.userName || '--';
    document.getElementById('financePayAmount').textContent = formatMoney(payload.amount || 0);
    document.getElementById('financePaySource').textContent = payload.sourceLabel || '--';

    const note = document.getElementById('financePayNote');
    if (note) note.value = '';

    modal.classList.remove('hidden');
};

const closePayModal = () => {
    document.getElementById('financePayModal')?.classList.add('hidden');
};

const appendAdminNote = (existing, addition) => {
    const add = (addition || '').trim();
    if (!add) return (existing || '').trim();
    const base = (existing || '').trim();
    return base ? `${base}\n${add}` : add;
};

const payFineFlow = async ({ fineDocId, paymentMethod, note }) => {
    const fineRef = doc(db, 'fines', fineDocId);
    const fineSnap = await getDoc(fineRef);
    if (!fineSnap.exists()) throw new Error('Phiếu phạt không tồn tại.');
    const fine = fineSnap.data() || {};
    if ((fine.status || '').toString().toLowerCase() !== 'unpaid') {
        throw new Error('Phiếu phạt không còn ở trạng thái chưa thanh toán.');
    }

    const userId = (fine.userId || '').toString();
    const amount = normalizeMoney(fine.amount);
    const batch = writeBatch(db);

    batch.update(fineRef, {
        status: 'paid',
        paidAt: serverTimestamp(),
        paymentMethod,
        paymentNote: (note || '').trim(),
        recordedBy: auth.currentUser?.uid || null
    });

    const receiptRef = doc(collection(db, 'financePayments'));
    batch.set(receiptRef, {
        type: 'fine_payment',
        sourceType: 'fine',
        ...(fine.fineId ? { sourceFineId: fine.fineId } : {}),
        ...(fine.recordId ? { sourceRecordId: fine.recordId } : {}),
        sourceFineDocId: fineDocId,
        userId,
        userName: getReaderDisplayName(fine),
        amount,
        currency: 'VND',
        reason: buildFineReason({ ...fine, id: fineDocId }),
        paymentMethod,
        note: (note || '').trim(),
        paidAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        createdBy: auth.currentUser?.uid || null
    });

    await batch.commit();
    await applyUserPaySideEffects(userId);
};

const payLegacyFlow = async ({ borrowDocId, paymentMethod, note }) => {
    const recordRef = doc(db, 'borrowRecords', borrowDocId);
    const recordSnap = await getDoc(recordRef);
    if (!recordSnap.exists()) throw new Error('Phiếu mượn không tồn tại.');
    const record = recordSnap.data() || {};

    const debt = legacyDebtAmount(record);
    if (debt <= 0) throw new Error('Phiếu không còn nợ để thanh toán.');

    const userId = (record.userId || '').toString();
    if (!userId) throw new Error('Thiếu userId trên phiếu mượn.');

    const batch = writeBatch(db);
    batch.update(recordRef, {
        fineOverdue: 0,
        fineDamage: 0,
        adminNote: appendAdminNote(record.adminNote, `[Finance] Thanh toán (${paymentMethod})${note ? `: ${note}` : ''}`),
        updatedAt: serverTimestamp()
    });

    const receiptRef = doc(collection(db, 'financePayments'));
    batch.set(receiptRef, {
        type: 'legacy_borrow_debt_payment',
        sourceType: 'borrowRecord',
        sourceBorrowDocId: borrowDocId,
        ...((record.recordId || '').toString().trim()
            ? { sourceRecordId: (record.recordId || '').toString().trim() }
            : {}),
        userId,
        userName: getReaderDisplayName(record),
        amount: debt,
        currency: 'VND',
        reason: buildLegacyReason(record),
        paymentMethod,
        note: (note || '').trim(),
        paidAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        createdBy: auth.currentUser?.uid || null
    });

    await batch.commit();
    await applyUserPaySideEffects(userId);
};

const bindUi = () => {
    document.getElementById('adminLogoutBtn')?.addEventListener('click', async () => {
        await auth.signOut();
        window.location.href = '../user/login.html';
    });

    document.querySelectorAll('button[data-finance-tab]').forEach((btn) => {
        btn.addEventListener('click', () => {
            state.tab = btn.getAttribute('data-finance-tab') || 'unpaid';
            document.querySelectorAll('button[data-finance-tab]').forEach((b) => {
                b.classList.remove('bg-primary-600', 'text-white', 'shadow-md');
                b.classList.add('text-slate-600', 'hover:bg-slate-50');
            });
            btn.classList.remove('text-slate-600', 'hover:bg-slate-50');
            btn.classList.add('bg-primary-600', 'text-white', 'shadow-md');
            rerender();
        });
    });

    const rangeSelect = document.getElementById('financeRangeSelect');
    const customWrap = document.getElementById('financeCustomRange');
    const fromInput = document.getElementById('financeFromInput');
    const toInput = document.getElementById('financeToInput');

    const syncCustomVisibility = () => {
        const v = rangeSelect?.value || 'month';
        const show = v === 'custom';
        customWrap?.classList.toggle('hidden', !show);
        if (show) {
            const today = new Date();
            const iso = (d) => d.toISOString().slice(0, 10);
            if (fromInput && !fromInput.value) fromInput.value = iso(new Date(today.getFullYear(), today.getMonth(), 1));
            if (toInput && !toInput.value) toInput.value = iso(today);
        }
    };

    rangeSelect?.addEventListener('change', () => {
        state.rangeSelect = rangeSelect.value;
        syncCustomVisibility();
        rerender();
    });
    fromInput?.addEventListener('change', () => {
        state.customFrom = fromInput.value;
        rerender();
    });
    toInput?.addEventListener('change', () => {
        state.customTo = toInput.value;
        rerender();
    });

    document.getElementById('financeSearchInput')?.addEventListener('input', (e) => {
        state.search = e.target.value || '';
        rerender();
    });

    document.getElementById('financeRefreshBtn')?.addEventListener('click', async () => {
        try {
            await loadDataset();
            rerender();
            showToast('Đã tải lại dữ liệu.', 'success');
        } catch (e) {
            console.error(e);
            showToast('Không thể tải lại dữ liệu.', 'error');
        }
    });

    document.getElementById('financePayCloseBtn')?.addEventListener('click', closePayModal);
    document.getElementById('financePayCancelBtn')?.addEventListener('click', closePayModal);

    document.getElementById('financePayForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const kind = (document.getElementById('financePayKind')?.value || '').trim();
        const fineDocId = (document.getElementById('financePayFineDocId')?.value || '').trim();
        const borrowDocId = (document.getElementById('financePayBorrowDocId')?.value || '').trim();
        const note = (document.getElementById('financePayNote')?.value || '').trim();
        const method = (document.querySelector('input[name="financePayMethod"]:checked')?.value || '').trim();

        if (!method) {
            showToast('Vui lòng chọn hình thức thanh toán.', 'warning');
            return;
        }

        try {
            if (kind === 'fine') {
                if (!fineDocId) throw new Error('Thiếu mã phiếu phạt.');
                await payFineFlow({ fineDocId, paymentMethod: method, note });
            } else if (kind === 'legacy') {
                if (!borrowDocId) throw new Error('Thiếu mã phiếu mượn.');
                await payLegacyFlow({ borrowDocId, paymentMethod: method, note });
            } else {
                throw new Error('Loại thanh toán không hợp lệ.');
            }

            closePayModal();
            showToast('Đã lưu thanh toán.', 'success');
            await loadDataset();
            rerender();
        } catch (err) {
            console.error(err);
            showToast(err?.message || 'Không thể lưu thanh toán.', 'error');
        }
    });

    // init
    state.rangeSelect = rangeSelect?.value || 'month';
    syncCustomVisibility();
    state.customFrom = fromInput?.value || '';
    state.customTo = toInput?.value || '';
};

const initFinancePage = async () => {
    bindUi();
    try {
        await loadDataset();
        rerender();
    } catch (e) {
        console.error(e);
        showToast('Không thể tải dữ liệu tài chính.', 'error');
    }
};

requireAdmin(() => initFinancePage());

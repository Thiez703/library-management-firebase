import { auth, db } from './firebase-config.js';
import { collection, query, orderBy, getDocs, doc, getDoc, updateDoc, serverTimestamp, onSnapshot, where } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";
import { signOut } from 'https://www.gstatic.com/firebasejs/10.0.0/firebase-auth.js';
import { requireAdmin } from './admin-guard.js';
import { showToast } from './notify.js';

const escapeHtml = (v = '') => String(v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

let currentStatus = 'unpaid';
let allFines = [];

const formatMoney = (amount) => {
    return Number(amount || 0).toLocaleString('vi-VN') + ' ₫';
};

const formatDate = (ts) => {
    if (!ts) return '--';
    const date = ts.toDate ? ts.toDate() : new Date(ts);
    return date.toLocaleDateString('vi-VN') + ' ' + date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
};

const initFinesPage = async () => {
    const logoutBtn = document.getElementById('adminLogoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            await signOut(auth);
            window.location.href = '../user/login.html';
        });
    }

    loadFines();
    bindEvents();
};

const loadFines = () => {
    try {
        const finesRef = collection(db, 'fines');
        const q = query(finesRef, orderBy('createdAt', 'desc'));
        onSnapshot(q, (snapshot) => {
            allFines = snapshot.docs.map(d => {
                const data = d.data();
                // Normalize: amount field may be stored as overdueAmount + damageAmount
                const amount = Number(data.amount) || (Number(data.overdueAmount || 0) + Number(data.damageAmount || 0));
                return { id: d.id, ...data, amount };
            });
            renderDashboard();
            renderFinesTable();
        }, (error) => {
            console.error("Error loading fines:", error);
            showToast('Không thể tải danh sách phiếu phạt', 'error');
        });
    } catch (error) {
        console.error("Error loading fines:", error);
        showToast('Không thể tải danh sách phiếu phạt', 'error');
    }
};

const renderDashboard = () => {
    const unpaidFines = allFines.filter(f => f.status === 'unpaid');
    const totalUnpaid = unpaidFines.reduce((sum, f) => sum + (Number(f.amount) || 0), 0);
    const processedFines = allFines.filter(f => f.status === 'paid' || f.status === 'waived');

    document.getElementById('totalUnpaidAmount').textContent = formatMoney(totalUnpaid);
    document.getElementById('unpaidCount').textContent = unpaidFines.length;
    document.getElementById('processedCount').textContent = processedFines.length;
};

const renderFinesTable = () => {
    const tbody = document.getElementById('finesTableBody');
    const searchInput = (document.getElementById('fineSearchInput')?.value || '').toLowerCase();

    const filteredFines = allFines.filter(f => {
        const matchStatus = f.status === currentStatus;
        const matchSearch = (f.userName || '').toLowerCase().includes(searchInput) || 
                            (f.fineId || '').toLowerCase().includes(searchInput);
        return matchStatus && matchSearch;
    });

    if (filteredFines.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="px-6 py-10 text-center text-slate-500">Không có dữ liệu phiếu phạt.</td></tr>`;
        return;
    }

    tbody.innerHTML = filteredFines.map(f => {
        let statusBadge = '';
        if (f.status === 'unpaid') statusBadge = '<span class="px-2.5 py-1 bg-amber-100 text-amber-700 text-xs font-bold rounded-lg border border-amber-200">Chưa TT</span>';
        else if (f.status === 'paid') statusBadge = '<span class="px-2.5 py-1 bg-emerald-100 text-emerald-700 text-xs font-bold rounded-lg border border-emerald-200">Đã TT</span>';
        else if (f.status === 'waived') statusBadge = '<span class="px-2.5 py-1 bg-slate-100 text-slate-600 text-xs font-bold rounded-lg border border-slate-200" title="Lý do: '+ escapeHtml(f.waivedReason || '') +'">Đã Miễn</span>';

        let actionHtml = '';
        if (f.status === 'unpaid') {
            actionHtml = `
                <div class="flex items-center justify-center gap-2">
                    <button data-action="pay" data-id="${f.id}" class="px-3 py-1.5 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 hover:text-emerald-700 rounded-lg text-xs font-semibold border border-emerald-200 transition-colors tooltip tooltip-left" title="Xác nhận khách đã nộp tiền phạt">Thu Tiền</button>
                    <button data-action="waive" data-id="${f.id}" data-fineid="${f.fineId}" class="px-3 py-1.5 bg-rose-50 text-rose-600 hover:bg-rose-100 hover:text-rose-700 rounded-lg text-xs font-semibold border border-rose-200 transition-colors tooltip tooltip-left" title="Miễn phạt (Cần lý do)">Miễn</button>
                </div>
            `;
        } else if (f.status === 'paid') {
            actionHtml = `<span class="text-xs text-slate-400 block text-center">Thu lúc: <br/>${formatDate(f.paidAt)}</span>`;
        } else if (f.status === 'waived') {
            actionHtml = `<span class="text-xs text-slate-400 block text-center">Miễn lúc: <br/>${formatDate(f.waivedAt)}</span>`;
        }

        const bookTitlesEscaped = (f.bookTitles || []).map(escapeHtml).join(', ');
        return `
            <tr class="hover:bg-slate-50 transition-colors group">
                <td class="px-6 py-4">
                    <p class="font-bold text-slate-800 text-sm">${escapeHtml(f.fineId || '--')}</p>
                    <p class="text-xs text-slate-400 mt-0.5">Ref: <a href="#" class="hover:text-primary-600 hover:underline">${escapeHtml(f.recordId || '--')}</a></p>
                </td>
                <td class="px-6 py-4">
                    <p class="font-semibold text-slate-800">${escapeHtml(f.userName || 'Độc giả')}</p>
                    <p class="text-xs text-slate-500 max-w-[200px] truncate" title="${bookTitlesEscaped}">${bookTitlesEscaped}</p>
                </td>
                <td class="px-6 py-4 text-center">
                    <span class="font-bold text-rose-600 bg-rose-50 px-2 py-1 rounded-md border border-rose-100">${f.daysLate || 0} ngày</span>
                </td>
                <td class="px-6 py-4">
                    <p class="font-bold text-slate-800 text-base">${formatMoney(f.amount)}</p>
                </td>
                <td class="px-6 py-4">${statusBadge}</td>
                <td class="px-6 py-4 align-middle">${actionHtml}</td>
            </tr>
        `;
    }).join('');

    // Bind action buttons
    document.querySelectorAll('button[data-action="pay"]').forEach(btn => {
        btn.addEventListener('click', () => handlePayFine(btn.dataset.id));
    });

    document.querySelectorAll('button[data-action="waive"]').forEach(btn => {
        btn.addEventListener('click', () => openWaiveModal(btn.dataset.id, btn.dataset.fineid));
    });
};

const handlePayFine = async (docId) => {
    if (!confirm('Xác nhận độc giả đã nộp đủ tiền phạt?')) return;

    try {
        const fineRef = doc(db, 'fines', docId);
        await updateDoc(fineRef, { status: 'paid', paidAt: serverTimestamp() });

        // If user was locked due to this fine, restore to active if no other unpaid fines
        const fine = allFines.find(f => f.id === docId);
        if (fine?.userId) {
            const otherUnpaid = allFines.filter(f => f.id !== docId && f.userId === fine.userId && f.status === 'unpaid');
            if (otherUnpaid.length === 0) {
                const userRef = doc(db, 'users', fine.userId);
                const userSnap = await getDoc(userRef);
                if (userSnap.exists() && userSnap.data().status === 'locked') {
                    await updateDoc(userRef, { status: 'active', updatedAt: serverTimestamp() });
                }
            }
        }

        showToast('Đã xác nhận thu tiền phạt thành công!', 'success');
    } catch (error) {
        console.error("Pay error:", error);
        showToast('Lỗi khi xác nhận thanh toán', 'error');
    }
};

const bindEvents = () => {
    // Search
    const searchInput = document.getElementById('fineSearchInput');
    if (searchInput) {
        searchInput.addEventListener('input', renderFinesTable);
    }

    // Tabs
    const tabBtns = document.querySelectorAll('button[data-fine-status]');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => {
                b.classList.remove('bg-primary-600', 'text-white', 'shadow-md');
                b.classList.add('text-slate-600', 'hover:bg-slate-50');
            });
            btn.classList.remove('text-slate-600', 'hover:bg-slate-50');
            btn.classList.add('bg-primary-600', 'text-white', 'shadow-md');

            currentStatus = btn.dataset.fineStatus;
            renderFinesTable();
        });
    });

    // Modal
    const waiveModal = document.getElementById('waiveModal');
    const closeBtn = document.getElementById('closeWaiveModalBtn');
    const waiveForm = document.getElementById('waiveForm');

    closeBtn.addEventListener('click', () => waiveModal.classList.add('hidden'));

    waiveForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const docId = document.getElementById('waiveDocId').value;
        const reason = document.getElementById('waiveReason').value.trim();

        if (reason.length < 10) {
            showToast('Lý do miễn phạt phải dài ít nhất 10 ký tự', 'warning');
            return;
        }

        try {
            const fineRef = doc(db, 'fines', docId);
            await updateDoc(fineRef, {
                status: 'waived',
                waivedReason: reason,
                waivedBy: auth.currentUser?.uid,
                waivedAt: serverTimestamp()
            });

            waiveModal.classList.add('hidden');
            showToast('Đã miễn phạt thành công!', 'success');
        } catch (error) {
            console.error("Waive error:", error);
            showToast('Lỗi khi miễn phạt', 'error');
        }
    });
};

const openWaiveModal = (docId, fineId) => {
    document.getElementById('waiveDocId').value = docId;
    document.getElementById('waiveFineId').textContent = fineId || '--';
    document.getElementById('waiveReason').value = '';
    document.getElementById('waiveModal').classList.remove('hidden');
};

requireAdmin(() => initFinesPage());

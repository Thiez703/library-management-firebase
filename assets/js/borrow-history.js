import { auth, db } from './firebase-config.js';
import { doc, getDoc, collection, query, where, getDocs, orderBy } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-auth.js";
import { cleanupLegacyBorrowRecords, getTicketStatusView, subscribeUserTickets } from './borrow.js';
import { signOutUser } from './auth.js';

const formatDate = (tsLike) => {
    if (!tsLike || typeof tsLike.toDate !== 'function') return '--';
    return tsLike.toDate().toLocaleDateString('vi-VN');
};

const formatMoney = (value) => `${Number(value || 0).toLocaleString('vi-VN')} đ`;
const AVATAR_PLACEHOLDER = '../assets/images/avatar-placeholder.svg';

let unsubscribeTickets = null;

const historyState = {
    activeTab: 'borrowing',
    tickets: [],
    fines: []
};

const toMillis = (tsLike) => {
    if (!tsLike) return null;
    if (typeof tsLike.toMillis === 'function') return tsLike.toMillis();
    const date = new Date(tsLike);
    return Number.isNaN(date.getTime()) ? null : date.getTime();
};

const setText = (selector, value) => {
    const element = document.querySelector(selector);
    if (element) element.textContent = value;
};

const renderUserProfile = (user, userData) => {
    if (!user) {
        setText('#borrow-history-name', 'Khách');
        return;
    }
    const displayName = userData?.displayName || user.displayName || user.email.split('@')[0];
    const avatarUrl = userData?.photoURL || user.photoURL || AVATAR_PLACEHOLDER;
    const accountLabel = userData?.studentId || user.email;

    const avatar = document.getElementById('borrow-history-avatar');
    if (avatar) {
        avatar.src = avatarUrl;
        avatar.onerror = () => { avatar.src = AVATAR_PLACEHOLDER; };
    }

    setText('#borrow-history-name', displayName);
    setText('#borrow-history-meta', `Tài khoản: ${accountLabel}`);
};

const renderTickets = (tickets) => {
    const list = document.getElementById('borrow-history-list');
    const empty = document.getElementById('borrow-history-empty');
    if (!list) return;

    historyState.tickets = Array.isArray(tickets) ? tickets : [];
    
    // Lọc theo Tab hiện tại
    const visibleTickets = historyState.tickets.filter(t => {
        const view = getTicketStatusView(t);
        if (historyState.activeTab === 'borrowing') return view === 'borrowing' || view === 'overdue' || t.status === 'pending';
        if (historyState.activeTab === 'returned') return t.status === 'returned';
        return false;
    });

    // Cập nhật số lượng trên Tab
    const activeCount = historyState.tickets.filter(t => ['pending', 'borrowing'].includes(t.status) || getTicketStatusView(t) === 'overdue').length;
    const returnedCount = historyState.tickets.filter(t => t.status === 'returned').length;
    
    setText('#borrow-history-active-count', activeCount);
    setText('#borrow-history-returned-count', returnedCount);
    setText('#borrow-history-active-nav-count', activeCount);

    if (visibleTickets.length === 0) {
        list.innerHTML = '';
        list.classList.add('hidden');
        if (empty) empty.classList.remove('hidden');
        return;
    }

    if (empty) empty.classList.add('hidden');
    list.classList.remove('hidden');

    list.innerHTML = visibleTickets.map(ticket => {
        const status = getTicketStatusView(ticket);
        const isOverdue = status === 'overdue';
        return `
            <div class="bg-white rounded-2xl border ${isOverdue ? 'border-rose-200' : 'border-slate-200'} shadow-sm p-5 space-y-4">
                <div class="flex justify-between items-start">
                    <div>
                        <p class="text-xs text-slate-500 uppercase font-bold">Mã phiếu</p>
                        <p class="font-mono text-sm font-bold text-primary-600">${ticket.recordId || '---'}</p>
                    </div>
                    <span class="px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase ${
                        status === 'pending' ? 'bg-amber-100 text-amber-700' :
                        status === 'overdue' ? 'bg-rose-100 text-rose-700' :
                        status === 'borrowing' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'
                    }">${status === 'pending' ? 'Chờ duyệt' : status === 'overdue' ? 'Quá hạn' : status === 'borrowing' ? 'Đang mượn' : 'Đã trả'}</span>
                </div>
                <div class="grid grid-cols-2 gap-4 text-sm">
                    <div><p class="text-slate-400 text-xs">Ngày mượn</p><p class="font-medium">${formatDate(ticket.requestDate)}</p></div>
                    <div><p class="text-slate-400 text-xs">Hạn trả</p><p class="font-bold ${isOverdue ? 'text-rose-600' : ''}">${formatDate(ticket.dueDate)}</p></div>
                </div>
                <div class="pt-2 border-t border-slate-50">
                    <p class="text-xs text-slate-400 mb-2">Sách mượn:</p>
                    <ul class="space-y-1">
                        ${(ticket.books || []).map(b => `<li class="text-sm font-medium text-slate-700 flex items-center gap-2"><i class="ph ph-book"></i> ${b.title}</li>`).join('')}
                    </ul>
                </div>
            </div>
        `;
    }).join('');
};

const initBorrowHistory = () => {
    const root = document.getElementById('borrow-history-list');
    if (!root) return;

    // Đọc cache hiển thị trước cho nhanh
    const cached = localStorage.getItem('lib_user');
    if (cached) renderUserProfile(null, JSON.parse(cached));

    onAuthStateChanged(auth, async (user) => {
        if (!user) {
            window.location.href = 'login.html';
            return;
        }

        const userDoc = await getDoc(doc(db, 'users', user.uid));
        const userData = userDoc.exists() ? userDoc.data() : null;
        renderUserProfile(user, userData);

        if (unsubscribeTickets) unsubscribeTickets();
        unsubscribeTickets = subscribeUserTickets(user.uid, (tickets) => {
            renderTickets(tickets);
        });

        // Load nợ phạt (nếu cần)
        const fSnap = await getDocs(query(collection(db, 'fines'), where('userId', '==', user.uid)));
        historyState.fines = fSnap.docs.map(d => d.data());
        setText('#borrow-history-fines-count', historyState.fines.filter(f => f.status === 'unpaid').length);
    });

    // Bind tabs
    document.querySelectorAll('[data-borrow-tab]').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('[data-borrow-tab]').forEach(b => b.classList.remove('active', 'text-primary-600', 'border-b-2', 'border-primary-600'));
            btn.classList.add('active', 'text-primary-600', 'border-b-2', 'border-primary-600');
            historyState.activeTab = btn.getAttribute('data-borrow-tab');
            renderTickets(historyState.tickets);
        };
    });

    const logoutBtn = document.getElementById('borrowHistoryLogoutBtn');
    if (logoutBtn) logoutBtn.onclick = (e) => { e.preventDefault(); signOutUser(); };
};

document.addEventListener('turbo:load', initBorrowHistory);
document.addEventListener('DOMContentLoaded', initBorrowHistory);

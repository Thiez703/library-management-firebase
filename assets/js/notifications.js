/**
 * notifications.js — Trang thông báo người dùng
 * Đọc từ borrowRecords của user hiện tại và phân loại thành thông báo:
 *  - Phiếu mới được duyệt
 *  - Phiếu sắp quá hạn (≤ 3 ngày)
 *  - Phiếu đã quá hạn
 *  - Phiếu đã trả (5 phiếu gần nhất)
 */

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.0.0/firebase-auth.js';
import {
    collection, query, where, orderBy, limit, onSnapshot
} from 'https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js';

const CONTAINER_ID = 'notificationList';
const BADGE_ID = 'notificationBadge';

const getElem = (id) => document.getElementById(id);

// ─── Helpers ─────────────────────────────────────────────────────────────────

const toMillis = (ts) => {
    if (!ts) return null;
    if (typeof ts.toMillis === 'function') return ts.toMillis();
    const d = new Date(ts);
    return isNaN(d.getTime()) ? null : d.getTime();
};

const formatDate = (ts) => {
    const ms = toMillis(ts);
    if (!ms) return '--';
    return new Date(ms).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const daysFromNow = (ts) => {
    const ms = toMillis(ts);
    if (!ms) return null;
    return Math.ceil((ms - Date.now()) / 86400000);
};

// ─── Phân loại phiếu thành thông báo ─────────────────────────────────────────

const classifyTicket = (ticket) => {
    const { status } = ticket;
    const days = daysFromNow(ticket.dueDate);
    const bookList = (ticket.books || []).map(b => b.title).join(', ') || ticket.bookTitle || 'Sách';

    if (status === 'borrowing' && days !== null && days < 0) {
        return {
            type: 'overdue',
            icon: 'ph-warning-circle',
            iconBg: 'bg-rose-100',
            iconColor: 'text-rose-600',
            title: 'Sách quá hạn!',
            body: `Phiếu <b>${ticket.recordId || ticket.id}</b> — <em>${bookList}</em> đã quá hạn <b>${Math.abs(days)} ngày</b>. Vui lòng mang trả ngay.`,
            date: formatDate(ticket.dueDate),
            badge: 'bg-rose-100 text-rose-700',
            label: 'Quá hạn'
        };
    }
    if (status === 'borrowing' && days !== null && days <= 3) {
        return {
            type: 'due-soon',
            icon: 'ph-clock-countdown',
            iconBg: 'bg-amber-100',
            iconColor: 'text-amber-600',
            title: 'Sắp đến hạn trả',
            body: `Phiếu <b>${ticket.recordId || ticket.id}</b> — <em>${bookList}</em> còn <b>${days} ngày</b> nữa phải trả.`,
            date: formatDate(ticket.dueDate),
            badge: 'bg-amber-100 text-amber-700',
            label: 'Sắp hạn'
        };
    }
    if (status === 'borrowing') {
        return {
            type: 'borrowing',
            icon: 'ph-book-open',
            iconBg: 'bg-blue-100',
            iconColor: 'text-blue-600',
            title: 'Đang mượn sách',
            body: `Phiếu <b>${ticket.recordId || ticket.id}</b> — <em>${bookList}</em>. Hạn trả: <b>${formatDate(ticket.dueDate)}</b>.`,
            date: formatDate(ticket.requestDate),
            badge: 'bg-blue-100 text-blue-700',
            label: 'Đang mượn'
        };
    }
    if (status === 'pending') {
        return {
            type: 'pending',
            icon: 'ph-hourglass',
            iconBg: 'bg-violet-100',
            iconColor: 'text-violet-600',
            title: 'Phiếu chờ duyệt',
            body: `Phiếu <b>${ticket.recordId || ticket.id}</b> — <em>${bookList}</em> đang chờ thủ thư xác nhận.`,
            date: formatDate(ticket.requestDate),
            badge: 'bg-violet-100 text-violet-700',
            label: 'Chờ duyệt'
        };
    }
    if (status === 'returned') {
        return {
            type: 'returned',
            icon: 'ph-check-circle',
            iconBg: 'bg-emerald-100',
            iconColor: 'text-emerald-600',
            title: 'Đã trả sách thành công',
            body: `Phiếu <b>${ticket.recordId || ticket.id}</b> — <em>${bookList}</em> đã được xử lý hoàn tất.`,
            date: formatDate(ticket.returnDate || ticket.updatedAt || ticket.requestDate),
            badge: 'bg-emerald-100 text-emerald-700',
            label: 'Đã trả'
        };
    }
    return null;
};

// ─── Render ───────────────────────────────────────────────────────────────────

const ORDER = ['overdue', 'due-soon', 'pending', 'borrowing', 'returned'];

const renderNotifications = (tickets) => {
    const container = getElem(CONTAINER_ID);
    if (!container) return;

    const notifications = tickets
        .map(classifyTicket)
        .filter(Boolean)
        .sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type));

    // Badge tổng số chưa xử lý
    const urgent = notifications.filter(n => ['overdue', 'due-soon', 'pending'].includes(n.type));
    const badge = getElem(BADGE_ID);
    if (badge) {
        badge.textContent = urgent.length || '';
        badge.classList.toggle('hidden', urgent.length === 0);
    }

    if (!notifications.length) {
        container.innerHTML = `
            <div class="text-center py-16">
                <div class="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <i class="ph ph-bell-slash text-4xl text-slate-400"></i>
                </div>
                <p class="text-slate-600 font-semibold text-lg">Không có thông báo nào</p>
                <p class="text-slate-400 text-sm mt-1">Khi có hoạt động mượn trả, bạn sẽ thấy tại đây.</p>
                <a href="catalog.html" class="mt-5 inline-flex items-center gap-2 px-5 py-2.5 bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold rounded-xl transition-all">
                    <i class="ph ph-books"></i> Khám phá sách ngay
                </a>
            </div>`;
        return;
    }

    container.innerHTML = notifications.map(n => `
        <article class="bg-white border border-slate-200 rounded-2xl p-5 hover:shadow-md transition-all">
            <div class="flex items-start gap-4">
                <div class="w-11 h-11 rounded-full ${n.iconBg} flex items-center justify-center shrink-0">
                    <i class="ph ${n.icon} ${n.iconColor} text-xl"></i>
                </div>
                <div class="flex-1 min-w-0">
                    <div class="flex items-center justify-between gap-3 mb-1 flex-wrap">
                        <p class="font-bold text-slate-800">${n.title}</p>
                        <span class="text-xs font-semibold px-2.5 py-1 rounded-full ${n.badge} shrink-0">${n.label}</span>
                    </div>
                    <p class="text-sm text-slate-600 leading-relaxed">${n.body}</p>
                    <p class="text-xs text-slate-400 mt-2"><i class="ph ph-calendar-blank mr-1"></i>${n.date}</p>
                </div>
            </div>
        </article>
    `).join('');
};

const renderSkeleton = () => {
    const container = getElem(CONTAINER_ID);
    if (!container) return;
    container.innerHTML = Array(3).fill(0).map(() => `
        <div class="bg-white border border-slate-100 rounded-2xl p-5 animate-pulse">
            <div class="flex items-start gap-4">
                <div class="w-11 h-11 rounded-full bg-slate-200 shrink-0"></div>
                <div class="flex-1 space-y-2">
                    <div class="h-4 bg-slate-200 rounded w-1/3"></div>
                    <div class="h-3 bg-slate-100 rounded w-3/4"></div>
                    <div class="h-3 bg-slate-100 rounded w-1/2"></div>
                </div>
            </div>
        </div>
    `).join('');
};

// ─── Khởi tạo ─────────────────────────────────────────────────────────────────

const initNotifications = () => {
    if (!getElem(CONTAINER_ID)) return;

    renderSkeleton();

    onAuthStateChanged(auth, (user) => {
        if (!user) {
            getElem(CONTAINER_ID).innerHTML = `
                <div class="text-center py-12">
                    <i class="ph ph-sign-in text-5xl text-slate-300 mb-3"></i>
                    <p class="text-slate-500">Vui lòng <a href="login.html" class="text-primary-600 font-semibold hover:underline">đăng nhập</a> để xem thông báo.</p>
                </div>`;
            return;
        }

        // Lắng nghe realtime toàn bộ tickets của user (tối đa 30)
        const q = query(
            collection(db, 'borrowRecords'),
            where('userId', '==', user.uid),
            orderBy('requestDate', 'desc'),
            limit(30)
        );

        onSnapshot(q, (snap) => {
            const tickets = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            renderNotifications(tickets);
        }, (err) => {
            console.error('[notifications]', err);
            const container = getElem(CONTAINER_ID);
            if (container) container.innerHTML = `<p class="text-rose-500 text-center py-8">Không thể tải thông báo. Vui lòng thử lại.</p>`;
        });
    });
};

document.addEventListener('turbo:load', initNotifications);
document.addEventListener('turbo:render', initNotifications);
if (document.readyState !== 'loading') initNotifications();
else document.addEventListener('DOMContentLoaded', initNotifications);

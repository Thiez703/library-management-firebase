import { db } from './firebase-config.js';
import { requireAdmin } from './admin-guard.js';
import { 
    collection, 
    getDocs, 
    onSnapshot, 
    query, 
    orderBy, 
    limit, 
    where 
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

const getElem = (id) => document.getElementById(id);

const initDashboard = () => {
    console.log("Initializing Dashboard Stats...");

    // 1. Tổng số sách
    onSnapshot(collection(db, 'books'), (snap) => {
        const totalBooks = snap.size;
        const statElem = getElem('stat-total-books');
        if (statElem) statElem.innerText = totalBooks.toLocaleString();
    });

    // 2. Đang cho mượn
    const borrowingQuery = query(collection(db, 'borrowRecords'), where('status', '==', 'borrowing'));
    onSnapshot(borrowingQuery, (snap) => {
        const totalBorrowing = snap.size;
        const statElem = getElem('stat-borrowing');
        if (statElem) statElem.innerText = totalBorrowing.toLocaleString();
    });

    // 3. Độc giả thẻ
    const readersQuery = query(collection(db, 'users'), where('role', '==', 'reader'));
    onSnapshot(readersQuery, (snap) => {
        const totalReaders = snap.size;
        const statElem = getElem('stat-total-readers');
        if (statElem) statElem.innerText = totalReaders.toLocaleString();
    });

    // 4. Tổng số thể loại
    onSnapshot(collection(db, 'categories'), (snap) => {
        const totalCategories = snap.size;
        const statElem = getElem('stat-total-categories');
        if (statElem) statElem.innerText = totalCategories.toLocaleString();
    });

    // 5. Hoạt động gần đây (Lấy 10 bản ghi mới nhất từ borrowRecords)
    const recentActivityQuery = query(collection(db, 'borrowRecords'), orderBy('borrowDate', 'desc'), limit(10));
    onSnapshot(recentActivityQuery, (snap) => {
        renderRecentActivities(snap.docs);
    });

    // 6. Top 5 sách mượn nhiều (Mock logic dựa trên availableQuantity hoặc borrowCount nếu có)
    const topBooksQuery = query(collection(db, 'books'), orderBy('totalQuantity', 'desc'), limit(5));
    onSnapshot(topBooksQuery, (snap) => {
        renderTopBooks(snap.docs);
    });
};

const renderRecentActivities = (docs) => {
    const container = getElem('recent-activities');
    if (!container) return;

    if (docs.length === 0) {
        container.innerHTML = `
            <div class="px-6 py-12 text-center text-slate-400">
                <p class="text-sm">Chưa có hoạt động mượn trả nào.</p>
            </div>`;
        return;
    }

    container.innerHTML = docs.map(docSnap => {
        const data = docSnap.data();
        let icon = 'ph-book-open', iconBg = 'bg-blue-100', iconColor = 'text-blue-600';
        let actionText = `đã mượn cuốn`;

        if (data.status === 'returned') {
            icon = 'ph-check-circle'; iconBg = 'bg-emerald-100'; iconColor = 'text-emerald-600';
            actionText = `đã trả cuốn`;
        }

        const date = data.borrowDate?.toDate() || new Date();
        const timeStr = date.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

        return `
            <div class="px-6 py-4 hover:bg-slate-50/50 transition-colors">
                <div class="flex items-start gap-4">
                    <div class="w-10 h-10 rounded-full ${iconBg} flex items-center justify-center flex-shrink-0 mt-0.5">
                        <i class="ph ${icon} ${iconColor} text-lg"></i>
                    </div>
                    <div class="flex-1 min-w-0">
                        <p class="text-sm font-medium text-slate-800">
                            <span class="font-bold">${data.readerName || 'Độc giả'}</span> ${actionText} 
                            <span class="font-bold">"${data.bookTitle}"</span>
                        </p>
                        <p class="text-xs text-slate-500 mt-1">${timeStr}</p>
                    </div>
                </div>
            </div>`;
    }).join('');
};

const renderTopBooks = (docs) => {
    const container = getElem('top-borrowed-books');
    if (!container) return;

    container.innerHTML = docs.map((snap, index) => {
        const book = snap.data();
        const rank = index + 1;
        const bgRank = rank === 1 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600';
        // Tạm thời lấy tỉ lệ % dựa trên số lượng tổng để hiển thị progress bar
        const progress = Math.min(100, (book.totalQuantity / 50) * 100);

        return `
            <div class="px-6 py-4 hover:bg-slate-50/50 transition-colors">
                <div class="flex items-start gap-3 mb-2">
                    <span class="inline-flex items-center justify-center w-6 h-6 rounded-full ${bgRank} text-xs font-bold">${rank}</span>
                    <div class="flex-1 min-w-0">
                        <p class="text-sm font-semibold text-slate-800 line-clamp-1">${book.title}</p>
                        <p class="text-xs text-slate-500">Tổng số: ${book.totalQuantity} cuốn</p>
                    </div>
                </div>
                <div class="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div class="h-full bg-primary-500" style="width: ${progress}%"></div>
                </div>
            </div>`;
    }).join('');
};

// Khởi chạy — bảo vệ bằng admin guard
const guardedInit = () => requireAdmin(() => initDashboard());
document.addEventListener('turbo:load', guardedInit);
document.addEventListener('turbo:render', guardedInit);
if (document.readyState !== 'loading') guardedInit();
else document.addEventListener('DOMContentLoaded', guardedInit);

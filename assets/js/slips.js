import { db } from './firebase-config.js';
import { showToast } from './auth.js';
import {
    MAX_BOOKS_PER_TICKET,
    approveTicket,
    getTicketStatusView,
    handleCheckout,
    returnTicket,
    subscribeAllTickets,
    subscribeUserTickets
} from './borrow.js';
import {
    collection,
    getDocs,
    query,
    where
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

const BORROW_COLLECTION = 'borrowRecords';

const normalizeLegacyTicket = (ticket) => ({
    ...ticket,
    slipId: ticket.recordId || ticket.id,
    createdAt: ticket.requestDate || null,
    expiryDate: ticket.requestDate || null,
    items: Array.isArray(ticket.books) ? ticket.books : [],
    totalItems: Array.isArray(ticket.books) ? ticket.books.length : 0,
    status: getTicketStatusView(ticket) === 'overdue'
        ? 'overdue'
        : (ticket.status === 'borrowing' ? 'active' : ticket.status)
});

export const createBorrowSlip = async (userId, items, pickupDate, userDetails = {}) => {
    const recordId = await handleCheckout(
        {
            uid: userId,
            userDetails
        },
        items
    );

    if (recordId && pickupDate) {
        showToast(`Đã tạo phiếu ${recordId}. Ngày hẹn nhận: ${pickupDate}`, 'success');
    }

    return recordId;
};

export const getUserSlips = (userId, callback) => {
    return subscribeUserTickets(userId, (rows) => {
        callback(rows.map(normalizeLegacyTicket));
    });
};

export const getSlipById = async (slipId) => {
    const id = (slipId || '').trim().toUpperCase();
    if (!id) return null;

    const snap = await getDocs(
        query(collection(db, BORROW_COLLECTION), where('recordId', '==', id))
    );

    if (snap.empty) return null;

    const docSnap = snap.docs[0];
    return normalizeLegacyTicket({ id: docSnap.id, ...docSnap.data() });
};

export const confirmPickup = async (recordDocId, note = '') => {
    await approveTicket(recordDocId, note);
    showToast('Xác nhận bàn giao sách thành công!', 'success');
};

export const returnSlip = async (recordDocId, damageFee = 0, finalNote = '') => {
    await returnTicket(recordDocId, damageFee, finalNote);
    showToast('Đã hoàn tất trả sách!', 'success');
};

export const clearExpiredSlips = async () => {
    showToast('Chức năng dọn dẹp đã được chuyển sang server tự động.', 'info');
    return 0;
};

export const createGuestSlip = async () => {
    showToast('Luồng tạo phiếu khách đã bị tắt trong phiên bản mới.', 'error');
    return null;
};

export const getAllSlips = (statusFilter, callback) => {
    return subscribeAllTickets((rows) => {
        let filtered = rows;

        if (statusFilter) {
            filtered = rows.filter((ticket) => {
                const view = getTicketStatusView(ticket);
                if (statusFilter === 'active') return view === 'borrowing';
                if (statusFilter === 'overdue') return view === 'overdue';
                return ticket.status === statusFilter;
            });
        }

        callback(filtered.map(normalizeLegacyTicket));
    });
};

export { MAX_BOOKS_PER_TICKET };

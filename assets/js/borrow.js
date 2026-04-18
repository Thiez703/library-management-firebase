import { db } from './firebase-config.js';
import { showToast } from './auth.js';
import { clearCart } from './cart.js';
import { EmailJSService } from './emailjs-service.js';
import {
    collection,
    doc,
    addDoc,
    deleteDoc,
    getDocs,
    onSnapshot,
    query,
    runTransaction,
    serverTimestamp,
    Timestamp,
    increment,
    writeBatch,
    where
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

export const MAX_BOOKS_PER_TICKET = 5;
export const ONE_ACTIVE_TICKET_ONLY = true;
export const RESERVE_EXPIRY_HOURS = 24;
export const BORROW_DURATION_DAYS = 14;
export const FINE_PER_DAY = 5000; // Để tương thích API cũ

export const calculateFineAmount = (daysLate) => {
    if (daysLate <= 0) return 0;
    if (daysLate <= 7) return daysLate * 1000;
    if (daysLate <= 30) return daysLate * 2000;
    return daysLate * 5000;
};

const BORROW_COLLECTION = 'borrowRecords';

const isLegacyRecord = (record) => {
    const recordId = (record?.recordId || '').toString().trim().toUpperCase();
    const userDetails = record?.userDetails || {};
    const hasValidUserDetails = !!(userDetails.fullName && userDetails.phone && userDetails.cccd);

    return recordId.startsWith('REQ-') || !hasValidUserDetails;
};

const generateRecordId = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
    }
    return `LIB-${code}`;
};

const normalizeMoney = (value) => {
    const money = Number(value || 0);
    if (!Number.isFinite(money) || money < 0) return 0;
    return Math.round(money);
};

const toMillis = (tsLike) => {
    if (!tsLike) return null;
    if (typeof tsLike.toMillis === 'function') return tsLike.toMillis();
    const dt = new Date(tsLike);
    if (Number.isNaN(dt.getTime())) return null;
    return dt.getTime();
};

const formatRecordBook = (item) => ({
    bookId: item.bookId,
    title: item.title || 'Không rõ tên sách',
    author: item.author || 'Không rõ tác giả',
    coverUrl: item.coverUrl || '',
    price: normalizeMoney(item.price)
});

const ensureUserDetails = (userDetails) => {
    const fullName = (userDetails?.fullName || '').trim();
    const phone = (userDetails?.phone || '').trim();
    const cccd = (userDetails?.cccd || '').trim();

    if (!fullName || !phone || !cccd) {
        throw new Error('Vui lòng nhập đầy đủ Họ tên, Số điện thoại và CCCD.');
    }

    return { fullName, phone, cccd };
};

const ensureCartItems = (cartItems) => {
    if (!Array.isArray(cartItems) || cartItems.length === 0) {
        throw new Error('Giỏ mượn đang trống.');
    }
    if (cartItems.length > MAX_BOOKS_PER_TICKET) {
        throw new Error(`Mỗi phiếu chỉ được tối đa ${MAX_BOOKS_PER_TICKET} cuốn.`);
    }

    const seen = new Set();
    const cleaned = cartItems.map((item) => {
        const bookId = (item.bookId || item.id || '').trim();
        if (!bookId) {
            throw new Error('Dữ liệu giỏ mượn không hợp lệ.');
        }
        if (seen.has(bookId)) {
            throw new Error('Giỏ mượn không được chứa sách trùng lặp.');
        }
        seen.add(bookId);
        return formatRecordBook({ ...item, bookId });
    });

    return cleaned;
};

const hasExpiredPending = (recordData, nowMs) => {
    if (recordData.status !== 'pending') return false;
    const reqMs = toMillis(recordData.requestDate);
    if (!reqMs) return false;
    return nowMs - reqMs >= RESERVE_EXPIRY_HOURS * 60 * 60 * 1000;
};

const markCancelledAndRestore = async (recordDoc, reason) => {
    await runTransaction(db, async (transaction) => {
        const freshSnap = await transaction.get(recordDoc.ref);
        if (!freshSnap.exists()) return;

        const record = freshSnap.data() || {};
        const nowMs = Date.now();
        if (!hasExpiredPending(record, nowMs)) return;

        const books = Array.isArray(record.books) ? record.books : [];
        for (const item of books) {
            if (!item?.bookId) continue;
            const bookRef = doc(db, 'books', item.bookId);
            const bookSnap = await transaction.get(bookRef);
            if (!bookSnap.exists()) continue;
            const current = Number(bookSnap.data()?.availableQuantity || 0);
            const nextQty = current + 1;
            transaction.update(bookRef, {
                availableQuantity: nextQty,
                status: nextQty > 0 ? 'available' : 'out_of_stock'
            });
        }

        transaction.update(recordDoc.ref, {
            status: 'cancelled',
            adminNote: reason || 'Hệ thống tự huỷ sau thời gian giữ chỗ.',
            cancelledAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });
    });
};

export const cleanupLegacyBorrowRecords = async () => {
    const snapshot = await getDocs(collection(db, BORROW_COLLECTION));
    let removedCount = 0;
    let batch = writeBatch(db);
    let batchOps = 0;

    const flushBatch = async () => {
        if (batchOps === 0) return;
        await batch.commit();
        batch = writeBatch(db);
        batchOps = 0;
    };

    for (const docSnap of snapshot.docs) {
        const record = docSnap.data() || {};
        if (!isLegacyRecord(record)) continue;

        const books = Array.isArray(record.books) ? record.books : [];
        const isActiveLike = ['pending', 'borrowing'].includes((record.status || '').toString());

        if (isActiveLike) {
            for (const item of books) {
                if (!item?.bookId) continue;
                const bookRef = doc(db, 'books', item.bookId);
                batch.update(bookRef, {
                    availableQuantity: increment(1),
                    status: 'available'
                });
                batchOps += 1;
            }
        }

        batch.delete(docSnap.ref);
        batchOps += 1;
        removedCount += 1;

        if (batchOps >= 450) {
            await flushBatch();
        }
    }

    await flushBatch();

    return removedCount;
};

const hasAnyActiveRecord = async (userId) => {
    const activeStatuses = ['pending', 'borrowing'];
    const activeSnap = await getDocs(
        query(
            collection(db, BORROW_COLLECTION),
            where('userId', '==', userId),
            where('status', 'in', activeStatuses)
        )
    );

    if (activeSnap.empty) return false;

    const nowMs = Date.now();
    for (const docSnap of activeSnap.docs) {
        const data = docSnap.data() || {};
        if (hasExpiredPending(data, nowMs)) {
            await markCancelledAndRestore(docSnap, 'Hệ thống tự huỷ sau 24 giờ chưa nhận sách.');
            continue;
        }
        return true;
    }

    return false;
};

export const handleCheckout = async (userData, cartItems) => {
    const userId = (userData?.uid || '').trim();
    if (!userId) {
        showToast('Vui lòng đăng nhập để đăng ký mượn sách.', 'error');
        return null;
    }

    let books;
    let userDetails;
    try {
        books = ensureCartItems(cartItems);
        userDetails = ensureUserDetails(userData?.userDetails || userData);
    } catch (err) {
        showToast(err.message || 'Thông tin mượn chưa hợp lệ.', 'error');
        return null;
    }

    // Chặn mượn nếu nợ phạt chưa thanh toán (BIZ-04)
    const unpaidFinesSnap = await getDocs(
        query(
            collection(db, 'fines'),
            where('userId', '==', userId),
            where('status', '==', 'unpaid')
        )
    );
    if (!unpaidFinesSnap.empty) {
        showToast('Bạn đang có phiếu phạt quá hạn chưa thanh toán. Không thể mượn sách lúc này.', 'error');
        return null;
    }

    if (ONE_ACTIVE_TICKET_ONLY && await hasAnyActiveRecord(userId)) {
        showToast('Bạn đang có phiếu chờ duyệt hoặc đang mượn. Vui lòng hoàn tất phiếu hiện tại.', 'error');
        return null;
    }

    const recordId = generateRecordId();

    try {
        const ticketDocRef = doc(collection(db, BORROW_COLLECTION));

        await runTransaction(db, async (transaction) => {
            const bookRefs = books.map((item) => doc(db, 'books', item.bookId));
            const bookSnaps = await Promise.all(bookRefs.map((ref) => transaction.get(ref)));

            for (let i = 0; i < bookSnaps.length; i++) {
                if (!bookSnaps[i].exists()) {
                    throw new Error(`Sách "${books[i].title}" không tồn tại.`);
                }
                const available = Number(bookSnaps[i].data()?.availableQuantity || 0);
                if (available <= 0) {
                    throw new Error(`Sách "${books[i].title}" đã hết.`);
                }
            }

            for (let i = 0; i < bookRefs.length; i++) {
                const available = Number(bookSnaps[i].data()?.availableQuantity || 0);
                const nextQty = available - 1;
                transaction.update(bookRefs[i], {
                    availableQuantity: nextQty,
                    status: nextQty > 0 ? 'available' : 'out_of_stock'
                });
            }

            transaction.set(ticketDocRef, {
                recordId,
                userId,
                userDetails,
                books,
                status: 'pending',
                requestDate: serverTimestamp(),
                borrowDate: null,
                dueDate: null,
                returnDate: null,
                fineOverdue: 0,
                fineDamage: 0,
                adminNote: '',
                updatedAt: serverTimestamp()
            });
        });

        clearCart();
        showToast(`Đăng ký thành công! Mã phiếu của bạn là ${recordId}.`);

        // Gửi email thông báo mã mượn qua EmailJS
        const readerEmail = userDetails.email || userData.email;
        if (readerEmail) {
            EmailJSService.send(EmailJSService.CONFIG.TEMPLATES.BORROW_CODE, {
                user_name: userDetails.fullName,
                record_id: recordId,
                book_count: books.length,
                reader_email: readerEmail
            });
        }

        return recordId;
    } catch (err) {
        showToast(err.message || 'Không thể tạo phiếu mượn.', 'error');
        return null;
    }
};

export const approveTicket = async (recordDocId, initialNote = '') => {
    if (!recordDocId) throw new Error('Thiếu mã tài liệu phiếu mượn.');

    await runTransaction(db, async (transaction) => {
        const recordRef = doc(db, BORROW_COLLECTION, recordDocId);
        const recordSnap = await transaction.get(recordRef);
        if (!recordSnap.exists()) throw new Error('Phiếu mượn không tồn tại.');

        const record = recordSnap.data() || {};
        if (record.status !== 'pending') {
            throw new Error('Phiếu này không ở trạng thái chờ duyệt.');
        }

        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + BORROW_DURATION_DAYS);
        const dueDateStr = dueDate.toLocaleDateString('vi-VN');

        transaction.update(recordRef, {
            status: 'borrowing',
            borrowDate: serverTimestamp(),
            dueDate: Timestamp.fromDate(dueDate),
            adminNote: (initialNote || '').trim(),
            updatedAt: serverTimestamp()
        });

        // Gửi email báo phiếu đã duyệt qua EmailJS
        const readerEmail = record.userDetails?.email || record.email;
        if (readerEmail) {
            EmailJSService.send(EmailJSService.CONFIG.TEMPLATES.APPROVED, {
                user_name: record.userDetails?.fullName || 'Độc giả',
                record_id: record.recordId,
                due_date: dueDateStr,
                reader_email: readerEmail
            });
        }
    });
};

export const returnTicket = async (recordDocId, damageFee = 0, finalNote = '') => {
    if (!recordDocId) throw new Error('Thiếu mã tài liệu phiếu mượn.');

    await runTransaction(db, async (transaction) => {
        const recordRef = doc(db, BORROW_COLLECTION, recordDocId);
        const recordSnap = await transaction.get(recordRef);

        if (!recordSnap.exists()) throw new Error('Phiếu mượn không tồn tại.');

        const record = recordSnap.data() || {};
        if (record.status !== 'borrowing') {
            throw new Error('Phiếu không ở trạng thái đang mượn.');
        }

        const nowMs = Date.now();
        const dueMs = toMillis(record.dueDate);
        let fineOverdue = 0;
        let daysLate = 0;
        if (dueMs && nowMs > dueMs) {
            daysLate = Math.ceil((nowMs - dueMs) / (1000 * 60 * 60 * 24));
            fineOverdue = calculateFineAmount(daysLate); // BIZ-01
        }

        const books = Array.isArray(record.books) ? record.books : [];
        const bookReadResults = [];

        for (const item of books) {
            if (!item?.bookId) continue;
            const bookRef = doc(db, 'books', item.bookId);
            const bookSnap = await transaction.get(bookRef);
            if (!bookSnap.exists()) continue;

            bookReadResults.push({ bookRef, bookSnap });
        }

        for (const { bookRef, bookSnap } of bookReadResults) {
            const currentQty = Number(bookSnap.data()?.availableQuantity || 0);
            const nextQty = currentQty + 1;
            transaction.update(bookRef, {
                availableQuantity: nextQty,
                status: 'available'
            });
        }

        transaction.update(recordRef, {
            status: 'returned',
            returnDate: serverTimestamp(),
            fineOverdue,
            fineDamage: normalizeMoney(damageFee),
            adminNote: (finalNote || '').trim(),
            updatedAt: serverTimestamp()
        });

        // BIZ-02: Nếu có trễ hạn, sinh ra phiếu phạt
        if (daysLate > 0) {
            const fineRef = doc(collection(db, 'fines'));
            transaction.set(fineRef, {
                fineId: `F-${generateRecordId().replace('LIB-', '')}`,
                recordId: record.recordId || recordDocId,
                userId: record.userId || '',
                userName: record.userDetails?.fullName || 'Độc giả',
                bookTitles: books.map(b => b.title || 'Sách không tên'),
                dueDate: record.dueDate || Timestamp.fromMillis(dueMs),
                returnDate: serverTimestamp(),
                daysLate: daysLate,
                amount: fineOverdue,
                status: 'unpaid', // unpaid, paid, waived
                paidAt: null,
                waivedAt: null,
                waivedReason: null,
                waivedBy: null,
                createdAt: serverTimestamp()
            });
        }
    });
};

export const extendTicket = async (recordDocId, extraDays = 7, note = '') => {
    if (!recordDocId) throw new Error('Thiếu mã tài liệu phiếu mượn.');
    const days = Math.max(1, Math.min(30, Number(extraDays) || 7));

    await runTransaction(db, async (transaction) => {
        const recordRef = doc(db, BORROW_COLLECTION, recordDocId);
        const recordSnap = await transaction.get(recordRef);

        if (!recordSnap.exists()) throw new Error('Phiếu mượn không tồn tại.');

        const record = recordSnap.data() || {};
        if (record.status !== 'borrowing') {
            throw new Error('Chỉ có thể gia hạn phiếu đang ở trạng thái đang mượn.');
        }

        // Tính hạn trả mới: lấy từ dueDate hiện tại (hoặc hôm nay nếu đã quá hạn)
        const baseDateMs = Math.max(toMillis(record.dueDate) || Date.now(), Date.now());
        const newDueDate = new Date(baseDateMs);
        newDueDate.setDate(newDueDate.getDate() + days);

        transaction.update(recordRef, {
            dueDate: Timestamp.fromDate(newDueDate),
            adminNote: (note || '').trim() || `Gia hạn thêm ${days} ngày.`,
            updatedAt: serverTimestamp()
        });
    });
};


export const subscribeUserTickets = (userId, callback) => {
    if (!userId) {
        callback([]);
        return () => {};
    }

    const q = query(collection(db, BORROW_COLLECTION), where('userId', '==', userId));

    return onSnapshot(
        q,
        (snap) => {
            const rows = snap.docs
                .map((d) => ({ id: d.id, ...d.data() }))
                .sort((a, b) => (toMillis(b.requestDate) || 0) - (toMillis(a.requestDate) || 0));
            callback(rows);
        },
        (err) => {
            console.error('subscribeUserTickets error:', err);
            callback([]);
        }
    );
};

export const subscribeAllTickets = (callback) => {
    return onSnapshot(
        collection(db, BORROW_COLLECTION),
        (snap) => {
            const rows = snap.docs
                .map((d) => ({ id: d.id, ...d.data() }))
                .sort((a, b) => (toMillis(b.requestDate) || 0) - (toMillis(a.requestDate) || 0));
            callback(rows);
        },
        (err) => {
            console.error('subscribeAllTickets error:', err);
            callback([]);
        }
    );
};

export const getTicketStatusView = (ticket) => {
    if (ticket.status !== 'borrowing') return ticket.status;
    const dueMs = toMillis(ticket.dueDate);
    if (dueMs && Date.now() > dueMs) return 'overdue';
    return 'borrowing';
};

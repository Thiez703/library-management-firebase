import { db } from './firebase-config.js';
import { showToast } from './auth.js';
import { clearCart } from './cart.js';
import { EmailJSService } from './emailjs-service.js';
import { checkBorrowEligibility, calculateReputationPenalty, IDENTITY_ERRORS } from './identity.js';
import {
    collection,
    doc,
    addDoc,
    deleteDoc,
    getDoc,
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
export const MAX_EXTENSIONS = 3; // BIZ-07: Tối đa 3 lần gia hạn mỗi phiếu

export const calculateFineAmount = (daysLate, schedule) => {
    if (daysLate <= 0) return 0;
    const tiers = schedule?.lateFees;
    if (tiers && tiers.length > 0) {
        for (const tier of tiers) {
            if (tier.maxDays === null || daysLate <= tier.maxDays) {
                return daysLate * (tier.ratePerDay || 0);
            }
        }
        return daysLate * (tiers[tiers.length - 1].ratePerDay || 0);
    }
    // Fallback to hardcoded tiers
    if (daysLate <= 7) return daysLate * 1000;
    if (daysLate <= 30) return daysLate * 2000;
    return daysLate * 5000;
};

let _feeScheduleCache = null;
let _feeScheduleCacheMs = 0;
const FEE_SCHEDULE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export const getActiveFeeSchedule = async () => {
    const now = Date.now();
    if (_feeScheduleCache && now - _feeScheduleCacheMs < FEE_SCHEDULE_TTL_MS) {
        return _feeScheduleCache;
    }
    try {
        const snap = await getDoc(doc(db, 'system', 'feeSchedule'));
        _feeScheduleCache = snap.exists() ? snap.data() : null;
        _feeScheduleCacheMs = now;
    } catch {
        // Network error — use stale cache or null
    }
    return _feeScheduleCache;
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

    // === LớP BẢO VỆ DANH TÍNH ===
    // Kiểm tra xác minh và uy tín trước khi cho mượn
    const eligibility = await checkBorrowEligibility(userId);
    if (!eligibility.eligible) {
        showToast(eligibility.reason || 'Không đủ điều kiện mượn sách.', 'error');
        // Trả về error code để frontend xử lý (hiển form xác minh)
        return { error: eligibility.errorCode || 'INELIGIBLE' };
    }

    // Lấy thông tin từ Firestore (\u0111ã xác minh) thay vì từ form
    const identity = eligibility.identity;
    const userDetails = {
        fullName: identity.fullName || identity.displayName || '',
        phone: identity.phone || '',
        cccd: identity.cccdHash || '' // Lưu hash, không lưu plain text
    };

    let books;
    try {
        books = ensureCartItems(cartItems);
        // Validate userDetails từ identity (không cần form input nữa)
        if (!userDetails.fullName || !userDetails.phone) {
            throw new Error('Thông tin người dùng chưa đầy đủ. Vui lòng xác minh lại.');
        }
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
            // BIZ-12: Đọc tất cả docs trong transaction — Firestore tự retry khi conflict
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
        const readerEmail = identity.email || userData.email;
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

// BIZ-09: Nhận borrowDurationDays từ caller để đọc từ settings thay vì hardcode
export const approveTicket = async (recordDocId, initialNote = '', borrowDurationDays = BORROW_DURATION_DAYS) => {
    if (!recordDocId) throw new Error('Thiếu mã tài liệu phiếu mượn.');
    const duration = Math.max(1, Math.min(365, Number(borrowDurationDays) || BORROW_DURATION_DAYS));

    await runTransaction(db, async (transaction) => {
        const recordRef = doc(db, BORROW_COLLECTION, recordDocId);
        const recordSnap = await transaction.get(recordRef);
        if (!recordSnap.exists()) throw new Error('Phiếu mượn không tồn tại.');

        const record = recordSnap.data() || {};
        if (record.status !== 'pending') {
            throw new Error('Phiếu này không ở trạng thái chờ duyệt.');
        }

        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + duration);
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

    const feeSchedule = await getActiveFeeSchedule();

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
            fineOverdue = calculateFineAmount(daysLate, feeSchedule); // BIZ-01: uses dynamic schedule
        }

        // === READ PHASE: Đọc tất cả documents trước ===
        const books = Array.isArray(record.books) ? record.books : [];
        const bookReadResults = [];

        for (const item of books) {
            if (!item?.bookId) continue;
            const bookRef = doc(db, 'books', item.bookId);
            const bookSnap = await transaction.get(bookRef);
            if (!bookSnap.exists()) continue;
            bookReadResults.push({ bookRef, bookSnap });
        }

        // Đọc user doc cho reputation (phải đọc trước khi write)
        let userSnap = null;
        let userRef = null;
        if (daysLate > 0 && record.userId) {
            userRef = doc(db, 'users', record.userId);
            userSnap = await transaction.get(userRef);
        }

        // === WRITE PHASE: Ghi tất cả sau khi đọc xong ===
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

        // BIZ-02: Dùng ID cố định = recordDocId để idempotent khi retry
        const totalFine = normalizeMoney(fineOverdue + damageFee);
        if (totalFine > 0) {
            const fineRef = doc(db, 'fines', recordDocId);
            transaction.set(fineRef, {
                fineId: `F-${generateRecordId().replace('LIB-', '')}`,
                recordId: record.recordId || recordDocId,
                userId: record.userId || '',
                userName: record.userDetails?.fullName || 'Độc giả',
                bookTitles: books.map(b => b.title || 'Sách không tên'),
                dueDate: record.dueDate || Timestamp.fromMillis(dueMs),
                returnDate: serverTimestamp(),
                daysLate: daysLate,
            amount: totalFine,
            overdueAmount: normalizeMoney(fineOverdue),
            damageAmount: normalizeMoney(damageFee),
                status: 'unpaid',
                paidAt: null,
                waivedAt: null,
                waivedReason: null,
                waivedBy: null,
                createdAt: serverTimestamp()
            });
        }

        // === CẬP NHẬT ĐIỂM UY TÍN ===
        // Trừ điểm uy tín khi trả trễ (-5 điểm/ngày trễ, tối thiểu 0)
        if (daysLate > 0 && userSnap && userSnap.exists()) {
            const currentScore = typeof userSnap.data().reputationScore === 'number'
                ? userSnap.data().reputationScore
                : (typeof userSnap.data().trustScore === 'number' ? userSnap.data().trustScore : 100);
            const penalty = calculateReputationPenalty(daysLate);
            const newScore = Math.max(0, currentScore - penalty);
            transaction.update(userRef, {
                reputationScore: newScore,
                trustScore: newScore,
                updatedAt: serverTimestamp()
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

        // BIZ-07: Kiểm tra giới hạn số lần gia hạn
        const currentExtensions = Number(record.extensionCount || 0);
        if (currentExtensions >= MAX_EXTENSIONS) {
            throw new Error(`Phiếu này đã gia hạn ${MAX_EXTENSIONS} lần, không thể gia hạn thêm.`);
        }

        // BIZ-04: Luôn tính từ dueDate gốc để đúng nghiệp vụ gia hạn
        // (gia hạn 7 ngày từ hạn trả, không phải từ hôm nay)
        const baseDateMs = toMillis(record.dueDate) || Date.now();
        const newDueDate = new Date(baseDateMs);
        newDueDate.setDate(newDueDate.getDate() + days);

        transaction.update(recordRef, {
            dueDate: Timestamp.fromDate(newDueDate),
            extensionCount: currentExtensions + 1,
            adminNote: (note || '').trim() || `Gia hạn thêm ${days} ngày (lần ${currentExtensions + 1}/${MAX_EXTENSIONS}).`,
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

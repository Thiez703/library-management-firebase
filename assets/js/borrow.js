import { db } from './firebase-config.js';
import { showToast } from './auth.js';
import { clearCart } from './cart.js';
import { EmailJSService } from './emailjs-service.js';
import {
    checkBorrowEligibility,
    calculateNoViolationBonus,
    calculateReputationDeltaForReturn,
    getMaxBorrowBooksByScore
} from './identity.js';
import { getSystemSettings } from './admin-settings.js';
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

// Fallback defaults — sẽ bị ghi đè bởi getSystemSettings()
export const MAX_BOOKS_PER_TICKET = 5;
export const ONE_ACTIVE_TICKET_ONLY = true;
export const RESERVE_EXPIRY_HOURS = 24;
export const BORROW_DURATION_DAYS = 14;
export const MAX_EXTENSIONS = 3; // BIZ-07: Tối đa 3 lần gia hạn mỗi phiếu

// Helper: lấy settings từ Firestore (cached 5 phút)
const getLibSettings = async () => {
    try {
        const s = await getSystemSettings();
        return s?.library || {};
    } catch { return {}; }
};

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

const ensureCartItems = async (cartItems) => {
    if (!Array.isArray(cartItems) || cartItems.length === 0) {
        throw new Error('Giỏ mượn đang trống.');
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
        const quantity = Math.max(1, Math.min(MAX_BOOKS_PER_TICKET, Number(item?.quantity) || 1));
        return {
            ...formatRecordBook({ ...item, bookId }),
            quantity
        };
    });

    const libSettings = await getLibSettings();
    const maxBooks = libSettings.maxBooksPerTicket || MAX_BOOKS_PER_TICKET;
    const totalQty = cleaned.reduce((sum, item) => sum + item.quantity, 0);
    if (totalQty > maxBooks) {
        throw new Error(`Mỗi phiếu chỉ được tối đa ${maxBooks} cuốn.`);
    }

    return cleaned;
};

const hasExpiredPending = (recordData, nowMs, expiryHours = RESERVE_EXPIRY_HOURS) => {
    if (recordData.status !== 'pending') return false;
    const reqMs = toMillis(recordData.requestDate);
    if (!reqMs) return false;
    return nowMs - reqMs >= expiryHours * 60 * 60 * 1000;
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
            const restoreQty = Math.max(1, Number(item?.quantity || 1));
            const nextQty = current + restoreQty;
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
                const restoreQty = Math.max(1, Number(item?.quantity || 1));
                batch.update(bookRef, {
                    availableQuantity: increment(restoreQty),
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

    // Thủ thư không được mượn sách — chỉ quản lý
    const cachedUser = JSON.parse(localStorage.getItem('lib_user') || '{}');
    if (cachedUser?.role === 'librarian') {
        showToast('Tài khoản Thủ thư không có quyền mượn sách. Vui lòng sử dụng tài khoản Độc giả.', 'error');
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
        books = await ensureCartItems(cartItems);
        // Validate userDetails từ identity (không cần form input nữa)
        if (!userDetails.fullName || !userDetails.phone) {
            throw new Error('Thông tin người dùng chưa đầy đủ. Vui lòng xác minh lại.');
        }
    } catch (err) {
        showToast(err.message || 'Thông tin mượn chưa hợp lệ.', 'error');
        return null;
    }

    const maxBorrowBooks = Math.max(0, Number(eligibility.maxBorrowBooks || getMaxBorrowBooksByScore(identity.reputationScore)));
    const requestedQty = books.reduce((sum, item) => sum + Math.max(1, Number(item?.quantity || 1)), 0);
    if (requestedQty > maxBorrowBooks) {
        showToast(`Hạng uy tín hiện tại chỉ cho phép mượn tối đa ${maxBorrowBooks} cuốn.`, 'error');
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
                const needed = Math.max(1, Number(books[i]?.quantity || 1));
                if (available < needed) {
                    throw new Error(`Sách "${books[i].title}" đã hết.`);
                }
            }

            for (let i = 0; i < bookRefs.length; i++) {
                const available = Number(bookSnaps[i].data()?.availableQuantity || 0);
                const borrowQty = Math.max(1, Number(books[i]?.quantity || 1));
                const nextQty = available - borrowQty;
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
            const totalQty = books.reduce((sum, item) => sum + Math.max(1, Number(item?.quantity || 1)), 0);
            EmailJSService.send(EmailJSService.CONFIG.TEMPLATES.BORROW_CODE, {
                user_name: userDetails.fullName,
                record_id: recordId,
                book_count: totalQty,
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

export const cancelPendingTicket = async (recordDocId, userId, note = '') => {
    if (!recordDocId) throw new Error('Thiếu mã tài liệu phiếu mượn.');
    if (!userId) throw new Error('Thiếu thông tin người dùng.');

    await runTransaction(db, async (transaction) => {
        const recordRef = doc(db, BORROW_COLLECTION, recordDocId);
        const recordSnap = await transaction.get(recordRef);
        if (!recordSnap.exists()) throw new Error('Phiếu mượn không tồn tại.');

        const record = recordSnap.data() || {};
        if ((record.userId || '') !== userId) {
            throw new Error('Bạn không có quyền huỷ phiếu này.');
        }
        if (record.status !== 'pending') {
            throw new Error('Chỉ có thể huỷ phiếu đang chờ duyệt.');
        }

        const books = Array.isArray(record.books) ? record.books : [];
        const bookReadResults = [];
        for (const item of books) {
            if (!item?.bookId) continue;
            const bookRef = doc(db, 'books', item.bookId);
            const bookSnap = await transaction.get(bookRef);
            if (!bookSnap.exists()) continue;
            bookReadResults.push({ bookRef, bookSnap, item });
        }

        for (const { bookRef, bookSnap, item } of bookReadResults) {
            const currentQty = Number(bookSnap.data()?.availableQuantity || 0);
            const restoreQty = Math.max(1, Number(item?.quantity || 1));
            const nextQty = currentQty + restoreQty;
            transaction.update(bookRef, {
                availableQuantity: nextQty,
                status: nextQty > 0 ? 'available' : 'out_of_stock'
            });
        }

        transaction.update(recordRef, {
            status: 'cancelled',
            adminNote: (note || '').trim() || 'Độc giả tự huỷ phiếu trước khi duyệt.',
            cancelledAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });
    });
};

export const updatePendingTicket = async (recordDocId, userId, selectedBooks, note = '') => {
    if (!recordDocId) throw new Error('Thiếu mã tài liệu phiếu mượn.');
    if (!userId) throw new Error('Thiếu thông tin người dùng.');

    const normalizedBooks = Array.isArray(selectedBooks)
        ? selectedBooks
            .map((item) => ({
                bookId: (item?.bookId || '').toString().trim(),
                quantity: Math.max(1, Math.min(MAX_BOOKS_PER_TICKET, Number(item?.quantity) || 1))
            }))
            .filter((item) => item.bookId)
        : [];

    if (!normalizedBooks.length) {
        throw new Error('Phiếu mượn phải có ít nhất một cuốn sách.');
    }

    const totalQuantity = normalizedBooks.reduce((sum, item) => sum + item.quantity, 0);
    if (totalQuantity > MAX_BOOKS_PER_TICKET) {
        throw new Error(`Mỗi phiếu chỉ được tối đa ${MAX_BOOKS_PER_TICKET} cuốn.`);
    }

    const seen = new Set();
    for (const item of normalizedBooks) {
        if (seen.has(item.bookId)) {
            throw new Error('Không được chọn trùng sách trong cùng phiếu.');
        }
        seen.add(item.bookId);
    }

    await runTransaction(db, async (transaction) => {
        const recordRef = doc(db, BORROW_COLLECTION, recordDocId);
        const recordSnap = await transaction.get(recordRef);
        if (!recordSnap.exists()) throw new Error('Phiếu mượn không tồn tại.');

        const record = recordSnap.data() || {};
        if ((record.userId || '') !== userId) {
            throw new Error('Bạn không có quyền sửa phiếu này.');
        }
        if (record.status !== 'pending') {
            throw new Error('Chỉ có thể chỉnh sửa phiếu đang chờ duyệt.');
        }

        const currentBooks = Array.isArray(record.books) ? record.books : [];
        const currentMap = new Map();
        currentBooks.forEach((item) => {
            const bookId = (item?.bookId || '').toString().trim();
            if (!bookId) return;
            currentMap.set(bookId, Math.max(1, Number(item?.quantity || 1)));
        });

        const nextMap = new Map();
        normalizedBooks.forEach((item) => nextMap.set(item.bookId, item.quantity));

        const allBookIds = new Set([...currentMap.keys(), ...nextMap.keys()]);
        const bookSnapshots = new Map();

        for (const bookId of allBookIds) {
            const bookRef = doc(db, 'books', bookId);
            const bookSnap = await transaction.get(bookRef);
            if (!bookSnap.exists()) {
                throw new Error('Một trong các sách đã chọn không còn tồn tại.');
            }
            bookSnapshots.set(bookId, { ref: bookRef, snap: bookSnap });
        }

        for (const bookId of allBookIds) {
            const currentQty = currentMap.get(bookId) || 0;
            const nextQtyNeed = nextMap.get(bookId) || 0;
            const stockNow = Number(bookSnapshots.get(bookId)?.snap.data()?.availableQuantity || 0);
            const stockAfter = stockNow + currentQty - nextQtyNeed;
            if (stockAfter < 0) {
                const title = bookSnapshots.get(bookId)?.snap.data()?.title || 'Sách đã chọn';
                throw new Error(`Số lượng "${title}" không đủ để cập nhật phiếu.`);
            }
        }

        for (const bookId of allBookIds) {
            const currentQty = currentMap.get(bookId) || 0;
            const nextQtyNeed = nextMap.get(bookId) || 0;
            const stockNow = Number(bookSnapshots.get(bookId)?.snap.data()?.availableQuantity || 0);
            const stockAfter = stockNow + currentQty - nextQtyNeed;

            transaction.update(bookSnapshots.get(bookId).ref, {
                availableQuantity: stockAfter,
                status: stockAfter > 0 ? 'available' : 'out_of_stock'
            });
        }

        const nextBookDetails = normalizedBooks.map((item) => {
            const bookData = bookSnapshots.get(item.bookId)?.snap.data() || {};
            return {
                bookId: item.bookId,
                title: bookData.title || 'Không rõ',
                author: bookData.author || 'Không rõ',
                coverUrl: bookData.coverUrl || '',
                price: Number(bookData.price || 0),
                quantity: item.quantity
            };
        });

        transaction.update(recordRef, {
            books: nextBookDetails,
            adminNote: (note || '').trim() || record.adminNote || '',
            updatedAt: serverTimestamp()
        });
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

        // Đọc user doc cho reputation (phải đọc trước khi write) — luôn đọc để áp dụng bonus on-time
        let userSnap = null;
        let userRef = null;
        if (record.userId) {
            userRef = doc(db, 'users', record.userId);
            userSnap = await transaction.get(userRef);
        }

        // === WRITE PHASE: Ghi tất cả sau khi đọc xong ===
        for (const { bookRef, bookSnap } of bookReadResults) {
            const matchedItem = books.find((b) => b?.bookId === bookRef.id);
            const returnQty = Math.max(1, Number(matchedItem?.quantity || 1));
            const currentQty = Number(bookSnap.data()?.availableQuantity || 0);
            const nextQty = currentQty + returnQty;
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
        if (userSnap && userSnap.exists()) {
            const userData = userSnap.data();
            const currentScore = typeof userData.reputationScore === 'number'
                ? userData.reputationScore
                : (typeof userData.trustScore === 'number' ? userData.trustScore : 100);
            const evalResult = calculateReputationDeltaForReturn({ daysLate, note: finalNote });
            // noViolationBonus chỉ áp dụng khi trả đúng hạn và không có phạt hỏng
            const noViolationBonus = (daysLate <= 0 && normalizeMoney(damageFee) <= 0)
                ? calculateNoViolationBonus({ lastPenaltyAt: userData.lastPenaltyAt })
                : 0;
            const delta = Number(evalResult.delta || 0) + Number(noViolationBonus || 0);
            const newScore = Math.max(0, Math.min(100, currentScore + delta));
            // Chỉ khóa tài khoản khi vi phạm nghiêm trọng (điểm quá thấp hoặc mất sách)
            // Không khóa chỉ vì có phạt tiền — đọc giả vẫn có thể trả tiền sau
            const currentStatus = userData.status || 'active';
            const nextStatus = evalResult.shouldLockAccount
                ? 'locked'
                : (['banned', 'permanently_banned', 'permanent_ban'].includes(currentStatus) ? currentStatus : 'active');
            transaction.update(userRef, {
                reputationScore: newScore,
                trustScore: newScore,
                status: nextStatus,
                lastPenaltyAt: delta < 0 ? serverTimestamp() : (userData.lastPenaltyAt || null),
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

        // BIZ-07: Kiểm tra giới hạn số lần gia hạn (đọc từ settings)
        const libSettings = await getLibSettings();
        const maxExt = libSettings.maxExtensions ?? MAX_EXTENSIONS;
        const currentExtensions = Number(record.extensionCount || 0);
        if (currentExtensions >= maxExt) {
            throw new Error(`Phiếu này đã gia hạn ${maxExt} lần, không thể gia hạn thêm.`);
        }

        // BIZ-04: Luôn tính từ dueDate gốc để đúng nghiệp vụ gia hạn
        // (gia hạn 7 ngày từ hạn trả, không phải từ hôm nay)
        const baseDateMs = toMillis(record.dueDate) || Date.now();
        const newDueDate = new Date(baseDateMs);
        newDueDate.setDate(newDueDate.getDate() + days);

        transaction.update(recordRef, {
            dueDate: Timestamp.fromDate(newDueDate),
            extensionCount: currentExtensions + 1,
            adminNote: (note || '').trim() || `Gia hạn thêm ${days} ngày (lần ${currentExtensions + 1}/${maxExt}).`,
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

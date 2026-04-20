/**
 * identity.js — Module xác minh danh tính & chống gian lận
 *
 * 3 lớp bảo vệ:
 *  1. UID là neo — uy tín gắn với uid Firebase
 *  2. Unique index — mỗi SĐT/CCCD chỉ dùng cho 1 tài khoản
 *  3. Khóa cứng — phone/cccdHash/isVerified chỉ admin sửa được
 *
 * Exports:
 *  - hashCCCD(cccd)           → string (SHA-256 hex)
 *  - verifyUser(uid, phone, cccd)  → void | throws
 *  - getUserIdentity(uid)     → { isVerified, phone, cccdHash, reputationScore, displayName }
 *  - IDENTITY_ERRORS          → error code map
 */

import { db } from './firebase-config.js';
import {
    collection,
    doc,
    getDocs,
    getDoc,
    query,
    runTransaction,
    serverTimestamp,
    where
} from 'https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js';
import { getSystemSettings } from './admin-settings.js';

// ── Error codes ──────────────────────────────────────────────────────────────

export const IDENTITY_ERRORS = Object.freeze({
    PHONE_ALREADY_USED: 'PHONE_ALREADY_USED',
    CCCD_ALREADY_USED: 'CCCD_ALREADY_USED',
    ALREADY_VERIFIED: 'ALREADY_VERIFIED',
    USER_NOT_VERIFIED: 'USER_NOT_VERIFIED',
    REPUTATION_TOO_LOW: 'REPUTATION_TOO_LOW',
    INVALID_PHONE: 'INVALID_PHONE',
    INVALID_CCCD: 'INVALID_CCCD',
    PHONE_CHANGE_TOO_SOON: 'PHONE_CHANGE_TOO_SOON',
    CCCD_MISMATCH: 'CCCD_MISMATCH',
    SAME_PHONE: 'SAME_PHONE',
    ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
    ACCOUNT_BANNED: 'ACCOUNT_BANNED',
    UNPAID_FINE: 'UNPAID_FINE'
});

export let PHONE_CHANGE_COOLDOWN_DAYS = 60;

const ERROR_MESSAGES = Object.freeze({
    [IDENTITY_ERRORS.PHONE_ALREADY_USED]: 'Số điện thoại này đã được đăng ký với tài khoản khác.',
    [IDENTITY_ERRORS.CCCD_ALREADY_USED]: 'Số CCCD này đã được đăng ký với tài khoản khác.',
    [IDENTITY_ERRORS.ALREADY_VERIFIED]: 'Tài khoản đã được xác minh trước đó.',
    [IDENTITY_ERRORS.USER_NOT_VERIFIED]: 'Vui lòng xác minh danh tính trước khi mượn sách.',
    [IDENTITY_ERRORS.REPUTATION_TOO_LOW]: 'Điểm uy tín dưới ngưỡng cho phép. Tài khoản bị khóa mượn sách.',
    [IDENTITY_ERRORS.INVALID_PHONE]: 'Số điện thoại không hợp lệ. Vui lòng nhập đúng 10 số.',
    [IDENTITY_ERRORS.INVALID_CCCD]: 'Số CCCD không hợp lệ. Vui lòng nhập đúng 12 số.',
    [IDENTITY_ERRORS.CCCD_MISMATCH]: 'Số CCCD không khớp với tài khoản đã xác minh.',
    [IDENTITY_ERRORS.SAME_PHONE]: 'Số điện thoại mới phải khác số hiện tại.',
    [IDENTITY_ERRORS.ACCOUNT_LOCKED]: 'Tài khoản đang bị khóa mượn. Vui lòng liên hệ thủ thư.',
    [IDENTITY_ERRORS.ACCOUNT_BANNED]: 'Tài khoản đã bị khóa vĩnh viễn do vi phạm nghiêm trọng.',
    [IDENTITY_ERRORS.UNPAID_FINE]: 'Không thể mượn do bạn còn khoản nợ chưa thanh toán. Vui lòng thanh toán để tiếp tục.'
});

export let REPUTATION_DEFAULT = 100;
export let REPUTATION_MIN_BORROW = 40;
export let REPUTATION_PENALTY_PER_DAY = 5;
let NO_VIOLATION_BONUS_AMOUNT = 20;
let NO_VIOLATION_PERIOD_MS = 180 * 24 * 60 * 60 * 1000; // 6 tháng

// Tải settings từ Firestore để ghi đè defaults
const refreshSettingsForIdentity = async () => {
    try {
        const s = await getSystemSettings();
        if (s?.reputation) {
            REPUTATION_DEFAULT = s.reputation.defaultScore ?? 100;
            REPUTATION_MIN_BORROW = s.reputation.minBorrowScore ?? 40;
            REPUTATION_PENALTY_PER_DAY = s.reputation.penaltyPerDay ?? 5;
            NO_VIOLATION_BONUS_AMOUNT = s.reputation.noViolationBonus ?? 20;
            NO_VIOLATION_PERIOD_MS = (s.reputation.noViolationPeriodDays ?? 180) * 24 * 60 * 60 * 1000;
        }
        if (s?.security) {
            PHONE_CHANGE_COOLDOWN_DAYS = s.security.phoneChangeCooldownDays ?? 60;
        }
    } catch { /* fallback to defaults */ }
};

const BORROW_TIERS = [
    { min: 80, maxBooks: 5, label: 'Tốt' },
    { min: 70, maxBooks: 4, label: 'Khá' },
    { min: 60, maxBooks: 3, label: 'Trung bình' },
    { min: 50, maxBooks: 2, label: 'Dưới trung bình' },
    { min: 40, maxBooks: 1, label: 'Thấp' },
    { min: 0, maxBooks: 0, label: 'Kém (không được mượn)' }
];

const clampReputationScore = (value) => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));

export const getBorrowTierByScore = (score) => {
    const normalized = clampReputationScore(score);
    return BORROW_TIERS.find((tier) => normalized >= tier.min) || BORROW_TIERS[BORROW_TIERS.length - 1];
};

export const getMaxBorrowBooksByScore = (score) => getBorrowTierByScore(score).maxBooks;

const toMillis = (value) => {
    if (!value) return null;
    if (typeof value.toMillis === 'function') return value.toMillis();
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.getTime();
};

export const calculateReputationFromMetrics = (baseScore, metrics = {}) => {
    const fallbackScore = clampReputationScore(baseScore ?? REPUTATION_DEFAULT);
    const overdueItems = Number(metrics.overdueItems || 0);
    const unpaidFine = Number(metrics.unpaidFine || 0);
    const violationCount = Number(metrics.violationCount || 0);
    const isBlocked = metrics.isBlocked === true;

    const hasPenalty = overdueItems > 0 || unpaidFine > 0 || violationCount > 0 || isBlocked;
    if (!hasPenalty) return fallbackScore;

    let score = fallbackScore;
    score -= Math.min(35, overdueItems * 12);
    score -= Math.min(30, unpaidFine > 0 ? 20 : 0);
    score -= Math.min(20, violationCount * 4);
    score -= isBlocked ? 25 : 0;
    return clampReputationScore(score);
};

export const getLiveReputationScore = async (uid, baseScore = REPUTATION_DEFAULT) => {
    if (!uid) return clampReputationScore(baseScore);

    try {
        const [recordSnap, fineSnap] = await Promise.all([
            getDocs(query(collection(db, 'borrowRecords'), where('userId', '==', uid))),
            getDocs(query(collection(db, 'fines'), where('userId', '==', uid)))
        ]);

        const now = Date.now();
        const overdueItems = recordSnap.docs.reduce((count, docSnap) => {
            const record = docSnap.data() || {};
            if (record.status !== 'borrowing') return count;
            const dueMs = toMillis(record.dueDate);
            if (!dueMs || dueMs >= now) return count;
            const bookCount = Array.isArray(record.books) && record.books.length > 0 ? record.books.length : 1;
            return count + bookCount;
        }, 0);

        const unpaidFine = fineSnap.docs.reduce((sum, docSnap) => {
            const fine = docSnap.data() || {};
            if ((fine.status || '').toString().toLowerCase() !== 'unpaid') return sum;
            return sum + Number(fine.amount || fine.fineAmount || 0);
        }, 0);

        const violationCount = recordSnap.docs.reduce((count, docSnap) => {
            const record = docSnap.data() || {};
            if (record.status !== 'borrowing') return count;
            const dueMs = toMillis(record.dueDate);
            return dueMs && dueMs < now ? count + 1 : count;
        }, 0) + fineSnap.docs.filter((docSnap) => (docSnap.data()?.status || '').toString().toLowerCase() === 'unpaid').length;

        return calculateReputationFromMetrics(baseScore, { overdueItems, unpaidFine, violationCount });
    } catch (error) {
        console.error('Error calculating live reputation score:', error);
        return clampReputationScore(baseScore);
    }
};

// ── Validation helpers ───────────────────────────────────────────────────────

const PHONE_REGEX = /^0\d{9}$/;       // VN phone: 0xxxxxxxxx (10 digits)
const CCCD_REGEX = /^\d{12}$/;         // CCCD: 12 digits

const validatePhone = (phone) => {
    const cleaned = (phone || '').replace(/[\s\-\.]/g, '').trim();
    if (!PHONE_REGEX.test(cleaned)) {
        throw createIdentityError(IDENTITY_ERRORS.INVALID_PHONE);
    }
    return cleaned;
};

const validateCCCD = (cccd) => {
    const cleaned = (cccd || '').replace(/[\s\-\.]/g, '').trim();
    if (!CCCD_REGEX.test(cleaned)) {
        throw createIdentityError(IDENTITY_ERRORS.INVALID_CCCD);
    }
    return cleaned;
};

// ── Error factory ────────────────────────────────────────────────────────────

const createIdentityError = (code) => {
    const err = new Error(ERROR_MESSAGES[code] || code);
    err.code = code;
    return err;
};

// ── CCCD Hashing (SHA-256 via Web Crypto API) ────────────────────────────────

/**
 * Hash CCCD bằng SHA-256.
 * Không cần thư viện ngoài — dùng Web Crypto API có sẵn trong browser.
 * @param {string} cccd — Số CCCD 12 chữ số
 * @returns {Promise<string>} — Hex string (64 ký tự)
 */
export const hashCCCD = async (cccd) => {
    const encoder = new TextEncoder();
    // Thêm salt cố định để tránh rainbow table
    const data = encoder.encode(`libspace_cccd_salt_v1::${cccd}`);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
};

// ── Get user identity info ───────────────────────────────────────────────────

/**
 * Lấy thông tin danh tính đã xác minh của user.
 * @param {string} uid
 * @returns {Promise<Object>} { isVerified, phone, cccdHash, reputationScore, displayName, fullName }
 */
export const getUserIdentity = async (uid) => {
    if (!uid) return null;

    const userSnap = await getDoc(doc(db, 'users', uid));
    if (!userSnap.exists()) return null;

    const data = userSnap.data();
    return {
        isVerified: data.isVerified === true,
        phone: data.phone || null,
        cccdHash: data.cccdHash || null,
        reputationScore: typeof data.reputationScore === 'number'
            ? data.reputationScore
            : (typeof data.trustScore === 'number' ? data.trustScore : REPUTATION_DEFAULT),
        trustScore: typeof data.reputationScore === 'number'
            ? data.reputationScore
            : (typeof data.trustScore === 'number' ? data.trustScore : REPUTATION_DEFAULT),
        displayName: data.displayName || '',
        fullName: data.displayName || data.fullName || '',
        email: data.email || '',
        status: data.status || 'active'
    };
};

// ── Verify user identity (Firestore Transaction) ─────────────────────────────

/**
 * Xác minh danh tính người dùng. Chạy trong Firestore Transaction để đảm bảo:
 *  - Không có race condition (2 user cùng nhập 1 SĐT cùng lúc)
 *  - Atomic: tất cả hoặc không gì cả
 *
 * @param {string} uid — Firebase Auth UID
 * @param {string} rawPhone — Số điện thoại (10 số, bắt đầu bằng 0)
 * @param {string} rawCccd — Số CCCD (12 số)
 * @throws {Error} với code: PHONE_ALREADY_USED, CCCD_ALREADY_USED, ALREADY_VERIFIED, INVALID_*
 */
export const verifyUser = async (uid, rawPhone, rawCccd) => {
    // 1. Validate input
    const phone = validatePhone(rawPhone);
    const cccd = validateCCCD(rawCccd);
    const cccdHashed = await hashCCCD(cccd);

    // 2. Run atomic transaction
    await runTransaction(db, async (transaction) => {
        // Read phase — đọc tất cả documents cần thiết trước
        const userRef = doc(db, 'users', uid);
        const phoneRef = doc(db, 'phones', phone);
        const cccdRef = doc(db, 'cccds', cccdHashed);

        const [userSnap, phoneSnap, cccdSnap] = await Promise.all([
            transaction.get(userRef),
            transaction.get(phoneRef),
            transaction.get(cccdRef)
        ]);

        // 3. Check: user đã xác minh chưa?
        if (userSnap.exists() && userSnap.data().isVerified === true) {
            throw createIdentityError(IDENTITY_ERRORS.ALREADY_VERIFIED);
        }

        // 4. Check: SĐT đã được dùng bởi account khác?
        if (phoneSnap.exists()) {
            const existingUid = phoneSnap.data().uid;
            if (existingUid !== uid) {
                throw createIdentityError(IDENTITY_ERRORS.PHONE_ALREADY_USED);
            }
        }

        // 5. Check: CCCD đã được dùng bởi account khác?
        if (cccdSnap.exists()) {
            const existingUid = cccdSnap.data().uid;
            if (existingUid !== uid) {
                throw createIdentityError(IDENTITY_ERRORS.CCCD_ALREADY_USED);
            }
        }

        // 6. Write phase — tất cả writes phải sau tất cả reads
        // Update user document
        transaction.update(userRef, {
            phone,
            cccdHash: cccdHashed,
            isVerified: true,
            verifiedAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });

        // Create unique indexes
        transaction.set(phoneRef, {
            uid,
            createdAt: serverTimestamp()
        });

        transaction.set(cccdRef, {
            uid,
            createdAt: serverTimestamp()
        });
    });
};

// ── Check borrow eligibility ─────────────────────────────────────────────────

/**
 * Kiểm tra user có đủ điều kiện mượn sách không.
 * @param {string} uid
 * @returns {Promise<{ eligible: boolean, identity: Object, reason?: string }>}
 */
export const checkBorrowEligibility = async (uid) => {
    // Lấy settings mới nhất
    await refreshSettingsForIdentity();

    const identity = await getUserIdentity(uid);

    if (!identity) {
        return { eligible: false, identity: null, reason: 'Tài khoản không tồn tại.' };
    }

    const accountStatus = (identity?.status || 'active').toString().toLowerCase();
    if (['banned', 'permanent_ban', 'permanently_banned'].includes(accountStatus)) {
        return {
            eligible: false,
            identity,
            reason: ERROR_MESSAGES[IDENTITY_ERRORS.ACCOUNT_BANNED],
            errorCode: IDENTITY_ERRORS.ACCOUNT_BANNED
        };
    }

    if (['locked', 'blocked', 'suspended', 'disabled', 'inactive'].includes(accountStatus)) {
        return {
            eligible: false,
            identity,
            reason: ERROR_MESSAGES[IDENTITY_ERRORS.ACCOUNT_LOCKED],
            errorCode: IDENTITY_ERRORS.ACCOUNT_LOCKED
        };
    }

    if (!identity.isVerified) {
        return {
            eligible: false,
            identity,
            reason: ERROR_MESSAGES[IDENTITY_ERRORS.USER_NOT_VERIFIED],
            errorCode: IDENTITY_ERRORS.USER_NOT_VERIFIED
        };
    }

    const fineSnap = await getDocs(
        query(
            collection(db, 'fines'),
            where('userId', '==', uid),
            where('status', '==', 'unpaid')
        )
    );
    if (!fineSnap.empty) {
        return {
            eligible: false,
            identity,
            reason: ERROR_MESSAGES[IDENTITY_ERRORS.UNPAID_FINE],
            errorCode: IDENTITY_ERRORS.UNPAID_FINE
        };
    }

    // BIZ-03: Dùng live score thay vì giá trị lưu trong Firestore để tránh stale data
    const liveScore = await getLiveReputationScore(uid, identity.reputationScore);
    const identityWithLiveScore = { ...identity, reputationScore: liveScore, trustScore: liveScore };

    if (liveScore < REPUTATION_MIN_BORROW) {
        return {
            eligible: false,
            identity: identityWithLiveScore,
            reason: ERROR_MESSAGES[IDENTITY_ERRORS.REPUTATION_TOO_LOW],
            errorCode: IDENTITY_ERRORS.REPUTATION_TOO_LOW
        };
    }

    const tier = getBorrowTierByScore(liveScore);
    return { eligible: true, identity: identityWithLiveScore, maxBorrowBooks: tier.maxBooks, tierLabel: tier.label };
};

// ── Reputation helpers ───────────────────────────────────────────────────────

/**
 * Tính số điểm uy tín bị trừ dựa trên số ngày trễ.
 * @param {number} daysLate
 * @returns {number} Số điểm bị trừ (luôn >= 0)
 */
export const calculateReputationPenalty = (daysLate) => {
    if (daysLate <= 0) return 0;
    if (daysLate <= 3) return 5;
    if (daysLate <= 7) return 20;
    return REPUTATION_DEFAULT;
};

export const calculateReputationDeltaForReturn = ({ daysLate = 0, note = '' } = {}) => {
    const text = (note || '').toString().toLowerCase();
    const hasDirtyBook = text.includes('bẩn') || text.includes('ban sach') || text.includes('sách bẩn');
    const hasLostBook = text.includes('mất sách') || text.includes('mat sach');

    let delta = 0;
    let shouldLockAccount = false;
    let reasons = [];

    if (daysLate <= 0) {
        delta += 2;
        reasons.push('Trả đúng hạn: +2');
    } else if (daysLate <= 3) {
        delta -= 5;
        reasons.push('Trả muộn 1-3 ngày: -5');
    } else if (daysLate <= 7) {
        delta -= 20;
        reasons.push('Trả muộn 4-7 ngày: -20');
    } else {
        delta -= 100;
        shouldLockAccount = true;
        reasons.push('Trả muộn quá 7 ngày: khóa tài khoản');
    }

    if (hasDirtyBook) {
        delta -= 20;
        reasons.push('Sách bẩn/hư hại nhẹ: -20');
    }

    if (hasLostBook) {
        delta -= 40;
        reasons.push('Mất sách: -40');
    }

    return { delta, shouldLockAccount, reasons };
};

export const calculateNoViolationBonus = ({ lastPenaltyAt, nowMs = Date.now() } = {}) => {
    const lastPenaltyMs = toMillis(lastPenaltyAt);
    if (!lastPenaltyMs) return 0;
    return nowMs - lastPenaltyMs >= NO_VIOLATION_PERIOD_MS ? NO_VIOLATION_BONUS_AMOUNT : 0;
};

// ── Phone change cooldown ────────────────────────────────────────────────────

/**
 * Kiểm tra trạng thái cooldown đổi SĐT của user.
 * @param {string} uid
 * @returns {{ canChange: boolean, nextAllowedDate: Date|null, daysLeft: number }}
 */
export const getPhoneChangeCooldown = async (uid) => {
    const identity = await getUserIdentity(uid);
    if (!identity) return { canChange: false, nextAllowedDate: null, daysLeft: 0 };

    const phoneChangedAt = (await (async () => {
        const snap = await getDoc(doc(db, 'users', uid));
        return snap.exists() ? snap.data().phoneChangedAt : null;
    })());

    if (!phoneChangedAt) return { canChange: true, nextAllowedDate: null, daysLeft: 0 };

    const lastMs = typeof phoneChangedAt.toMillis === 'function'
        ? phoneChangedAt.toMillis()
        : new Date(phoneChangedAt).getTime();

    const cooldownMs = PHONE_CHANGE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
    const nextAllowedMs = lastMs + cooldownMs;
    const now = Date.now();

    if (now >= nextAllowedMs) return { canChange: true, nextAllowedDate: null, daysLeft: 0 };

    const daysLeft = Math.ceil((nextAllowedMs - now) / (24 * 60 * 60 * 1000));
    return { canChange: false, nextAllowedDate: new Date(nextAllowedMs), daysLeft };
};

/**
 * Đổi số điện thoại (tối đa 1 lần mỗi 60 ngày).
 * Yêu cầu nhập lại CCCD để xác nhận danh tính trước khi đổi.
 *
 * @param {string} uid
 * @param {string} rawNewPhone — SĐT mới
 * @param {string} rawCccd    — CCCD để xác nhận danh tính
 * @throws {Error} với message mô tả lý do thất bại
 */
export const changePhone = async (uid, rawNewPhone, rawCccd) => {
    const newPhone = validatePhone(rawNewPhone);
    const cccd = validateCCCD(rawCccd);
    const cccdHashed = await hashCCCD(cccd);

    await runTransaction(db, async (transaction) => {
        const userRef = doc(db, 'users', uid);
        const newPhoneRef = doc(db, 'phones', newPhone);

        const [userSnap, newPhoneSnap] = await Promise.all([
            transaction.get(userRef),
            transaction.get(newPhoneRef)
        ]);

        if (!userSnap.exists()) throw new Error('Tài khoản không tồn tại.');

        const userData = userSnap.data();

        if (!userData.isVerified) {
            throw new Error('Tài khoản chưa xác minh danh tính.');
        }

        // Xác nhận CCCD khớp trước khi cho đổi SĐT
        if (userData.cccdHash !== cccdHashed) {
            throw createIdentityError(IDENTITY_ERRORS.CCCD_MISMATCH);
        }

        if (userData.phone === newPhone) {
            throw createIdentityError(IDENTITY_ERRORS.SAME_PHONE);
        }

        // Kiểm tra cooldown 60 ngày
        const phoneChangedAt = userData.phoneChangedAt;
        if (phoneChangedAt) {
            const lastMs = typeof phoneChangedAt.toMillis === 'function'
                ? phoneChangedAt.toMillis()
                : new Date(phoneChangedAt).getTime();
            const cooldownMs = PHONE_CHANGE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
            if (Date.now() < lastMs + cooldownMs) {
                const nextDate = new Date(lastMs + cooldownMs).toLocaleDateString('vi-VN');
                const err = new Error(`Bạn chỉ được đổi số điện thoại sau ngày ${nextDate}.`);
                err.code = IDENTITY_ERRORS.PHONE_CHANGE_TOO_SOON;
                throw err;
            }
        }

        // SĐT mới đã được dùng bởi account khác?
        if (newPhoneSnap.exists() && newPhoneSnap.data().uid !== uid) {
            throw createIdentityError(IDENTITY_ERRORS.PHONE_ALREADY_USED);
        }

        // Xóa index SĐT cũ
        if (userData.phone) {
            const oldPhoneRef = doc(db, 'phones', userData.phone);
            transaction.delete(oldPhoneRef);
        }

        // Tạo index SĐT mới
        transaction.set(newPhoneRef, { uid, createdAt: serverTimestamp() });

        // Cập nhật user
        transaction.update(userRef, {
            phone: newPhone,
            phoneChangedAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });
    });
};

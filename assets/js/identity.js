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
    doc,
    getDoc,
    runTransaction,
    serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js';

// ── Error codes ──────────────────────────────────────────────────────────────

export const IDENTITY_ERRORS = Object.freeze({
    PHONE_ALREADY_USED: 'PHONE_ALREADY_USED',
    CCCD_ALREADY_USED: 'CCCD_ALREADY_USED',
    ALREADY_VERIFIED: 'ALREADY_VERIFIED',
    USER_NOT_VERIFIED: 'USER_NOT_VERIFIED',
    REPUTATION_TOO_LOW: 'REPUTATION_TOO_LOW',
    INVALID_PHONE: 'INVALID_PHONE',
    INVALID_CCCD: 'INVALID_CCCD'
});

const ERROR_MESSAGES = Object.freeze({
    [IDENTITY_ERRORS.PHONE_ALREADY_USED]: 'Số điện thoại này đã được đăng ký với tài khoản khác.',
    [IDENTITY_ERRORS.CCCD_ALREADY_USED]: 'Số CCCD này đã được đăng ký với tài khoản khác.',
    [IDENTITY_ERRORS.ALREADY_VERIFIED]: 'Tài khoản đã được xác minh trước đó.',
    [IDENTITY_ERRORS.USER_NOT_VERIFIED]: 'Vui lòng xác minh danh tính trước khi mượn sách.',
    [IDENTITY_ERRORS.REPUTATION_TOO_LOW]: 'Điểm uy tín của bạn quá thấp (< 30). Không thể mượn sách.',
    [IDENTITY_ERRORS.INVALID_PHONE]: 'Số điện thoại không hợp lệ. Vui lòng nhập đúng 10 số.',
    [IDENTITY_ERRORS.INVALID_CCCD]: 'Số CCCD không hợp lệ. Vui lòng nhập đúng 12 số.'
});

export const REPUTATION_DEFAULT = 100;
export const REPUTATION_MIN_BORROW = 30;
export const REPUTATION_PENALTY_PER_DAY = 5;

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
        reputationScore: typeof data.reputationScore === 'number' ? data.reputationScore : REPUTATION_DEFAULT,
        displayName: data.displayName || '',
        fullName: data.displayName || data.fullName || '',
        email: data.email || ''
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
    const identity = await getUserIdentity(uid);

    if (!identity) {
        return { eligible: false, identity: null, reason: 'Tài khoản không tồn tại.' };
    }

    if (!identity.isVerified) {
        return {
            eligible: false,
            identity,
            reason: ERROR_MESSAGES[IDENTITY_ERRORS.USER_NOT_VERIFIED],
            errorCode: IDENTITY_ERRORS.USER_NOT_VERIFIED
        };
    }

    if (identity.reputationScore < REPUTATION_MIN_BORROW) {
        return {
            eligible: false,
            identity,
            reason: ERROR_MESSAGES[IDENTITY_ERRORS.REPUTATION_TOO_LOW],
            errorCode: IDENTITY_ERRORS.REPUTATION_TOO_LOW
        };
    }

    return { eligible: true, identity };
};

// ── Reputation helpers ───────────────────────────────────────────────────────

/**
 * Tính số điểm uy tín bị trừ dựa trên số ngày trễ.
 * @param {number} daysLate
 * @returns {number} Số điểm bị trừ (luôn >= 0)
 */
export const calculateReputationPenalty = (daysLate) => {
    if (daysLate <= 0) return 0;
    return Math.min(daysLate * REPUTATION_PENALTY_PER_DAY, REPUTATION_DEFAULT);
};

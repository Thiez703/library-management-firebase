/**
 * profile.js — Trang hồ sơ cá nhân người dùng
 * Chức năng:
 *  - Hiển thị thông tin user từ Firestore
 *  - Cho phép cập nhật displayName, phone
 *  - Đổi mật khẩu (yêu cầu re-authenticate)
 */

import { auth, db } from './firebase-config.js';
import { doc, getDoc, onSnapshot, updateDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js';
import {
    onAuthStateChanged,
    updatePassword,
    EmailAuthProvider,
    reauthenticateWithCredential
} from 'https://www.gstatic.com/firebasejs/10.0.0/firebase-auth.js';
import { showToast } from './notify.js';
import { getLiveReputationScore, changePhone, getPhoneChangeCooldown, PHONE_CHANGE_COOLDOWN_DAYS } from './identity.js';

const AVATAR_PLACEHOLDER = '../assets/images/avatar-placeholder.svg';
const CACHE_KEY = 'lib_user';

const getElem = (id) => document.getElementById(id);
let unsubscribeProfileDoc = null;
let currentUserData = null;

// ─── Hiển thị thông tin ──────────────────────────────────────────────────────

const renderProfile = async (firebaseUser, userData, bindPhoneForm = false) => {
    if (!firebaseUser) {
        window.location.replace('login.html');
        return;
    }

    const displayName = userData?.displayName || firebaseUser.displayName || firebaseUser.email || 'Người dùng';
    const email = userData?.email || firebaseUser.email || '--';
    const phone = userData?.phone || userData?.phoneNumber || '';
    const photoURL = userData?.photoURL || firebaseUser.photoURL || AVATAR_PLACEHOLDER;
    const roleLabels = { admin: 'Quản trị viên', librarian: 'Thủ thư' };
    const role = roleLabels[userData?.role] || 'Độc giả';
    const status = (userData?.status || 'active') === 'active' ? 'Đang hoạt động' : 'Tạm khóa';
    const createdAt = userData?.createdAt?.toDate?.()?.toLocaleDateString('vi-VN') || '--';
    const readerCode = `US-${firebaseUser.uid.slice(0, 6).toUpperCase()}`;
    const isVerified = userData?.isVerified === true;
    const baseReputationScore = typeof userData?.reputationScore === 'number'
        ? userData.reputationScore
        : (typeof userData?.trustScore === 'number' ? userData.trustScore : 100);
    const reputationScore = await getLiveReputationScore(firebaseUser.uid, baseReputationScore);

    // Avatar
    const avatarEl = getElem('profileAvatar');
    if (avatarEl) {
        avatarEl.src = photoURL;
        avatarEl.onerror = () => { avatarEl.src = AVATAR_PLACEHOLDER; };
    }

    // Thông tin tĩnh
    const setText = (id, val) => { const el = getElem(id); if (el) el.textContent = val || '--'; };
    setText('profileName', displayName);
    setText('profileEmail', email);
    setText('profileRole', role);
    setText('profileStatus', status);
    setText('profileCreatedAt', createdAt);
    setText('profileMemberCode', readerCode);

    // Hiển thị trạng thái xác minh
    const verifyStatusEl = getElem('profileVerifyStatus');
    if (verifyStatusEl) {
        if (isVerified) {
            verifyStatusEl.innerHTML = '<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700"><i class="ph-fill ph-seal-check"></i> Đã xác minh</span>';
        } else {
            verifyStatusEl.innerHTML = '<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700"><i class="ph ph-warning"></i> Chưa xác minh</span>';
        }
    }

    // Hiển thị điểm uy tín
    const repScoreEl = getElem('profileReputationScore');
    if (repScoreEl) {
        repScoreEl.textContent = `${reputationScore} / 100`;
        if (reputationScore >= 80) {
            repScoreEl.className = 'text-sm font-bold text-emerald-600';
        } else if (reputationScore >= 50) {
            repScoreEl.className = 'text-sm font-bold text-amber-600';
        } else {
            repScoreEl.className = 'text-sm font-bold text-rose-600';
        }
    }

    // Form chỉnh sửa — prefill
    const nameInput = getElem('profileNameInput');
    const phoneInput = getElem('profilePhoneInput');
    if (nameInput) nameInput.value = displayName;
    if (phoneInput) {
        phoneInput.value = phone;
        // Khóa phone nếu đã xác minh (dùng section đổi SĐT riêng thay thế)
        if (isVerified) {
            phoneInput.readOnly = true;
            phoneInput.classList.add('bg-slate-50', 'text-slate-500', 'cursor-not-allowed');
            phoneInput.title = 'Dùng mục "Đổi số điện thoại" bên dưới để thay đổi';
        }
    }

    // Render section đổi SĐT (async, không block)
    renderPhoneChangeSection(firebaseUser, userData);
};

// ─── Cập nhật thông tin ───────────────────────────────────────────────────────

const handleUpdateProfile = async (firebaseUser, userData) => {
    const displayName = (getElem('profileNameInput')?.value || '').trim();
    const phone = (getElem('profilePhoneInput')?.value || '').trim();
    const isVerified = userData?.isVerified === true;

    if (!displayName) {
        showToast('Tên không được để trống.', 'error');
        return;
    }

    try {
        const updateData = {
            displayName,
            updatedAt: serverTimestamp()
        };

        // Chỉ cho phép update phone nếu chưa xác minh
        if (!isVerified && phone) {
            updateData.phone = phone;
        }

        await updateDoc(doc(db, 'users', firebaseUser.uid), updateData);

        // Cập nhật cache
        const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
        localStorage.setItem(CACHE_KEY, JSON.stringify({ ...cached, displayName }));

        showToast('Đã cập nhật thông tin thành công!', 'success');
        getElem('profileName').textContent = displayName;
    } catch (err) {
        showToast(err.message || 'Không thể cập nhật thông tin.', 'error');
    }
};

// ─── Đổi mật khẩu ────────────────────────────────────────────────────────────

const handleChangePassword = async (firebaseUser) => {
    const currentPassword = (getElem('currentPassword')?.value || '').trim();
    const newPassword = (getElem('newPassword')?.value || '').trim();
    const confirmPassword = (getElem('confirmPassword')?.value || '').trim();

    if (!currentPassword || !newPassword || !confirmPassword) {
        showToast('Vui lòng nhập đầy đủ thông tin.', 'error');
        return;
    }
    if (newPassword.length < 6) {
        showToast('Mật khẩu mới phải có ít nhất 6 ký tự.', 'error');
        return;
    }
    if (newPassword !== confirmPassword) {
        showToast('Xác nhận mật khẩu chưa khớp.', 'error');
        return;
    }
    if (!firebaseUser.email) {
        showToast('Tài khoản Google không hỗ trợ đổi mật khẩu tại đây.', 'error');
        return;
    }

    try {
        const credential = EmailAuthProvider.credential(firebaseUser.email, currentPassword);
        await reauthenticateWithCredential(firebaseUser, credential);
        await updatePassword(firebaseUser, newPassword);

        // Reset form
        ['currentPassword', 'newPassword', 'confirmPassword'].forEach(id => {
            const el = getElem(id);
            if (el) el.value = '';
        });

        showToast('Đã đổi mật khẩu thành công!', 'success');
    } catch (err) {
        const msg = err.code === 'auth/wrong-password'
            ? 'Mật khẩu hiện tại không đúng.'
            : (err.message || 'Không thể đổi mật khẩu.');
        showToast(msg, 'error');
    }
};

// ─── Đổi số điện thoại ───────────────────────────────────────────────────────

const renderPhoneChangeSection = async (firebaseUser, userData) => {
    const section = getElem('changePhoneSection');
    if (!section) return;

    // Chỉ hiện khi đã xác minh
    if (!userData?.isVerified) {
        section.classList.add('hidden');
        return;
    }
    section.classList.remove('hidden');

    const cooldown = await getPhoneChangeCooldown(firebaseUser.uid);
    const cooldownInfo = getElem('phoneChangeCooldownInfo');
    const cooldownText = getElem('phoneChangeCooldownText');
    const submitBtn = getElem('changePhoneBtn');
    const form = getElem('changePhoneForm');

    if (!cooldown.canChange) {
        cooldownInfo?.classList.remove('hidden');
        if (cooldownText) {
            cooldownText.textContent = `Có thể đổi lại vào ngày ${cooldown.nextAllowedDate.toLocaleDateString('vi-VN')} (còn ${cooldown.daysLeft} ngày).`;
        }
        if (submitBtn) submitBtn.disabled = true;
        if (form) {
            getElem('newPhoneInput').disabled = true;
            getElem('confirmCccdInput').disabled = true;
        }
    } else {
        cooldownInfo?.classList.add('hidden');
        if (submitBtn) submitBtn.disabled = false;
        if (form) {
            getElem('newPhoneInput').disabled = false;
            getElem('confirmCccdInput').disabled = false;
        }
    }
};

const bindChangePhoneForm = (firebaseUser) => {
    const form = getElem('changePhoneForm');
    if (!form || form.dataset.bound === '1') return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const newPhone = (getElem('newPhoneInput')?.value || '').trim();
        const cccd = (getElem('confirmCccdInput')?.value || '').trim();

        if (!newPhone || !cccd) {
            showToast('Vui lòng nhập đầy đủ số điện thoại mới và CCCD.', 'error');
            return;
        }

        const btn = getElem('changePhoneBtn');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="ph ph-spinner animate-spin mr-1.5"></i> Đang xử lý...';
        }

        try {
            await changePhone(firebaseUser.uid, newPhone, cccd);

            // Cập nhật cache
            const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
            localStorage.setItem(CACHE_KEY, JSON.stringify({ ...cached, phone: newPhone }));

            showToast(`Đã đổi số điện thoại thành công! Lần đổi tiếp theo sau ${PHONE_CHANGE_COOLDOWN_DAYS} ngày.`, 'success');
            form.reset();

            // Re-render cooldown state
            await renderPhoneChangeSection(firebaseUser, { ...currentUserData, phone: newPhone, phoneChangedAt: new Date() });
        } catch (err) {
            showToast(err.message || 'Không thể đổi số điện thoại.', 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="ph ph-arrows-clockwise mr-1.5"></i> Đổi số điện thoại';
            }
        }
    });

    form.dataset.bound = '1';
};

// ─── Toggle hiện/ẩn mật khẩu ─────────────────────────────────────────────────

const bindPasswordToggles = () => {
    ['currentPassword', 'newPassword', 'confirmPassword'].forEach(fieldId => {
        const field = getElem(fieldId);
        const toggleBtn = getElem(`toggle_${fieldId}`);
        if (!field || !toggleBtn) return;
        toggleBtn.addEventListener('click', () => {
            const isPassword = field.type === 'password';
            field.type = isPassword ? 'text' : 'password';
            const icon = toggleBtn.querySelector('i');
            if (icon) {
                icon.classList.toggle('ph-eye', !isPassword);
                icon.classList.toggle('ph-eye-slash', isPassword);
            }
        });
    });
};

// ─── Khởi tạo ────────────────────────────────────────────────────────────────

const initProfilePage = () => {
    if (!getElem('profileAvatar')) return;

    bindPasswordToggles();

    if (unsubscribeProfileDoc) {
        unsubscribeProfileDoc();
        unsubscribeProfileDoc = null;
    }

    onAuthStateChanged(auth, async (firebaseUser) => {
        if (!firebaseUser) {
            currentUserData = null;
            if (unsubscribeProfileDoc) {
                unsubscribeProfileDoc();
                unsubscribeProfileDoc = null;
            }
            window.location.replace('login.html');
            return;
        }

        if (!getElem('profileEditForm')?.dataset.bound) {
            getElem('profileEditForm')?.addEventListener('submit', async (e) => {
                e.preventDefault();
                await handleUpdateProfile(firebaseUser, currentUserData);
            });
            if (getElem('profileEditForm')) {
                getElem('profileEditForm').dataset.bound = '1';
            }
        }

        if (!getElem('profilePasswordForm')?.dataset.bound) {
            getElem('profilePasswordForm')?.addEventListener('submit', async (e) => {
                e.preventDefault();
                await handleChangePassword(firebaseUser);
            });
            if (getElem('profilePasswordForm')) {
                getElem('profilePasswordForm').dataset.bound = '1';
            }
        }

        bindChangePhoneForm(firebaseUser);

        unsubscribeProfileDoc = onSnapshot(doc(db, 'users', firebaseUser.uid), async (userSnap) => {
            currentUserData = userSnap.exists() ? userSnap.data() : null;
            await renderProfile(firebaseUser, currentUserData);
        }, async () => {
            const userSnap = await getDoc(doc(db, 'users', firebaseUser.uid));
            currentUserData = userSnap.exists() ? userSnap.data() : null;
            await renderProfile(firebaseUser, currentUserData);
        });
    });
};

document.addEventListener('turbo:load', initProfilePage);
document.addEventListener('turbo:render', initProfilePage);
if (document.readyState !== 'loading') initProfilePage();
else document.addEventListener('DOMContentLoaded', initProfilePage);

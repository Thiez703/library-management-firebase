/**
 * profile.js — Trang hồ sơ cá nhân người dùng
 * Chức năng:
 *  - Hiển thị thông tin user từ Firestore
 *  - Cho phép cập nhật displayName, phone
 *  - Đổi mật khẩu (yêu cầu re-authenticate)
 */

import { auth, db } from './firebase-config.js';
import { doc, getDoc, updateDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js';
import {
    onAuthStateChanged,
    updatePassword,
    EmailAuthProvider,
    reauthenticateWithCredential
} from 'https://www.gstatic.com/firebasejs/10.0.0/firebase-auth.js';
import { showToast } from './notify.js';

const AVATAR_PLACEHOLDER = '../assets/images/avatar-placeholder.svg';
const CACHE_KEY = 'lib_user';

const getElem = (id) => document.getElementById(id);

// ─── Hiển thị thông tin ──────────────────────────────────────────────────────

const renderProfile = (firebaseUser, userData) => {
    if (!firebaseUser) {
        window.location.replace('login.html');
        return;
    }

    const displayName = userData?.displayName || firebaseUser.displayName || firebaseUser.email || 'Người dùng';
    const email = userData?.email || firebaseUser.email || '--';
    const phone = userData?.phone || userData?.phoneNumber || '';
    const photoURL = userData?.photoURL || firebaseUser.photoURL || AVATAR_PLACEHOLDER;
    const role = userData?.role === 'admin' ? 'Quản trị viên' : 'Độc giả';
    const status = (userData?.status || 'active') === 'active' ? 'Đang hoạt động' : 'Tạm khóa';
    const createdAt = userData?.createdAt?.toDate?.()?.toLocaleDateString('vi-VN') || '--';
    const memberCode = `US-${firebaseUser.uid.slice(0, 6).toUpperCase()}`;

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
    setText('profileMemberCode', memberCode);

    // Form chỉnh sửa — prefill
    const nameInput = getElem('profileNameInput');
    const phoneInput = getElem('profilePhoneInput');
    if (nameInput) nameInput.value = displayName;
    if (phoneInput) phoneInput.value = phone;
};

// ─── Cập nhật thông tin ───────────────────────────────────────────────────────

const handleUpdateProfile = async (firebaseUser) => {
    const displayName = (getElem('profileNameInput')?.value || '').trim();
    const phone = (getElem('profilePhoneInput')?.value || '').trim();

    if (!displayName) {
        showToast('Tên không được để trống.', 'error');
        return;
    }

    try {
        await updateDoc(doc(db, 'users', firebaseUser.uid), {
            displayName,
            phone,
            updatedAt: serverTimestamp()
        });

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

    onAuthStateChanged(auth, async (firebaseUser) => {
        if (!firebaseUser) {
            window.location.replace('login.html');
            return;
        }

        const userSnap = await getDoc(doc(db, 'users', firebaseUser.uid));
        const userData = userSnap.exists() ? userSnap.data() : null;
        renderProfile(firebaseUser, userData);

        // Bind form submit
        getElem('profileEditForm')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            await handleUpdateProfile(firebaseUser);
        });

        getElem('profilePasswordForm')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            await handleChangePassword(firebaseUser);
        });
    });
};

document.addEventListener('turbo:load', initProfilePage);
document.addEventListener('turbo:render', initProfilePage);
if (document.readyState !== 'loading') initProfilePage();
else document.addEventListener('DOMContentLoaded', initProfilePage);

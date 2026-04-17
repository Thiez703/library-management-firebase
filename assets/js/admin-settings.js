import { auth, db } from './firebase-config.js';
import { showToast } from './notify.js';
import {
    doc,
    getDoc,
    setDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";
import {
    EmailAuthProvider,
    reauthenticateWithCredential,
    updatePassword
} from "https://www.gstatic.com/firebasejs/10.0.0/firebase-auth.js";

const SETTINGS_REF = doc(db, 'system', 'settings');

const DEFAULT_SETTINGS = {
    general: {
        libraryName: 'Thư Viện Trung Tâm',
        address: '',
        phone: '',
        email: ''
    },
    ui: {
        darkMode: false,
        theme: 'blue'
    },
    library: {
        borrowDurationDays: 14,
        maxBooksPerTicket: 5,
        finePerDay: 5000,
        allowRenew: true
    },
    notifications: {
        borrowEmail: true,
        overdueAlert: true,
        newReader: false
    },
    security: {
        twoFactorEnabled: false
    }
};

const THEME_MAP = {
    blue: { primary: '#2563eb', hover: '#1d4ed8', ring: '#93c5fd' },
    purple: { primary: '#7c3aed', hover: '#6d28d9', ring: '#c4b5fd' },
    red: { primary: '#dc2626', hover: '#b91c1c', ring: '#fca5a5' },
    orange: { primary: '#ea580c', hover: '#c2410c', ring: '#fdba74' }
};

const state = {
    settings: structuredClone(DEFAULT_SETTINGS)
};

const getElem = (id) => document.getElementById(id);

const mergeSettings = (incoming = {}) => ({
    general: { ...DEFAULT_SETTINGS.general, ...(incoming.general || {}) },
    ui: { ...DEFAULT_SETTINGS.ui, ...(incoming.ui || {}) },
    library: { ...DEFAULT_SETTINGS.library, ...(incoming.library || {}) },
    notifications: { ...DEFAULT_SETTINGS.notifications, ...(incoming.notifications || {}) },
    security: { ...DEFAULT_SETTINGS.security, ...(incoming.security || {}) }
});

const setInputValue = (id, value) => {
    const el = getElem(id);
    if (!el) return;
    el.value = value ?? '';
};

const setChecked = (id, checked) => {
    const el = getElem(id);
    if (!el) return;
    el.checked = !!checked;
};

const getChecked = (id) => !!getElem(id)?.checked;
const getValue = (id) => (getElem(id)?.value || '').trim();

const getNumber = (id, fallback = 0) => {
    const raw = Number(getElem(id)?.value || fallback);
    if (!Number.isFinite(raw)) return fallback;
    return raw;
};

const applyTheme = (themeKey) => {
    const theme = THEME_MAP[themeKey] || THEME_MAP.blue;
    const activeButtons = document.querySelectorAll('.tab-btn.bg-primary-600, #generalSaveBtn, #librarySaveBtn, #notificationsSaveBtn, #securitySaveBtn');

    activeButtons.forEach((btn) => {
        btn.style.backgroundColor = theme.primary;
        btn.style.boxShadow = `0 4px 14px ${theme.ring}`;
    });

    document.querySelectorAll('.tab-btn').forEach((btn) => {
        if (!btn.classList.contains('bg-primary-600')) {
            btn.style.backgroundColor = '';
            btn.style.boxShadow = '';
        }
    });
};

const applyDarkMode = (enabled) => {
    const body = document.body;
    if (!body) return;

    body.classList.toggle('bg-slate-900', enabled);
    body.classList.toggle('text-slate-100', enabled);
    body.classList.toggle('bg-slate-50', !enabled);
    body.classList.toggle('text-slate-800', !enabled);

    document.querySelectorAll('.bg-white').forEach((el) => {
        el.classList.toggle('bg-slate-800', enabled);
        el.classList.toggle('border-slate-700', enabled);
    });

    document.querySelectorAll('.text-slate-800').forEach((el) => {
        el.classList.toggle('text-slate-100', enabled);
    });

    document.querySelectorAll('.text-slate-700,.text-slate-600,.text-slate-500').forEach((el) => {
        el.classList.toggle('text-slate-300', enabled);
    });
};

const fillFormFromSettings = () => {
    const s = state.settings;

    setInputValue('libraryNameInput', s.general.libraryName);
    setInputValue('libraryAddressInput', s.general.address);
    setInputValue('libraryPhoneInput', s.general.phone);
    setInputValue('libraryEmailInput', s.general.email);

    setChecked('darkModeToggle', s.ui.darkMode);
    setInputValue('themeColorSelect', s.ui.theme);

    setInputValue('borrowDurationInput', s.library.borrowDurationDays);
    setInputValue('maxBooksInput', s.library.maxBooksPerTicket);
    setInputValue('finePerDayInput', s.library.finePerDay);
    setChecked('allowRenewToggle', s.library.allowRenew);

    setChecked('notifyBorrowEmailToggle', s.notifications.borrowEmail);
    setChecked('notifyOverdueToggle', s.notifications.overdueAlert);
    setChecked('notifyNewReaderToggle', s.notifications.newReader);

    setChecked('twoFactorToggle', s.security.twoFactorEnabled);

    applyDarkMode(!!s.ui.darkMode);
    applyTheme(s.ui.theme);
};

const collectGeneralAndUi = () => ({
    general: {
        libraryName: getValue('libraryNameInput'),
        address: getValue('libraryAddressInput'),
        phone: getValue('libraryPhoneInput'),
        email: getValue('libraryEmailInput')
    },
    ui: {
        darkMode: getChecked('darkModeToggle'),
        theme: getValue('themeColorSelect') || 'blue'
    }
});

const collectLibrary = () => ({
    library: {
        borrowDurationDays: Math.max(1, getNumber('borrowDurationInput', 14)),
        maxBooksPerTicket: Math.max(1, getNumber('maxBooksInput', 5)),
        finePerDay: Math.max(0, getNumber('finePerDayInput', 5000)),
        allowRenew: getChecked('allowRenewToggle')
    }
});

const collectNotifications = () => ({
    notifications: {
        borrowEmail: getChecked('notifyBorrowEmailToggle'),
        overdueAlert: getChecked('notifyOverdueToggle'),
        newReader: getChecked('notifyNewReaderToggle')
    }
});

const collectSecurity = () => ({
    security: {
        twoFactorEnabled: getChecked('twoFactorToggle')
    }
});

const saveSettingsPatch = async (patch, successText) => {
    await setDoc(SETTINGS_REF, {
        ...patch,
        updatedAt: serverTimestamp()
    }, { merge: true });

    state.settings = mergeSettings({ ...state.settings, ...patch });
    fillFormFromSettings();
    showToast(successText, 'success');
};

const saveGeneral = async () => {
    const payload = collectGeneralAndUi();

    if (!payload.general.libraryName) {
        showToast('Tên thư viện không được để trống.', 'error');
        return;
    }
    if (payload.general.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.general.email)) {
        showToast('Email thư viện không hợp lệ.', 'error');
        return;
    }

    await saveSettingsPatch(payload, 'Đã lưu cài đặt chung.');
};

const saveLibrary = async () => {
    const payload = collectLibrary();
    await saveSettingsPatch(payload, 'Đã lưu cài đặt thư viện.');
};

const saveNotifications = async () => {
    const payload = collectNotifications();
    await saveSettingsPatch(payload, 'Đã lưu cài đặt thông báo.');
};

const saveSecurity = async () => {
    const currentPassword = getValue('currentPasswordInput');
    const newPassword = getValue('newPasswordInput');
    const confirmPassword = getValue('confirmPasswordInput');

    if (!newPassword && !confirmPassword) {
        const payload = collectSecurity();
        await saveSettingsPatch(payload, 'Đã lưu cài đặt bảo mật.');
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

    const user = auth.currentUser;
    if (!user || !user.email) {
        showToast('Không thể đổi mật khẩu cho tài khoản hiện tại.', 'error');
        return;
    }
    if (!currentPassword) {
        showToast('Vui lòng nhập mật khẩu hiện tại.', 'error');
        return;
    }

    const credential = EmailAuthProvider.credential(user.email, currentPassword);
    await reauthenticateWithCredential(user, credential);
    await updatePassword(user, newPassword);

    const payload = collectSecurity();
    await saveSettingsPatch(payload, 'Đã cập nhật bảo mật thành công.');

    setInputValue('currentPasswordInput', '');
    setInputValue('newPasswordInput', '');
    setInputValue('confirmPasswordInput', '');
};

const bindTabs = () => {
    document.querySelectorAll('.tab-btn').forEach((btn) => {
        btn.addEventListener('click', function () {
            const tabName = this.dataset.tab;

            document.querySelectorAll('.tab-content').forEach((tab) => {
                tab.style.display = 'none';
            });

            document.querySelectorAll('.tab-btn').forEach((item) => {
                item.classList.remove('bg-primary-600', 'text-white', 'shadow-md');
                item.classList.add('text-slate-600', 'hover:bg-slate-50');
            });

            getElem(`${tabName}-tab`)?.style.setProperty('display', 'block');
            this.classList.remove('text-slate-600', 'hover:bg-slate-50');
            this.classList.add('bg-primary-600', 'text-white', 'shadow-md');

            applyTheme(state.settings.ui.theme);
        });
    });
};

const bindActions = () => {
    getElem('generalSaveBtn')?.addEventListener('click', async () => {
        try {
            await saveGeneral();
        } catch (err) {
            showToast(err.message || 'Không thể lưu cài đặt chung.', 'error');
        }
    });

    getElem('librarySaveBtn')?.addEventListener('click', async () => {
        try {
            await saveLibrary();
        } catch (err) {
            showToast(err.message || 'Không thể lưu cài đặt thư viện.', 'error');
        }
    });

    getElem('notificationsSaveBtn')?.addEventListener('click', async () => {
        try {
            await saveNotifications();
        } catch (err) {
            showToast(err.message || 'Không thể lưu cài đặt thông báo.', 'error');
        }
    });

    getElem('securitySaveBtn')?.addEventListener('click', async () => {
        try {
            await saveSecurity();
        } catch (err) {
            showToast(err.message || 'Không thể cập nhật bảo mật.', 'error');
        }
    });

    getElem('generalResetBtn')?.addEventListener('click', fillFormFromSettings);
    getElem('libraryResetBtn')?.addEventListener('click', fillFormFromSettings);
    getElem('notificationsResetBtn')?.addEventListener('click', fillFormFromSettings);
    getElem('securityResetBtn')?.addEventListener('click', () => {
        fillFormFromSettings();
        setInputValue('currentPasswordInput', '');
        setInputValue('newPasswordInput', '');
        setInputValue('confirmPasswordInput', '');
    });

    getElem('darkModeToggle')?.addEventListener('change', (e) => {
        applyDarkMode(!!e.target.checked);
    });

    getElem('themeColorSelect')?.addEventListener('change', (e) => {
        applyTheme(e.target.value);
    });
};

const loadSettings = async () => {
    const snap = await getDoc(SETTINGS_REF);
    if (snap.exists()) {
        state.settings = mergeSettings(snap.data() || {});
    } else {
        state.settings = structuredClone(DEFAULT_SETTINGS);
        await setDoc(SETTINGS_REF, {
            ...state.settings,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        }, { merge: true });
    }

    fillFormFromSettings();
};

const initSettingsPage = async () => {
    const root = getElem('settingsPageRoot');
    if (!root) return;
    if (root.dataset.settingsBound === '1') return;

    root.dataset.settingsBound = '1';
    bindTabs();
    bindActions();

    try {
        await loadSettings();
    } catch (err) {
        showToast('Không thể tải cài đặt hệ thống.', 'error');
        console.error('settings load error:', err);
    }
};

document.addEventListener('turbo:load', initSettingsPage);
document.addEventListener('turbo:render', initSettingsPage);
if (document.readyState !== 'loading') initSettingsPage();
else document.addEventListener('DOMContentLoaded', initSettingsPage);

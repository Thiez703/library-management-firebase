const CONTAINER_ID = 'app-notify-container';

const ICONS = {
    success: 'ph-check-circle',
    error: 'ph-warning-circle',
    warning: 'ph-warning',
    info: 'ph-info'
};

const THEME = {
    success: {
        iconBg: 'bg-emerald-100 text-emerald-700',
        bar: 'bg-emerald-500'
    },
    error: {
        iconBg: 'bg-rose-100 text-rose-700',
        bar: 'bg-rose-500'
    },
    warning: {
        iconBg: 'bg-amber-100 text-amber-700',
        bar: 'bg-amber-500'
    },
    info: {
        iconBg: 'bg-sky-100 text-sky-700',
        bar: 'bg-sky-500'
    }
};

const ensureContainer = () => {
    let container = document.getElementById(CONTAINER_ID);
    if (container) return container;

    container = document.createElement('div');
    container.id = CONTAINER_ID;
    container.className = 'fixed top-4 right-4 z-[99999] w-[min(92vw,380px)] flex flex-col gap-3 pointer-events-none';
    document.body.appendChild(container);

    return container;
};

const escapeHtml = (value = '') => value
    .toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const animateOutAndRemove = (node) => {
    if (!node || !node.parentNode) return;
    node.classList.remove('opacity-100', 'translate-y-0', 'scale-100');
    node.classList.add('opacity-0', '-translate-y-1', 'scale-[0.98]');
    setTimeout(() => node.remove(), 220);
};

export const showToast = (message, type = 'success', options = {}) => {
    const container = ensureContainer();
    const tone = THEME[type] ? type : 'info';
    const icon = ICONS[tone] || ICONS.info;
    const theme = THEME[tone];

    const duration = Number.isFinite(options.duration)
        ? options.duration
        : (tone === 'info' ? 0 : 3200);

    const toast = document.createElement('section');
    toast.className = 'pointer-events-auto rounded-2xl border border-slate-200/80 bg-white/95 backdrop-blur-xl shadow-[0_14px_34px_rgba(15,23,42,0.14)] px-4 py-3 transition-all duration-200 opacity-0 -translate-y-1 scale-[0.98]';
    toast.innerHTML = `
        <div class="flex items-start gap-3">
            <div class="w-8 h-8 rounded-lg flex items-center justify-center ${theme.iconBg}">
                <i class="ph-fill ${icon} text-[18px]"></i>
            </div>
            <div class="min-w-0 flex-1">
                <p class="text-sm font-semibold text-slate-800 leading-5 notify-message">${escapeHtml(message)}</p>
            </div>
            <button type="button" class="notify-close w-7 h-7 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors" aria-label="Đóng thông báo">
                <i class="ph ph-x"></i>
            </button>
        </div>
        <div class="mt-3 h-1 rounded-full bg-slate-100 overflow-hidden">
            <div class="notify-progress h-full ${theme.bar}" style="width: 100%;"></div>
        </div>
    `;

    container.prepend(toast);
    requestAnimationFrame(() => {
        toast.classList.remove('opacity-0', '-translate-y-1', 'scale-[0.98]');
        toast.classList.add('opacity-100', 'translate-y-0', 'scale-100');
    });

    const closeBtn = toast.querySelector('.notify-close');
    const msgEl = toast.querySelector('.notify-message');
    const progressEl = toast.querySelector('.notify-progress');

    let closed = false;
    let timer = null;

    const close = () => {
        if (closed) return;
        closed = true;
        if (timer) clearTimeout(timer);
        animateOutAndRemove(toast);
    };

    const update = (nextMessage) => {
        if (!msgEl) return;
        msgEl.textContent = nextMessage || '';
    };

    closeBtn?.addEventListener('click', close);

    if (duration > 0) {
        if (progressEl) {
            progressEl.style.transition = `width ${duration}ms linear`;
            requestAnimationFrame(() => {
                progressEl.style.width = '0%';
            });
        }
        timer = setTimeout(close, duration);
    } else if (progressEl) {
        progressEl.style.width = '100%';
    }

    return { close, update };
};

export const showConfirm = (message, options = {}) => new Promise((resolve) => {
    const container = ensureContainer();
    const title = options.title || 'Xác nhận thao tác';
    const confirmText = options.confirmText || 'Xác nhận';
    const cancelText = options.cancelText || 'Hủy';
    const tone = options.type === 'error' ? 'error' : (options.type === 'warning' ? 'warning' : 'info');
    const theme = THEME[tone];
    const icon = ICONS[tone];

    const card = document.createElement('section');
    card.className = 'pointer-events-auto rounded-2xl border border-slate-200/80 bg-white/95 backdrop-blur-xl shadow-[0_16px_38px_rgba(15,23,42,0.18)] p-4 transition-all duration-200 opacity-0 -translate-y-1 scale-[0.98]';
    card.innerHTML = `
        <div class="flex items-start gap-3">
            <div class="w-8 h-8 rounded-lg flex items-center justify-center ${theme.iconBg}">
                <i class="ph-fill ${icon} text-[18px]"></i>
            </div>
            <div class="min-w-0 flex-1">
                <p class="text-sm font-bold text-slate-900">${escapeHtml(title)}</p>
                <p class="text-sm text-slate-600 mt-1 leading-5">${escapeHtml(message)}</p>
            </div>
        </div>
        <div class="mt-4 flex items-center justify-end gap-2">
            <button type="button" class="notify-cancel px-3.5 py-2 rounded-lg bg-slate-100 text-slate-700 font-semibold text-sm hover:bg-slate-200 transition-colors">${escapeHtml(cancelText)}</button>
            <button type="button" class="notify-confirm px-3.5 py-2 rounded-lg bg-slate-900 text-white font-semibold text-sm hover:bg-slate-800 transition-colors">${escapeHtml(confirmText)}</button>
        </div>
    `;

    container.prepend(card);
    requestAnimationFrame(() => {
        card.classList.remove('opacity-0', '-translate-y-1', 'scale-[0.98]');
        card.classList.add('opacity-100', 'translate-y-0', 'scale-100');
    });

    const done = (result) => {
        animateOutAndRemove(card);
        resolve(result);
    };

    card.querySelector('.notify-confirm')?.addEventListener('click', () => done(true));
    card.querySelector('.notify-cancel')?.addEventListener('click', () => done(false));
});

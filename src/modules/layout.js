// Split pane, view modes, rail collapse, and the narrow-screen fallback.

import { read, write, KEYS } from './storage.js';
import { t } from './strings.js';

const MIN_RATIO = 0.15;
const MAX_RATIO = 0.85;
const DEFAULT_RATIO = 0.5;
const MOBILE_BREAKPOINT = 820;

const clamp = (ratio) => Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio));

export const isMobile = () => window.innerWidth <= MOBILE_BREAKPOINT;

export const setupSplit = ({ container, divider, onResize }) => {
    // The panes used to be sized in pixels, which meant a resize handler had to
    // recompute both widths from a remembered ratio — and the double-click
    // reset never updated that ratio, so the next resize snapped them back.
    // Driving the split from one custom property makes resize pure layout.
    const applyRatio = (ratio) => {
        container.style.setProperty('--split-ratio', String(ratio));
        onResize?.();
    };

    let ratio = clamp(Number(read(KEYS.splitRatio, DEFAULT_RATIO)) || DEFAULT_RATIO);
    applyRatio(ratio);

    divider.setAttribute('aria-label', t.dividerLabel);

    let dragging = false;

    const ratioFromEvent = (event) => {
        const bounds = container.getBoundingClientRect();
        const railWidth = container.querySelector('.rail')?.getBoundingClientRect().width ?? 0;
        const usable = bounds.width - railWidth;
        if (usable <= 0) {
            return ratio;
        }
        return clamp((event.clientX - bounds.left - railWidth) / usable);
    };

    // Pointer events cover mouse, touch and pen in one path — the old
    // mouse-only handlers made the divider undraggable on touch devices.
    divider.addEventListener('pointerdown', (event) => {
        dragging = true;
        divider.setPointerCapture(event.pointerId);
        divider.classList.add('active');
        document.body.classList.add('is-resizing');
        event.preventDefault();
    });

    divider.addEventListener('pointermove', (event) => {
        if (!dragging) return;
        ratio = ratioFromEvent(event);
        applyRatio(ratio);
    });

    const endDrag = (event) => {
        if (!dragging) return;
        dragging = false;
        divider.releasePointerCapture?.(event.pointerId);
        divider.classList.remove('active');
        document.body.classList.remove('is-resizing');
        write(KEYS.splitRatio, ratio);
    };

    divider.addEventListener('pointerup', endDrag);
    divider.addEventListener('pointercancel', endDrag);

    divider.addEventListener('dblclick', () => {
        ratio = DEFAULT_RATIO;
        applyRatio(ratio);
        write(KEYS.splitRatio, ratio);
    });

    divider.addEventListener('keydown', (event) => {
        const step = event.shiftKey ? 0.1 : 0.02;
        if (event.key === 'ArrowLeft') {
            ratio = clamp(ratio - step);
        } else if (event.key === 'ArrowRight') {
            ratio = clamp(ratio + step);
        } else if (event.key === 'Home') {
            ratio = DEFAULT_RATIO;
        } else {
            return;
        }
        event.preventDefault();
        applyRatio(ratio);
        write(KEYS.splitRatio, ratio);
    });

    window.addEventListener('resize', () => onResize?.());
};

export const setupModes = ({ container, group, onChange }) => {
    const buttons = Array.from(group.querySelectorAll('button[data-mode]'));
    group.setAttribute('aria-label', t.modeGroupLabel);

    const activate = (mode, { persist = true } = {}) => {
        container.dataset.mode = mode;
        buttons.forEach((button) => {
            button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
        });
        if (persist) {
            write(KEYS.viewMode, mode);
        }
        onChange?.(mode);
    };

    buttons.forEach((button) => {
        button.addEventListener('click', () => activate(button.dataset.mode));
    });

    const stored = read(KEYS.viewMode, 'split');
    activate(['edit', 'split', 'read'].includes(stored) ? stored : 'split', { persist: false });

    return { activate, current: () => container.dataset.mode };
};

export const setupRail = ({ container, toggle, onChange }) => {
    const apply = (open, { persist = true } = {}) => {
        container.dataset.rail = open ? 'open' : 'collapsed';
        toggle.setAttribute('aria-pressed', String(open));
        if (persist) {
            write(KEYS.railOpen, open);
        }
        onChange?.(open);
    };

    toggle.addEventListener('click', () => {
        apply(container.dataset.rail !== 'open');
    });

    // On a phone the rail overlays the panes, so opening it by default would
    // bury the document. The stored preference belongs to the desktop layout.
    apply(!isMobile() && read(KEYS.railOpen, true) !== false, { persist: false });
};

// On a phone the panes become tabs; the rail overlays rather than taking width.
export const setupMobileTabs = ({ container, tabs, onChange }) => {
    const activate = (view) => {
        container.dataset.mobileView = view;
        tabs.forEach((tab) => {
            const selected = tab.dataset.view === view;
            tab.classList.toggle('active', selected);
            tab.setAttribute('aria-selected', String(selected));
        });
        onChange?.(view);
    };

    tabs.forEach((tab) => {
        tab.addEventListener('click', (event) => {
            event.preventDefault();
            activate(tab.dataset.view);
        });
    });

    activate('edit');
    return { activate };
};

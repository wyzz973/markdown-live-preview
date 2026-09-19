// Popup menus — the tab strip's "+" and every tab's context menu — and the
// arrow-key handling shared with the menus that live in the page.
//
// The menus in this app are role="menu", which promises arrow keys. They used
// to support only Tab and Escape.

const itemsOf = (menu) =>
    Array.from(menu.querySelectorAll('[role="menuitem"]')).filter(
        (item) => !item.hidden && !item.disabled && item.offsetParent !== null
    );

// Up/Down/Home/End move focus between the items of `menu`.
export const arrowKeys = (menu) => {
    menu.addEventListener('keydown', (event) => {
        const items = itemsOf(menu);
        if (items.length === 0) return;
        const at = items.indexOf(document.activeElement);
        let next = null;
        if (event.key === 'ArrowDown') next = items[(at + 1) % items.length];
        else if (event.key === 'ArrowUp') next = items[(at - 1 + items.length) % items.length];
        else if (event.key === 'Home') next = items[0];
        else if (event.key === 'End') next = items.at(-1);
        if (next) {
            event.preventDefault();
            next.focus();
        }
    });
};

export const focusFirst = (menu) => itemsOf(menu)[0]?.focus();

let current = null;

export const closeMenu = () => {
    if (!current) return;
    const { element, onClose, restoreFocus } = current;
    current = null;
    element.remove();
    document.removeEventListener('pointerdown', outside, true);
    window.removeEventListener('blur', closeMenu);
    window.removeEventListener('resize', closeMenu);
    onClose?.();
    restoreFocus?.focus?.();
};

const outside = (event) => {
    if (current && !current.element.contains(event.target)) closeMenu();
};

// items: { label, kbd?, run, disabled? } | { rule: true } | { heading }
// Placed below `anchor`, or at the point (x, y) for a context menu, and kept
// inside the window.
export const openMenu = ({ items, anchor = null, x = 0, y = 0, label = '', onClose = null }) => {
    closeMenu();

    const element = document.createElement('div');
    element.className = 'popup-menu';
    element.setAttribute('role', 'menu');
    if (label) element.setAttribute('aria-label', label);

    items.forEach((item) => {
        if (!item) return;
        if (item.rule) {
            const rule = document.createElement('div');
            rule.className = 'menu-rule';
            element.appendChild(rule);
            return;
        }
        if (item.heading) {
            const heading = document.createElement('span');
            heading.className = 'menu-label';
            heading.textContent = item.heading;
            element.appendChild(heading);
            return;
        }
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'menu-item';
        button.setAttribute('role', 'menuitem');
        button.disabled = Boolean(item.disabled);
        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = item.label;
        button.appendChild(name);
        if (item.kbd) {
            const kbd = document.createElement('kbd');
            kbd.textContent = item.kbd;
            button.appendChild(kbd);
        }
        button.addEventListener('click', () => {
            closeMenu();
            item.run();
        });
        element.appendChild(button);
    });

    element.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' || event.key === 'Tab') {
            event.preventDefault();
            closeMenu();
        }
    });
    arrowKeys(element);

    document.body.appendChild(element);

    const box = element.getBoundingClientRect();
    let left = x;
    let top = y;
    if (anchor) {
        const from = anchor.getBoundingClientRect();
        left = from.left;
        top = from.bottom + 4;
        if (left + box.width > window.innerWidth - 8) left = from.right - box.width;
    }
    left = Math.max(8, Math.min(left, window.innerWidth - box.width - 8));
    if (top + box.height > window.innerHeight - 8) top = Math.max(8, (anchor ? anchor.getBoundingClientRect().top - 4 : y) - box.height);
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;

    current = { element, onClose, restoreFocus: anchor ?? document.activeElement };
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('blur', closeMenu);
    window.addEventListener('resize', closeMenu);
    focusFirst(element);
    return element;
};

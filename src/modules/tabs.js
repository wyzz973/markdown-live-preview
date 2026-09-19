// The tab strip: one tab per open document.
//
// It only draws and reports. What a tab *is* — its text, its save state, its
// place in the order — lives in documents.js, and what activating or closing
// one sets in motion lives in main.js.
//
// The vocabulary is the app's own: a tab wears its file name, extension and
// all, so a file never needs an icon to say what it is; a scratch document
// wears its title, which is how the two are told apart. The active tab takes
// the wash, the same mark the rail puts on the same file. Unsaved work is the
// red dot the header used to carry; a temporary tab is set in italics.

import { t } from './strings.js';

const DRAG_THRESHOLD = 4;

export const setup = ({ strip, list, addButton, store, labelOf, hintOf, actions }) => {
    const elements = new Map();
    let drag = null;

    list.setAttribute('role', 'tablist');
    list.setAttribute('aria-label', t.tabsLabel);

    // ----- building -----

    const build = (doc) => {
        const tab = document.createElement('div');
        tab.className = 'tab';
        tab.setAttribute('role', 'tab');
        tab.dataset.id = doc.id;

        const label = document.createElement('span');
        label.className = 'tab-label';
        const name = document.createElement('span');
        name.className = 'tab-name';
        const dir = document.createElement('span');
        dir.className = 'tab-dir';
        label.append(name, dir);

        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'tab-close';
        close.tabIndex = -1;
        close.textContent = '×';
        close.addEventListener('pointerdown', (event) => event.stopPropagation());
        close.addEventListener('click', (event) => {
            event.stopPropagation();
            actions.close(doc.id);
        });

        tab.append(label, close);
        return tab;
    };

    const paint = (tab, doc, active) => {
        const { name, dir } = labelOf(doc);
        tab.querySelector('.tab-name').textContent = name;
        const dirElement = tab.querySelector('.tab-dir');
        dirElement.textContent = dir ?? '';
        dirElement.hidden = !dir;

        const dirty = store.isDirty(doc);
        tab.classList.toggle('is-active', active);
        // A tab still waiting for access can hold last session's unwritten
        // text (a hot-exit backup); that is unsaved work too.
        tab.classList.toggle('is-dirty', (dirty && doc.state === 'ready') || Boolean(doc.hasBackup));
        tab.classList.toggle('is-preview', doc.preview);
        tab.classList.toggle('is-scratch', doc.kind === 'scratch');
        tab.classList.toggle('is-locked', doc.state === 'locked');
        tab.classList.toggle('is-missing', doc.state === 'missing');
        tab.classList.toggle('is-conflict', Boolean(doc.conflict));
        tab.setAttribute('aria-selected', String(active));
        tab.tabIndex = active ? 0 : -1;
        tab.title = hintOf(doc);
        tab.querySelector('.tab-close').setAttribute('aria-label', t.closeTabNamed(name));
    };

    const render = () => {
        const docs = store.list();
        const activeId = store.activeId();
        const alive = new Set(docs.map((doc) => doc.id));

        elements.forEach((tab, id) => {
            if (!alive.has(id)) {
                tab.remove();
                elements.delete(id);
            }
        });

        let cursor = list.firstChild;
        docs.forEach((doc) => {
            let tab = elements.get(doc.id);
            if (!tab) {
                tab = build(doc);
                elements.set(doc.id, tab);
            }
            paint(tab, doc, doc.id === activeId);
            if (tab === cursor) {
                cursor = cursor.nextSibling;
            } else {
                list.insertBefore(tab, cursor);
            }
        });

        strip.dataset.count = String(docs.length);
    };

    const revealActive = () => {
        const tab = elements.get(store.activeId());
        tab?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    };

    // A narrower window can push the active tab out of the strip.
    new ResizeObserver(() => revealActive()).observe(list);

    // ----- pointer: activate, reorder, close, pin -----

    const tabOf = (target) => target.closest('.tab');

    // Where a dragged tab would land, from the pointer's x against the
    // midpoints of the others.
    const dropIndex = (clientX, dragged) => {
        const others = Array.from(list.children).filter((tab) => tab !== dragged);
        let index = others.length;
        for (let i = 0; i < others.length; i += 1) {
            const box = others[i].getBoundingClientRect();
            if (clientX < box.left + box.width / 2) {
                index = i;
                break;
            }
        }
        return { index, others };
    };

    const marker = document.createElement('div');
    marker.className = 'tab-drop';
    marker.hidden = true;
    strip.appendChild(marker);

    const placeMarker = ({ index, others }) => {
        const stripBox = strip.getBoundingClientRect();
        const reference = others[index] ?? others.at(-1);
        if (!reference) {
            marker.hidden = true;
            return;
        }
        const box = reference.getBoundingClientRect();
        const x = others[index] ? box.left : box.right;
        marker.style.left = `${x - stripBox.left - 1}px`;
        marker.hidden = false;
    };

    list.addEventListener('pointerdown', (event) => {
        const tab = tabOf(event.target);
        if (!tab || event.button !== 0) return;
        // Activate on press, not on release: the tab responds at once, and a
        // drag starts from the tab that is already in front.
        actions.activate(tab.dataset.id);
        drag = { tab, id: tab.dataset.id, x: event.clientX, moved: false, pointer: event.pointerId };
    });

    list.addEventListener('pointermove', (event) => {
        if (!drag || event.pointerId !== drag.pointer) return;
        if (!drag.moved) {
            if (Math.abs(event.clientX - drag.x) < DRAG_THRESHOLD) return;
            drag.moved = true;
            list.setPointerCapture(event.pointerId);
            drag.tab.classList.add('is-dragging');
            document.body.classList.add('is-dragging-tab');
        }
        placeMarker(dropIndex(event.clientX, drag.tab));
    });

    const endDrag = (event, commit) => {
        if (!drag || event.pointerId !== drag.pointer) return;
        const finished = drag;
        drag = null;
        marker.hidden = true;
        finished.tab.classList.remove('is-dragging');
        document.body.classList.remove('is-dragging-tab');
        if (list.hasPointerCapture?.(event.pointerId)) list.releasePointerCapture(event.pointerId);
        if (finished.moved && commit) {
            actions.reorder(finished.id, dropIndex(event.clientX, finished.tab).index);
        } else if (commit) {
            // A click on a tab means "work in this document": hand the focus
            // to the editor, as editors do, instead of leaving it on the tab.
            actions.focusEditor();
        }
    };

    list.addEventListener('pointerup', (event) => endDrag(event, true));
    list.addEventListener('pointercancel', (event) => endDrag(event, false));

    // Middle click closes, as in every browser.
    list.addEventListener('auxclick', (event) => {
        const tab = tabOf(event.target);
        if (tab && event.button === 1) {
            event.preventDefault();
            actions.close(tab.dataset.id);
        }
    });
    list.addEventListener('mousedown', (event) => {
        // Stop the middle button from starting autoscroll.
        if (event.button === 1) event.preventDefault();
    });

    list.addEventListener('dblclick', (event) => {
        const tab = tabOf(event.target);
        if (tab) actions.pin(tab.dataset.id);
    });

    list.addEventListener('contextmenu', (event) => {
        const tab = tabOf(event.target);
        if (!tab) return;
        event.preventDefault();
        actions.menu(tab.dataset.id, { x: event.clientX, y: event.clientY });
    });

    // A vertical wheel scrolls an overflowing strip sideways.
    list.addEventListener(
        'wheel',
        (event) => {
            if (Math.abs(event.deltaY) > Math.abs(event.deltaX) && list.scrollWidth > list.clientWidth) {
                list.scrollLeft += event.deltaY;
                event.preventDefault();
            }
        },
        { passive: false }
    );

    // ----- keyboard: a tablist -----

    list.addEventListener('keydown', (event) => {
        const tab = tabOf(event.target);
        if (!tab) return;
        const tabs = Array.from(list.children);
        const at = tabs.indexOf(tab);
        let next = null;
        if (event.key === 'ArrowRight') next = tabs[(at + 1) % tabs.length];
        else if (event.key === 'ArrowLeft') next = tabs[(at - 1 + tabs.length) % tabs.length];
        else if (event.key === 'Home') next = tabs[0];
        else if (event.key === 'End') next = tabs.at(-1);
        else if (event.key === 'Delete' || event.key === 'Backspace') {
            event.preventDefault();
            actions.close(tab.dataset.id);
            return;
        } else if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
            event.preventDefault();
            const box = tab.getBoundingClientRect();
            actions.menu(tab.dataset.id, { x: box.left, y: box.bottom });
            return;
        } else if (event.key === 'Enter') {
            event.preventDefault();
            actions.focusEditor();
            return;
        }
        if (next) {
            event.preventDefault();
            actions.activate(next.dataset.id);
            next.focus();
        }
    });

    addButton.addEventListener('click', () => actions.add(addButton));

    return { render, revealActive, focusActive: () => elements.get(store.activeId())?.focus() };
};

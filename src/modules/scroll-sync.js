// Two-way scroll linking between the editor and the preview.

import { read, write, KEYS } from './storage.js';

export const setup = ({ editor, preview, checkbox }) => {
    let enabled = read(KEYS.scrollSync, false) === true;

    // Programmatic scrolling fires the other pane's scroll event, which would
    // scroll the first pane back and produce a feedback loop. A short lock
    // marks "this scroll came from us, ignore it".
    let lock = null;
    const withLock = (owner, apply) => {
        if (lock !== null && lock !== owner) {
            return;
        }
        lock = owner;
        apply();
        clearTimeout(withLock.timer);
        withLock.timer = setTimeout(() => {
            lock = null;
        }, 80);
    };

    // Guards against the divide-by-zero the old code hit whenever the content
    // was shorter than its pane: maxScroll of 0 produced NaN, which was then
    // handed straight to scrollTo().
    const ratioOf = (scrollTop, scrollHeight, clientHeight) => {
        const maxScroll = scrollHeight - clientHeight;
        return maxScroll > 0 ? scrollTop / maxScroll : 0;
    };

    editor.onDidScrollChange((event) => {
        if (!enabled) {
            return;
        }

        const ratio = ratioOf(
            event.scrollTop,
            event.scrollHeight,
            editor.getLayoutInfo().height
        );

        withLock('editor', () => {
            preview.scrollTop = (preview.scrollHeight - preview.clientHeight) * ratio;
        });
    });

    preview.addEventListener('scroll', () => {
        if (!enabled) {
            return;
        }

        const ratio = ratioOf(preview.scrollTop, preview.scrollHeight, preview.clientHeight);
        const maxEditorScroll = editor.getScrollHeight() - editor.getLayoutInfo().height;

        withLock('preview', () => {
            editor.setScrollTop(Math.max(0, maxEditorScroll) * ratio);
        });
    });

    checkbox.checked = enabled;
    checkbox.addEventListener('change', (event) => {
        enabled = event.currentTarget.checked;
        write(KEYS.scrollSync, enabled);
    });
};

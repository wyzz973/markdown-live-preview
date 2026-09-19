// Two-way scroll linking between the editor and the preview, by source line.
//
// The old version matched scroll ratios: 40% down the editor meant 40% down
// the preview. That only holds while the two are proportional, and a single
// diagram or image breaks it — the panes drifted further apart the further
// you read. Now the preview's blocks carry the line they start on (see
// markdown.js), so the line at the top of the editor is the line at the top
// of the preview.

import { read, write, KEYS } from './storage.js';

export const setup = ({ editor, scroller, checkbox, preview, isActive }) => {
    let enabled = read(KEYS.scrollSync, false) === true;

    // Programmatic scrolling fires the other pane's scroll event, which would
    // scroll the first pane back and produce a feedback loop. A short lock
    // marks "this scroll came from us, ignore it".
    let lock = null;
    let lockTimer = null;
    const withLock = (owner, apply) => {
        if (lock !== null && lock !== owner) return;
        lock = owner;
        apply();
        clearTimeout(lockTimer);
        lockTimer = setTimeout(() => {
            lock = null;
        }, 80);
    };

    // The first visible editor line, plus how far into it the view has
    // scrolled (wrapped lines make one source line several screen lines tall).
    const editorLine = () => {
        const top = editor.getScrollTop();
        const line = editor.getVisibleRanges()[0]?.startLineNumber ?? 1;
        const lineTop = editor.getTopForLineNumber(line);
        const span = editor.getTopForLineNumber(line + 1) - lineTop;
        return line + (span > 0 ? Math.max(0, Math.min(1, (top - lineTop) / span)) : 0);
    };

    const editorTopForLine = (line) => {
        const whole = Math.max(1, Math.floor(line));
        const top = editor.getTopForLineNumber(whole);
        return top + (line - whole) * (editor.getTopForLineNumber(whole + 1) - top);
    };

    editor.onDidScrollChange((event) => {
        if (!enabled || !event.scrollTopChanged || !isActive()) return;
        withLock('editor', () => {
            const end = editor.getScrollHeight() - editor.getLayoutInfo().height;
            // Both panes pinned to their ends, whatever the last block's height.
            scroller.scrollTop =
                event.scrollTop >= end - 1 ? scroller.scrollHeight : preview.topForLine(editorLine());
        });
    });

    scroller.addEventListener(
        'scroll',
        () => {
            if (!enabled || !isActive()) return;
            withLock('preview', () => {
                const end = scroller.scrollHeight - scroller.clientHeight;
                editor.setScrollTop(
                    scroller.scrollTop >= end - 1
                        ? editor.getScrollHeight()
                        : editorTopForLine(preview.lineAtTop(scroller.scrollTop))
                );
            });
        },
        { passive: true }
    );

    checkbox.checked = enabled;
    checkbox.addEventListener('change', (event) => {
        enabled = event.currentTarget.checked;
        write(KEYS.scrollSync, enabled);
    });

    return { enabled: () => enabled };
};

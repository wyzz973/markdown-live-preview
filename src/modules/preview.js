// The Markdown preview pane.
//
// Rendering is scheduled against typing and patched into the DOM block by
// block. The preview used to replace its whole innerHTML on every keystroke,
// which threw away every Mermaid drawing (they fell back to source text and
// were redrawn), reloaded every image, snapped every open <details> shut and
// nudged the scroll position. Now a block whose HTML did not change keeps its
// DOM node, so typing in one paragraph touches one paragraph.
//
// It also carries what a rendered note needs from the folder it came from:
// images referenced by relative path, and links to other notes, which used to
// navigate the whole app away and lose everything that was open.

import * as renderer from './renderer.js';
import * as mermaid from './mermaid.js';
import { t } from './strings.js';

// A render slower than this is not repeated on every frame while typing.
const SLOW_RENDER_MS = 24;
const LINE_ATTRIBUTE = / data-line="\d+"/;
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

export const create = ({ scroller, output, theme, resolveImage, onLink, onReveal, onRendered }) => {
    const wrapper = output.parentElement;
    // Which HTML each top-level node was created from — minus its data-line,
    // so a block that merely moved down a line still counts as unchanged.
    const keys = new WeakMap();

    let latest = null;
    let frame = null;
    let timer = null;
    let lastCost = 0;
    let blocks = null;

    // ----- patching -----

    const keyOf = (node) =>
        node.nodeType === Node.ELEMENT_NODE
            ? node.outerHTML.replace(LINE_ATTRIBUTE, '')
            : `#${node.nodeType}:${node.textContent}`;

    const patch = (html) => {
        const template = document.createElement('template');
        template.innerHTML = html;

        const pool = new Map();
        for (const node of output.childNodes) {
            const key = keys.get(node);
            if (key === undefined) continue;
            const bucket = pool.get(key);
            if (bucket) bucket.push(node);
            else pool.set(key, [node]);
        }

        const next = Array.from(template.content.childNodes, (node) => {
            const key = keyOf(node);
            const reused = pool.get(key)?.shift();
            if (!reused) {
                keys.set(node, key);
                return node;
            }
            if (reused.nodeType === Node.ELEMENT_NODE) {
                const line = node.getAttribute('data-line');
                if (line === null) reused.removeAttribute('data-line');
                else if (reused.getAttribute('data-line') !== line) reused.setAttribute('data-line', line);
            }
            return reused;
        });

        // Walk the existing children once: nodes already in place are passed
        // over, everything else is moved or inserted before the cursor, and
        // whatever is left behind the cursor at the end was not reused.
        let cursor = output.firstChild;
        for (const node of next) {
            if (node === cursor) {
                cursor = cursor.nextSibling;
            } else {
                output.insertBefore(node, cursor);
            }
        }
        while (cursor) {
            const following = cursor.nextSibling;
            cursor.remove();
            cursor = following;
        }
    };

    // ----- images -----

    const loadImages = () => {
        output.querySelectorAll('img[data-local-src]:not([src])').forEach(async (image) => {
            const path = image.dataset.localSrc;
            let url = null;
            try {
                url = await resolveImage?.(path);
            } catch (error) {
                url = null;
            }
            if (!image.isConnected || image.hasAttribute('src')) return;
            // Nothing to resolve against (a single file, a scratch document):
            // let the browser show its usual broken image with the alt text.
            image.src = url ?? path;
        });
    };

    // ----- rendering -----

    const renderNow = ({ text, local }) => {
        const started = performance.now();
        patch(renderer.render(text, { localImages: local }));
        lastCost = performance.now() - started;
        blocks = null;
        loadImages();
        mermaid.render(output, theme());
        onRendered?.();
    };

    const cancel = () => {
        if (frame !== null) cancelAnimationFrame(frame);
        if (timer !== null) clearTimeout(timer);
        frame = null;
        timer = null;
    };

    const flush = () => {
        cancel();
        if (latest) renderNow(latest);
    };

    // While typing: at most one render per frame, and fewer when a render is
    // expensive, so a long document never makes keystrokes queue up.
    const update = (text, { local = false } = {}) => {
        latest = { text, local };
        if (frame !== null || timer !== null) return;
        if (lastCost > SLOW_RENDER_MS) {
            timer = setTimeout(flush, Math.min(300, Math.round(lastCost * 4)));
        } else {
            frame = requestAnimationFrame(flush);
        }
    };

    // A different document: render at once, from a clean slate, so nothing of
    // the previous one survives into it.
    const show = (text, { local = false } = {}) => {
        cancel();
        latest = { text, local };
        output.replaceChildren();
        renderNow(latest);
    };

    // ----- navigation inside the preview -----

    const flash = (element) => {
        element.classList.remove('jump-flash');
        // Force a reflow so the animation restarts on a repeat click.
        void element.offsetWidth;
        element.classList.add('jump-flash');
    };

    const smooth = () =>
        window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';

    const topOf = (element) =>
        element.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;

    const revealAnchor = (id, { mark = true } = {}) => {
        const target = output.querySelector(`#${CSS.escape(id)}`);
        if (!target) return false;
        scroller.scrollTo({ top: topOf(target) - 12, behavior: smooth() });
        if (mark) flash(target);
        return true;
    };

    // ----- source lines -----

    // [{ line, top }] for every top-level block, measured lazily and thrown
    // away whenever the layout can have changed.
    const measure = () => {
        if (!blocks) {
            blocks = Array.from(output.querySelectorAll(':scope > [data-line]'), (element) => ({
                line: Number(element.dataset.line),
                top: topOf(element)
            }));
        }
        return blocks;
    };

    new ResizeObserver(() => {
        blocks = null;
    }).observe(output);

    // Where in the preview a (fractional) source line sits, interpolating
    // between the blocks around it.
    const topForLine = (line) => {
        const list = measure();
        if (list.length === 0) return 0;
        let index = 0;
        while (index + 1 < list.length && list[index + 1].line <= line) index += 1;
        const current = list[index];
        const next = list[index + 1];
        if (line < current.line) return 0;
        if (!next) {
            const end = topOf(output) + output.offsetHeight;
            return current.top + Math.min(1, line - current.line) * Math.max(0, end - current.top);
        }
        const share = (line - current.line) / (next.line - current.line);
        return current.top + share * (next.top - current.top);
    };

    // The inverse: which source line is at a given scroll offset.
    const lineAtTop = (top) => {
        const list = measure();
        if (list.length === 0) return 1;
        let index = 0;
        while (index + 1 < list.length && list[index + 1].top <= top) index += 1;
        const current = list[index];
        const next = list[index + 1];
        if (!next || next.top === current.top) return current.line;
        const share = Math.max(0, Math.min(1, (top - current.top) / (next.top - current.top)));
        return current.line + share * (next.line - current.line);
    };

    const revealLine = (line) => {
        scroller.scrollTo({ top: Math.max(0, topForLine(line) - 12), behavior: smooth() });
    };

    // ----- clicks -----

    output.addEventListener('click', (event) => {
        const link = event.target.closest('a[href]');
        if (!link || !output.contains(link)) return;
        const href = link.getAttribute('href');

        if (href.startsWith('#')) {
            event.preventDefault();
            let id = href.slice(1);
            try {
                id = decodeURIComponent(id);
            } catch (error) {
                // Use it as written.
            }
            revealAnchor(id);
            return;
        }

        // Leaving the app: the renderer already sends these to a new tab.
        if (EXTERNAL.test(href)) return;

        event.preventDefault();
        onLink?.(href, { background: event.metaKey || event.ctrlKey });
    });

    // Double-clicking a block in the preview finds its source, the way VS
    // Code's Markdown preview does.
    output.addEventListener('dblclick', (event) => {
        const block = event.target.closest('[data-line]');
        if (block && output.contains(block)) onReveal?.(Number(block.dataset.line));
    });

    // ----- copying code -----

    // One button, moved to whichever code block the pointer is over. Adding a
    // button to every block would put it into the document itself — into its
    // text, its HTML and its printed PDF.
    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.className = 'code-copy';
    copyButton.textContent = t.copy;
    copyButton.hidden = true;
    wrapper.appendChild(copyButton);

    let copyTarget = null;
    let copyTimer = null;

    const placeCopy = (pre) => {
        copyTarget = pre;
        const box = pre.getBoundingClientRect();
        const frameBox = wrapper.getBoundingClientRect();
        copyButton.style.top = `${box.top - frameBox.top + 6}px`;
        copyButton.style.right = `${frameBox.right - box.right + 6}px`;
        copyButton.hidden = false;
    };

    const hideCopy = () => {
        copyButton.hidden = true;
        copyTarget = null;
    };

    output.addEventListener('pointerover', (event) => {
        const pre = event.target.closest('pre');
        if (!pre || !output.contains(pre) || pre.classList.contains('mermaid')) {
            hideCopy();
            return;
        }
        if (pre !== copyTarget) placeCopy(pre);
    });

    // The button lives inside the scrolled content, so it travels with its
    // code block and never needs placing again on scroll.
    wrapper.addEventListener('pointerleave', hideCopy);

    copyButton.addEventListener('click', async () => {
        if (!copyTarget) return;
        const code = copyTarget.querySelector('code') ?? copyTarget;
        try {
            await navigator.clipboard.writeText(code.textContent);
            copyButton.textContent = t.copied;
        } catch (error) {
            copyButton.textContent = t.copyFailed;
        }
        clearTimeout(copyTimer);
        copyTimer = setTimeout(() => {
            copyButton.textContent = t.copy;
        }, 1200);
    });

    // Nothing to show (a tab waiting for access, no tab at all): a render
    // still scheduled for the previous document must not land here.
    const clear = () => {
        cancel();
        latest = null;
        output.replaceChildren();
    };

    return {
        show,
        update,
        flush,
        clear,
        revealAnchor,
        revealLine,
        topForLine,
        lineAtTop,
        rerenderDiagrams: () => mermaid.render(output, theme())
    };
};

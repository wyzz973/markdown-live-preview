// Markdown -> sanitized HTML, and the outline read back from it.

import DOMPurify from 'dompurify';
import { isSupported } from './highlight.js';
import { toHtml } from './markdown.js';

export { escapeHtml } from './markdown.js';

// ----- sanitization -----

// A path with no scheme that does not start at the site root: something the
// document expects to find next to itself on disk.
const isRelative = (src) => !/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(src);

let holdLocalImages = false;

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    // Links leaving the app used to replace the editor page. Open them in a
    // new tab instead. Applied here rather than in the link renderer so it
    // also covers raw <a> tags in the source and cannot be stripped by
    // sanitizing.
    if (node.tagName === 'A' && node.hasAttribute('href')) {
        const href = node.getAttribute('href');
        if (/^(https?:)?\/\//i.test(href)) {
            node.setAttribute('target', '_blank');
            node.setAttribute('rel', 'noopener noreferrer');
        }
        return;
    }

    // `![](assets/logo.png)` in a note is a file next to the note, which the
    // page cannot fetch by URL. The path is parked in data-local-src — so the
    // browser does not request it from the site and log a 404 — and the
    // preview reads it from the open folder instead.
    if (holdLocalImages && node.tagName === 'IMG') {
        const src = node.getAttribute('src');
        if (src && isRelative(src)) {
            node.setAttribute('data-local-src', src);
            node.removeAttribute('src');
        }
    }
});

export const render = (markdown, { localImages = false } = {}) => {
    holdLocalImages = localImages;
    try {
        return DOMPurify.sanitize(toHtml(markdown));
    } finally {
        holdLocalImages = false;
    }
};

// The heading outline of a rendered preview, read off the DOM so it carries the
// ids markdown.js gave each heading. A heading nested inside a list or quote
// takes the line of the block around it.
export const outline = (container) =>
    Array.from(container.querySelectorAll('h1, h2, h3, h4, h5, h6')).map((heading) => {
        const block = heading.closest('[data-line]');
        return {
            id: heading.id,
            level: Number(heading.tagName.slice(1)),
            text: heading.textContent.trim(),
            line: block ? Number(block.dataset.line) : undefined
        };
    });

export { isSupported as isLanguageSupported };

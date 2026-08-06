// Markdown -> sanitized HTML.

import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { highlight, isSupported } from './highlight.js';

export const escapeHtml = (value) =>
    value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

// ----- heading slugs -----

// marked dropped its built-in `headerIds` option in v5; the options object this
// app used to pass was silently ignored, so every heading rendered without an
// id and in-document anchor links never resolved. Generate GitHub-compatible
// slugs ourselves instead.
//
// Punctuation is dropped and letters, digits and CJK are kept, so a Chinese
// heading anchors under its own text the way GitHub does. Spelled out block by
// block rather than as one dense character class: the previous one-liner mixed
// literal punctuation with invisible Unicode range endpoints and could not be
// read, let alone reviewed — and it silently let every CJK punctuation mark
// through into the slug.
const PUNCTUATION = new RegExp(
    [
        '[\\\\\'!"#$%&()*+,./:;<=>?@\\[\\]^`{|}~]', // ASCII punctuation
        '[\\u2000-\\u206F]', // general punctuation: dashes, quotes, bullets
        '[\\u2E00-\\u2E7F]', // supplemental punctuation
        '[\\u3001-\\u303F]', // CJK punctuation 、。〈〉《》「」【】 (U+3000 is a space, left to \\s)
        '[\\uFF01-\\uFF0F\\uFF1A-\\uFF20\\uFF3B-\\uFF40\\uFF5B-\\uFF65]' // fullwidth punctuation, keeping fullwidth alphanumerics
    ].join('|'),
    'g'
);

const slugify = (text) =>
    text
        .toLowerCase()
        .trim()
        .replace(/<[^>]*>/g, '')
        .replace(PUNCTUATION, '')
        // \s covers the ideographic space U+3000 as well as ASCII whitespace.
        .replace(/\s+/g, '-');

class Slugger {
    constructor() {
        this.seen = new Map();
    }

    slug(text) {
        const base = slugify(text) || 'section';
        const count = this.seen.get(base) ?? 0;
        this.seen.set(base, count + 1);
        return count === 0 ? base : `${base}-${count}`;
    }
}

// ----- renderer -----

const createRenderer = (slugger) => {
    const renderer = new marked.Renderer();
    const renderCode = renderer.code.bind(renderer);

    renderer.code = function (token) {
        const lang = (token.lang || '').match(/^\S*/)?.[0].toLowerCase() ?? '';

        // Mermaid blocks are handed to the diagram renderer as escaped source;
        // they are turned into SVG after the HTML lands in the DOM.
        if (lang === 'mermaid') {
            return `<pre class="mermaid">${escapeHtml(token.text)}</pre>\n`;
        }

        const highlighted = highlight(token.text, lang);
        if (highlighted === null) {
            return renderCode.call(this, token);
        }

        return `<pre><code class="hljs language-${escapeHtml(lang)}">${highlighted}</code></pre>\n`;
    };

    renderer.heading = function (token) {
        const content = this.parser.parseInline(token.tokens);
        const id = slugger.slug(token.text);
        return `<h${token.depth} id="${escapeHtml(id)}">${content}</h${token.depth}>\n`;
    };

    return renderer;
};

// ----- sanitization -----

// Links leaving the app used to replace the editor page. Open them in a new tab
// instead. Applied as a DOMPurify hook rather than in the link renderer so it
// also covers raw <a> tags in the source and cannot be stripped by sanitizing.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName !== 'A' || !node.hasAttribute('href')) {
        return;
    }

    const href = node.getAttribute('href');
    if (/^(https?:)?\/\//i.test(href)) {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
    }
});

export const render = (markdown) => {
    // A fresh slugger per render keeps duplicate-heading suffixes stable
    // instead of growing on every keystroke.
    const renderer = createRenderer(new Slugger());
    const html = marked.parse(markdown, { renderer, gfm: true, breaks: false });
    return DOMPurify.sanitize(html);
};

// Collect the heading outline of the current preview. Kept here next to the
// slug logic so a table of contents can reuse the exact same ids.
export const outline = (container) =>
    Array.from(container.querySelectorAll('h1, h2, h3, h4, h5, h6')).map((heading) => ({
        id: heading.id,
        level: Number(heading.tagName.slice(1)),
        text: heading.textContent.trim()
    }));

export { isSupported as isLanguageSupported };

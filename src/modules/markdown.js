// Markdown -> HTML, before sanitizing.
//
// Kept apart from renderer.js, which adds DOMPurify on top, so the parsing
// rules here can be tested without a DOM.

import { Marked } from 'marked';
import { highlight } from './highlight.js';
import { cjkEmphasis, joinCjkBreaks } from './markdown-cjk.js';

export const escapeHtml = (value) =>
    value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

// A private instance, so the Chinese emphasis rules below stay out of any
// other code that might import marked.
const md = new Marked({ gfm: true, breaks: false }, cjkEmphasis);

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

// ----- source lines -----

// Every top-level block carries the editor line it starts on, as data-line.
// That one attribute is what lets the outline move the editor, the two panes
// scroll together line for line, and a double-click in the preview find its
// source — the proportional scroll sync this replaces drifted further with
// every image and diagram.
const LINE_BLOCKS = ['paragraph', 'heading', 'code', 'table', 'blockquote', 'list', 'hr', 'html'];

const tagLine = (html, line) => html.replace(/^(\s*<[a-zA-Z][\w-]*)/, `$1 data-line="${line}"`);

const countNewlines = (text) => {
    let count = 0;
    for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) count += 1;
    return count;
};

// ----- front matter -----

// A YAML block at the top of a note (Obsidian, Hugo, Jekyll…). CommonMark has
// no idea what it is and reads `---` / `title: x` / `---` as a rule followed
// by a setext heading, which put a bogus "title: x" into the outline. It is
// shown as what it is instead: highlighted YAML.
const FRONT_MATTER = /^---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

const splitFrontMatter = (markdown) => {
    const match = FRONT_MATTER.exec(markdown);
    if (!match) return null;
    return { yaml: match[1], raw: match[0], body: markdown.slice(match[0].length) };
};

const renderFrontMatter = (yaml) => {
    const highlighted = highlight(yaml, 'yaml') ?? escapeHtml(yaml);
    return `<pre data-line="1" class="front-matter"><code class="hljs language-yaml">${highlighted}</code></pre>\n`;
};

// ----- renderer -----

const createRenderer = (slugger) => {
    const renderer = new md.Renderer();
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

    LINE_BLOCKS.forEach((name) => {
        const base = renderer[name];
        renderer[name] = function (token) {
            const html = base.call(this, token);
            return token._line ? tagLine(html, token._line) : html;
        };
    });

    return renderer;
};

// Markdown to HTML, not yet sanitized.
export const toHtml = (markdown) => {
    const front = splitFrontMatter(markdown);
    const body = front ? front.body : markdown;
    let line = front ? countNewlines(front.raw) + 1 : 1;

    // Each token is found in the source rather than counted from the tokens
    // before it: marked keeps link reference definitions (`[a]: http://…`)
    // out of the token list altogether, so a running count fell behind by
    // their lines and every block after them pointed at the wrong line.
    // Line endings are normalised the way the lexer normalises them.
    const tokens = md.lexer(body);
    const source = body.replace(/\r\n?/g, '\n');
    let offset = 0;
    for (const token of tokens) {
        const at = token.raw ? source.indexOf(token.raw, offset) : -1;
        if (at !== -1) {
            line += countNewlines(source.slice(offset, at));
            offset = at + token.raw.length;
        } else {
            offset += token.raw?.length ?? 0;
        }
        token._line = line;
        line += countNewlines(token.raw ?? '');
    }
    md.walkTokens(tokens, joinCjkBreaks);

    const renderer = createRenderer(new Slugger());
    const html = md.parser(tokens, { ...md.defaults, renderer });
    return front ? renderFrontMatter(front.yaml) + html : html;
};

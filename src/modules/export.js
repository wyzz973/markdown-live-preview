// PDF export via the browser's own print pipeline.
//
// This used to rasterise the preview with html2canvas and slice the bitmap into
// pages with jsPDF — the approach nearly every Markdown tool reaches for, and
// the source of four bugs that cannot be fixed within it:
//
//   - the slicer knows nothing about content, so it cut through list items,
//     code blocks and even the middle of a heading's glyphs
//   - a heading landing near the bottom was stranded away from its section
//   - Mermaid diagrams lost everything past the right edge, because the
//     rasteriser could not follow the SVG's overflow
//   - the whole document arrived as three page-sized images: no selectable
//     text, no working links, blurry when zoomed, 680 kB for three pages
//
// Chrome already contains a production PDF engine, and CSS already has a
// pagination model. Printing a purpose-built document through a hidden iframe
// hands all four problems to code that was written to solve them: diagrams stay
// vector, text stays text, and `break-inside` decides where pages end.

import * as theme from './theme.js';
import * as mermaidRenderer from './mermaid.js';

// Pulled from the live document so the print copy keeps the app's typeface
// rather than falling back to a system font mid-export.
const collectFontFaces = () => {
    const faces = [];
    for (const sheet of document.styleSheets) {
        let rules;
        try {
            rules = sheet.cssRules;
        } catch (error) {
            // A cross-origin stylesheet cannot be read; nothing to carry over.
            continue;
        }
        for (const rule of rules) {
            if (rule.constructor.name === 'CSSFontFaceRule') {
                faces.push(rule.cssText);
            }
        }
    }
    return faces.join('\n');
};

const PRINT_CSS = `
@page {
  size: A4;
  margin: 18mm 16mm;
}

html, body {
  margin: 0;
  padding: 0;
  background: #fff;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

.markdown-body {
  max-width: none;
  padding: 0;
  font-size: 11pt;
  line-height: 1.75;
}

/* Nothing that reads as a single unit may be split across a page break. */
pre,
table,
blockquote,
figure,
img,
.mermaid {
  break-inside: avoid;
}

tr, li { break-inside: avoid; }

/* A heading stranded at the foot of a page is the most common flaw in an
   exported document; keep it with what it introduces. */
h1, h2, h3, h4, h5, h6 {
  break-after: avoid;
  break-inside: avoid;
}

p, li { orphans: 3; widows: 3; }

/* Diagrams stay vector and are scaled to the text column rather than being
   clipped at the right margin. The height cap matters as much as the width
   one: A4 less its margins leaves 261mm, and a diagram taller than that would
   be sliced across a page boundary no matter how break-inside is set. Mermaid
   emits a viewBox, so capping both axes scales it down in proportion. */
.mermaid { text-align: center; }

.mermaid svg {
  max-width: 100% !important;
  max-height: 240mm !important;
  height: auto !important;
}

/* Mermaid writes an inline max-width in pixels sized for the screen; on paper
   the column is the only constraint that should apply. */
.mermaid svg[style] { max-width: 100% !important; }

img { max-width: 100%; height: auto; }

/* A long code line has nowhere to scroll on paper, so wrap it instead of
   letting it run off the page.
   Qualified with .markdown-body on purpose: github-markdown-css sets
   white-space and overflow through a .markdown-body pre code selector, which
   outranks a bare element selector — the first attempt at this rule lost the
   cascade and the code kept getting clipped at the right margin. */
.markdown-body pre,
.markdown-body pre > code {
  white-space: pre-wrap !important;
  word-break: break-word;
  overflow: visible !important;
}

/* Same story for tables: GitHub makes them display:block with overflow:auto so
   wide ones scroll on screen. On paper that clips the right-hand columns, so
   they become real tables that lay out to the column width. */
.markdown-body table {
  display: table !important;
  width: 100% !important;
  max-width: 100% !important;
  overflow: visible !important;
  table-layout: fixed;
  word-break: break-word;
}

/* The editor's jump highlight has no business in a printed document. */
.jump-flash { animation: none !important; background: transparent !important; }
`;

const buildDocument = ({ html, title, fontFaces, markdownCss }) => `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <base href="${document.baseURI}">
    <title>${title}</title>
    <style>${fontFaces}</style>
    <style>${markdownCss}</style>
    <style>${PRINT_CSS}</style>
  </head>
  <body>
    <article class="markdown-body">${html}</article>
  </body>
</html>`;

// Resolve once the iframe's own fonts and images are ready. Printing earlier
// produces a document with fallback glyphs or missing pictures.
const waitForAssets = async (frameWindow) => {
    const frameDocument = frameWindow.document;

    await frameDocument.fonts?.ready;

    const images = Array.from(frameDocument.images).filter((image) => !image.complete);
    await Promise.all(
        images.map(
            (image) =>
                new Promise((resolve) => {
                    image.addEventListener('load', resolve, { once: true });
                    image.addEventListener('error', resolve, { once: true });
                })
        )
    );

    // One more frame so layout settles before the print snapshot is taken.
    await new Promise((resolve) => frameWindow.requestAnimationFrame(() => resolve()));
};

export const toPdf = async ({ output, title = 'Markdown' }) => {
    if (!output) {
        return;
    }

    const wasDark = theme.isDark();

    // A dark diagram on white paper is unreadable, so re-render Mermaid in the
    // light theme for the capture and restore afterwards.
    mermaidRenderer.cancelScheduledRender();
    if (wasDark) {
        await mermaidRenderer.renderNow(output, 'default');
    }

    const frame = document.createElement('iframe');
    // Kept in the layout but out of sight: `display: none` would give the
    // document no viewport to lay out against, and pagination needs one.
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText =
        'position:fixed;right:0;bottom:0;width:210mm;height:297mm;border:0;opacity:0;pointer-events:none;z-index:-1;';
    document.body.appendChild(frame);

    try {
        const frameDocument = frame.contentDocument;
        frameDocument.open();
        frameDocument.write(
            buildDocument({
                html: output.innerHTML,
                title,
                fontFaces: collectFontFaces(),
                markdownCss: theme.LIGHT_PREVIEW_CSS
            })
        );
        frameDocument.close();

        await waitForAssets(frame.contentWindow);

        frame.contentWindow.focus();
        frame.contentWindow.print();
    } finally {
        // Safari fires `afterprint` late and Chrome's dialog is modal, so the
        // frame is removed on a timer rather than on the event.
        setTimeout(() => frame.remove(), 1000);

        if (wasDark) {
            await mermaidRenderer.renderNow(output, 'dark');
        }
    }
};

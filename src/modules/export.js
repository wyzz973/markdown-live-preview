// PDF export of the preview pane.
//
// html2pdf used to be a cdnjs <script defer> tag, so clicking Export before it
// finished loading produced an "not available yet" alert. It is now a bundled
// import, and the light stylesheet it needs for the printed page comes from the
// same bundled string the theme module uses instead of a second fetch.

import * as theme from './theme.js';
import * as mermaidRenderer from './mermaid.js';

const PAGE_STYLE = `
#preview-wrapper, #output, body {
  background: #fff !important;
  color: #24292f !important;
}
#output {
  width: 190mm !important;
  max-width: 190mm !important;
}
`;

export const toPdf = async ({ source, output, filename = 'markdown-preview.pdf' }) => {
    if (!source) {
        return;
    }

    const wasDark = theme.isDark();

    // A dark diagram on a white page is unreadable, so re-render Mermaid in the
    // light theme for the capture and restore afterwards.
    mermaidRenderer.cancelScheduledRender();
    await mermaidRenderer.renderNow(output, 'default');

    const options = {
        margin: 10,
        filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: {
            scale: 2,
            useCORS: true,
            onclone: (clonedDoc) => {
                clonedDoc.documentElement.setAttribute('data-theme', 'light');

                const style = clonedDoc.createElement('style');
                style.textContent = `${theme.LIGHT_PREVIEW_CSS}\n${PAGE_STYLE}`;
                clonedDoc.head.appendChild(style);
            }
        },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    try {
        // Roughly a megabyte of PDF machinery that most sessions never touch —
        // fetched on the first export rather than on page load.
        const { default: html2pdf } = await import('html2pdf.js');
        await html2pdf().set(options).from(source).save();
    } finally {
        if (wasDark) {
            await mermaidRenderer.renderNow(output, 'dark');
        }
    }
};

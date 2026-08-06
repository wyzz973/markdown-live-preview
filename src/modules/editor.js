// Monaco editor setup.
//
// Monaco used to be pulled from jsdelivr as an ESM URL while `monaco-editor`
// sat unused in package.json — that made first paint depend on a third-party
// CDN and broke the app entirely when offline. It is now bundled locally.
// Importing `editor.api` plus only the Markdown language contribution keeps the
// bundle far smaller than the full `monaco-editor` entry point.

import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import 'monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';

// With a real worker the editor no longer needs the stub Proxy the old code
// installed to suppress worker loading.
self.MonacoEnvironment = {
    getWorker: () => new EditorWorker()
};

// Latin and the Markdown syntax marks render in Plex Mono; Chinese falls
// through to the platform face per character. Monaco measures CJK glyphs as
// double-width, so the caret and selection stay correct in mixed text.
const FONT_STACK =
    "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, " +
    "'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', monospace";

export const create = (container) =>
    monaco.editor.create(container, {
        fontSize: 13.5,
        fontFamily: FONT_STACK,
        lineHeight: 1.7,
        language: 'markdown',
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        automaticLayout: true,
        scrollbar: {
            vertical: 'visible',
            horizontal: 'visible'
        },
        wordWrap: 'on',
        hover: { enabled: false },
        quickSuggestions: false,
        suggestOnTriggerCharacters: false,
        folding: false,
        renderLineHighlight: 'none',
        padding: { top: 8, bottom: 8 }
    });

export const setTheme = (isDark) => {
    monaco.editor.setTheme(isDark ? 'vs-dark' : 'vs');
};

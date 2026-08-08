// Monaco editor setup.
//
// Monaco used to be pulled from jsdelivr as an ESM URL while `monaco-editor`
// sat unused in package.json — that made first paint depend on a third-party
// CDN and broke the app entirely when offline. It is now bundled locally.
// Importing `editor.api` plus only the Markdown language contribution keeps the
// bundle far smaller than the full `monaco-editor` entry point.

import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import 'monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution';
// Monaco ships a full JSON language service: schema-aware validation with
// character-precise error positions, formatting, folding and completion. It
// runs in its own worker, so it costs nothing until a JSON file is opened.
import 'monaco-editor/esm/vs/language/json/monaco.contribution';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';

// With real workers the editor no longer needs the stub Proxy the old code
// installed to suppress worker loading.
self.MonacoEnvironment = {
    getWorker: (_, label) => (label === 'json' ? new JsonWorker() : new EditorWorker())
};

monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
    validate: true,
    allowComments: true,
    schemaValidation: 'warning'
});

export const setLanguage = (editor, language) => {
    const model = editor.getModel();
    if (model && model.getLanguageId() !== language) {
        monaco.editor.setModelLanguage(model, language);
    }
};

export const format = (editor) => editor.getAction('editor.action.formatDocument')?.run();

// Latin and the Markdown syntax marks render in Plex Mono; Chinese falls
// through to the platform face per character. Monaco measures CJK glyphs as
// double-width, so the caret and selection stay correct in mixed text.
const FONT_STACK =
    "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, " +
    "'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', monospace";

const SHARED = {
    fontSize: 13.5,
    fontFamily: FONT_STACK,
    lineHeight: 1.7,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    automaticLayout: true,
    wordWrap: 'on',
    hover: { enabled: false },
    quickSuggestions: false,
    suggestOnTriggerCharacters: false,
    folding: false,
    renderLineHighlight: 'none',
    padding: { top: 8, bottom: 8 }
};

export const create = (container) =>
    monaco.editor.create(container, {
        ...SHARED,
        language: 'markdown',
        scrollbar: {
            vertical: 'visible',
            horizontal: 'visible'
        }
    });

// Both sides stay editable: in a diff tool the two panes are the input, and
// making the reader paste somewhere else first would be an extra step for
// nothing.
//
// Side-by-side is forced. The palette carries one wash and no green, so an
// insertion and a deletion are tinted identically — which is unambiguous only
// because the left pane is "before" and the right is "after". Let Monaco fall
// back to the inline view on a narrow window and that guarantee is gone, so
// `useInlineViewWhenSpaceIsLimited` is off. The sash is fixed at the middle for
// the same reason: the column labels above would otherwise start lying.
export const createDiff = (container) => {
    const diffEditor = monaco.editor.createDiffEditor(container, {
        ...SHARED,
        originalEditable: true,
        renderSideBySide: true,
        useInlineViewWhenSpaceIsLimited: false,
        enableSplitViewResizing: false,
        renderOverviewRuler: false,
        renderIndicators: false,
        ignoreTrimWhitespace: false,
        lineNumbersMinChars: 3
    });

    const original = monaco.editor.createModel('', 'plaintext');
    const modified = monaco.editor.createModel('', 'plaintext');
    diffEditor.setModel({ original, modified });

    return { diffEditor, original, modified };
};

export const setModelLanguage = (model, language) => {
    if (model.getLanguageId() !== language) {
        monaco.editor.setModelLanguage(model, language);
    }
};

// The wash, at two strengths: the stronger one marks the characters that
// actually differ, the weaker one the lines holding them. Monaco's stock red
// and green are replaced because in this palette red means "something is
// wrong", and a deleted line is not an error.
const diffColors = (wash, edge) => ({
    'diffEditor.insertedTextBackground': `${wash}88`,
    'diffEditor.removedTextBackground': `${wash}88`,
    'diffEditor.insertedLineBackground': `${wash}3a`,
    'diffEditor.removedLineBackground': `${wash}3a`,
    'diffEditorGutter.insertedLineBackground': `${wash}3a`,
    'diffEditorGutter.removedLineBackground': `${wash}3a`,
    'diffEditor.border': edge,
    'diffEditor.diagonalFill': `${edge}55`
});

monaco.editor.defineTheme('station-light', {
    base: 'vs',
    inherit: true,
    rules: [],
    colors: diffColors('#c2e5f5', '#cfd7dd')
});

monaco.editor.defineTheme('station-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: diffColors('#1d4257', '#333b45')
});

export const setTheme = (isDark) => {
    monaco.editor.setTheme(isDark ? 'station-dark' : 'station-light');
};

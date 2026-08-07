// The formatting toolbar.
//
// Every button is labelled with the syntax it writes — `**`, `` ` ``, `>`, `|`
// — instead of an icon. Using one teaches the format rather than hiding it,
// and the labels stay legible whatever the interface language is.

import { t } from './strings.js';

const TOOLS = [
    { label: '#', title: () => t.tools.heading, prefix: '# ' },
    { label: '**', title: () => t.tools.bold, wrap: '**', hint: () => t.placeholders.bold },
    { label: '*', title: () => t.tools.italic, wrap: '*', hint: () => t.placeholders.italic },
    { label: '~~', title: () => t.tools.strike, wrap: '~~', hint: () => t.placeholders.strike },
    { label: '`', title: () => t.tools.code, wrap: '`', hint: () => t.placeholders.code },
    { rule: true },
    { label: '>', title: () => t.tools.quote, prefix: '> ' },
    { label: '-', title: () => t.tools.bullet, prefix: '- ' },
    { label: '1.', title: () => t.tools.ordered, prefix: '1. ' },
    { label: '[ ]', title: () => t.tools.task, prefix: '- [ ] ' },
    { label: '```', title: () => t.tools.fence, block: () => `\`\`\`\n${t.placeholders.fence}\n\`\`\`` },
    { rule: true },
    { label: '[]()', title: () => t.tools.link, template: (sel) => `[${sel || t.placeholders.link}](https://)` },
    { label: '![]()', title: () => t.tools.image, template: (sel) => `![${sel || t.placeholders.image}](image.png)` },
    { label: '|', title: () => t.tools.table, block: () => t.tableTemplate }
];

// JSON gets its own actions: Markdown's `**` and `>` mean nothing here, and
// the things you actually reach for — reformat, minify, repair, and the
// Unicode round-trip Chinese payloads force on you — have no equivalent in the
// Markdown set. Labels are words rather than syntax because JSON's operations
// are transforms of the whole document, not characters you insert.
const jsonAction = (run) => ({ run });

export const setup = ({ container, editor, jsonOps }) => {
    const model = () => editor.getModel();

    const applyEdit = (range, text) => {
        editor.executeEdits('toolbar', [{ range, text, forceMoveMarkers: true }]);
        editor.focus();
    };

    const insertPrefix = (prefix) => {
        const selection = editor.getSelection();
        const monacoRange = {
            startLineNumber: selection.startLineNumber,
            startColumn: 1,
            endLineNumber: selection.startLineNumber,
            endColumn: 1
        };
        applyEdit(monacoRange, prefix);
    };

    const insertBlock = (text) => {
        const selection = editor.getSelection();
        const doc = model();
        const line = doc.getLineContent(selection.startLineNumber);
        const atLineStart = selection.startColumn === 1;

        // Block-level insertions have to land on their own lines, or they fuse
        // with whatever text they were dropped next to.
        const before = atLineStart ? '' : '\n';
        const after = line.slice(selection.endColumn - 1).trim() === '' ? '\n' : '\n\n';

        applyEdit(selection, `${before}${text}${after}`);
    };

    const applyTool = (tool) => {
        const selection = editor.getSelection();
        const selected = model().getValueInRange(selection);

        if (tool.prefix) {
            insertPrefix(tool.prefix);
            return;
        }

        if (tool.block) {
            insertBlock(tool.block());
            return;
        }

        if (tool.template) {
            applyEdit(selection, tool.template(selected));
            return;
        }

        applyEdit(selection, `${tool.wrap}${selected || tool.hint()}${tool.wrap}`);
    };

    container.setAttribute('aria-label', t.toolbarLabel);

    const markdownButtons = document.createElement('div');
    markdownButtons.className = 'toolbar-set';

    TOOLS.forEach((tool) => {
        if (tool.rule) {
            const rule = document.createElement('span');
            rule.className = 'rule';
            markdownButtons.appendChild(rule);
            return;
        }

        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = tool.label;
        button.title = tool.title();
        button.setAttribute('aria-label', tool.title());
        button.addEventListener('click', () => applyTool(tool));
        markdownButtons.appendChild(button);
    });

    // ----- JSON actions -----

    const replaceAll = (text) => {
        const doc = model();
        editor.executeEdits('json-tool', [{ range: doc.getFullModelRange(), text }]);
        editor.focus();
    };

    // Every action reads the buffer, transforms it, writes it back. A failure
    // leaves the document untouched and says why rather than silently doing
    // nothing.
    const transform = (fn) => () => {
        try {
            const next = fn(editor.getValue());
            if (typeof next === 'string') {
                replaceAll(next);
            }
        } catch (error) {
            jsonOps?.onError?.(error);
        }
    };

    const JSON_ACTIONS = [
        { label: t.jsonFormat, run: transform((text) => jsonOps.format(text)) },
        { label: t.jsonMinify, run: transform((text) => jsonOps.minify(text)) },
        { label: t.jsonRepair, run: transform((text) => jsonOps.repair(text)) },
        { label: t.jsonSort, run: transform((text) => jsonOps.sort(text)) },
        { rule: true },
        { label: t.jsonEscape, run: transform((text) => jsonOps.escape(text)) },
        { label: t.jsonUnescape, run: transform((text) => jsonOps.unescape(text)) },
        { rule: true },
        { label: t.jsonToChinese, run: transform((text) => jsonOps.toChinese(text)) },
        { label: t.jsonToUnicode, run: transform((text) => jsonOps.toUnicode(text)) }
    ];

    const jsonButtons = document.createElement('div');
    jsonButtons.className = 'toolbar-set toolbar-words';
    jsonButtons.hidden = true;

    JSON_ACTIONS.forEach((action) => {
        if (action.rule) {
            const rule = document.createElement('span');
            rule.className = 'rule';
            jsonButtons.appendChild(rule);
            return;
        }
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = action.label;
        button.addEventListener('click', action.run);
        jsonButtons.appendChild(button);
    });

    container.append(markdownButtons, jsonButtons);

    return {
        setDocType(type) {
            markdownButtons.hidden = type !== 'markdown';
            jsonButtons.hidden = type !== 'json';
        }
    };
};

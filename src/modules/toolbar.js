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

export const setup = ({ container, editor }) => {
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

    TOOLS.forEach((tool) => {
        if (tool.rule) {
            const rule = document.createElement('span');
            rule.className = 'rule';
            container.appendChild(rule);
            return;
        }

        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = tool.label;
        button.title = tool.title();
        button.setAttribute('aria-label', tool.title());
        button.addEventListener('click', () => applyTool(tool));
        container.appendChild(button);
    });
};

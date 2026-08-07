// The tool registry.
//
// Two workbench kinds share one skeleton:
//   - 'document' : rail | editor | preview, backed by the folder workspace
//   - 'utility'  : input | output, no folder
//
// A tool declares which skeleton it wants and how to drive it. Adding a tool is
// one entry here plus its module — no navigation surgery.

import { t } from './strings.js';

export const TOOLS = [
    {
        id: 'markdown',
        kind: 'document',
        name: () => t.toolMarkdown,
        hint: () => t.toolMarkdownHint,
        // Extensions this tool claims in an open folder.
        extensions: ['md', 'markdown', 'mdown', 'mkd']
    },
    {
        id: 'json',
        kind: 'document',
        name: () => t.toolJson,
        hint: () => t.toolJsonHint,
        extensions: ['json', 'jsonc', 'json5']
    },
    {
        id: 'stream',
        kind: 'utility',
        name: () => t.toolStream,
        hint: () => t.toolStreamHint
    },
    {
        id: 'unicode',
        kind: 'utility',
        name: () => t.toolUnicode,
        hint: () => t.toolUnicodeHint
    }
];

export const byId = (id) => TOOLS.find((tool) => tool.id === id) ?? TOOLS[0];

export const extensionOf = (name) => (name.split('.').pop() || '').toLowerCase();

// Which document tool should open a given filename. Falls back to Markdown so
// an unknown extension still renders as text rather than refusing to open.
export const toolForFile = (name) => {
    const extension = extensionOf(name);
    return (
        TOOLS.find((tool) => tool.kind === 'document' && tool.extensions?.includes(extension)) ??
        byId('markdown')
    );
};

// Every extension any document tool claims — the folder walker's filter.
export const documentExtensions = () =>
    TOOLS.filter((tool) => tool.kind === 'document').flatMap((tool) => tool.extensions ?? []);

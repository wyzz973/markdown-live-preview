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
    // Request and response sit next to each other on purpose: they are the two
    // halves of one exchange, and debugging usually walks from one to the other.
    {
        id: 'request',
        kind: 'utility',
        name: () => t.toolRequest,
        hint: () => t.toolRequestHint
    },
    {
        id: 'stream',
        kind: 'utility',
        name: () => t.toolStream,
        hint: () => t.toolStreamHint
    },
    {
        id: 'diff',
        kind: 'utility',
        name: () => t.toolDiff,
        hint: () => t.toolDiffHint
    },
    {
        id: 'unicode',
        kind: 'utility',
        name: () => t.toolUnicode,
        hint: () => t.toolUnicodeHint
    }
];

// The menu groups by workbench kind. At four tools a flat list was fine; at six
// it stopped saying which ones open a file and which ones take a paste.
export const GROUPS = [
    { kind: 'document', label: () => t.groupDocument },
    { kind: 'utility', label: () => t.groupUtility }
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

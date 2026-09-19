// What was open — the folder, the tabs and which one was in front — so that a
// reload, or tomorrow morning, comes back to the same desk.
//
// Only descriptions are stored here. File handles cannot go into local
// storage, so a tab refers to its file by the folder's record in the
// recent-entries store plus a path, or by the file's own record; scratch text
// lives under its own key (see scratch.js).

import { read, write, KEYS } from './storage.js';

const VERSION = 1;

const describe = (doc) => {
    if (doc.kind === 'scratch') {
        return { kind: 'scratch', id: doc.scratchId, type: doc.type, label: doc.label, key: doc.key };
    }
    if (doc.entry?.root) {
        return {
            kind: 'folder',
            root: doc.entry.root,
            path: doc.entry.path,
            type: doc.type,
            preview: doc.preview,
            key: doc.key
        };
    }
    if (doc.entry?.record) {
        return {
            kind: 'file',
            record: doc.entry.record,
            name: doc.entry.name,
            type: doc.type,
            preview: doc.preview,
            key: doc.key
        };
    }
    // A file the browser handed over without a way to find it again.
    return null;
};

export const snapshot = ({ docs, active, folder }) => ({
    v: VERSION,
    folder,
    active: active?.key ?? null,
    tabs: docs.map(describe).filter(Boolean)
});

export const save = (state) => write(KEYS.session, state);

export const load = () => {
    const state = read(KEYS.session, null);
    if (!state || state.v !== VERSION || !Array.isArray(state.tabs)) return null;
    return state;
};

// The keys a restored tab is known by, matching what documents.js is given
// when the same file is opened fresh.
export const folderKey = (folder, path) => `${folder}:${path}`;
export const fileKey = (record) => `file:${record}`;

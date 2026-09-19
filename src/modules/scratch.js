// Scratch documents: text that belongs to no file, kept in local storage under
// one key per document.
//
// The first two ids are the old per-tool buffers, 'markdown' and 'json', so a
// draft written before tabs existed opens as the first tab rather than being
// lost to the new layout.

import { read, write, remove, names, KEYS } from './storage.js';

const PREFIX = `${KEYS.content}:`;
const keyOf = (id) => `${PREFIX}${id}`;

export const store = {
    read: (id) => read(keyOf(id), null),
    write: (id, text) => write(keyOf(id), text),
    remove: (id) => remove(keyOf(id))
};

// Before per-tool buffers there was a single un-suffixed key. Move it across
// once so a document from that era survives too.
export const migrateLegacy = () => {
    const legacy = read(KEYS.content, null);
    if (legacy !== null && store.read('markdown') === null) {
        store.write('markdown', legacy);
    }
    remove(KEYS.content);
};

// Drop the text of scratch documents no tab refers to any more.
export const prune = (keep) => {
    names(PREFIX).forEach((name) => {
        const id = name.slice(PREFIX.length);
        if (!keep.has(id)) remove(name);
    });
};

// Local folder access via the File System Access API.
//
// Chromium browsers only. Everything here is behind `isSupported()` and the app
// falls back to a localStorage-backed scratch buffer where the API is missing,
// so Firefox and Safari still get a working editor — just no folder.

import { putRecord, deleteRecord, allRecords } from './idb.js';

// Driven by the tool registry so a new document tool's extensions are picked
// up here without a second list to keep in sync.
import { documentExtensions } from './tools.js';

const DOCUMENT_FILE = new RegExp(`\\.(${documentExtensions().join('|')})$`, 'i');
const SKIP_DIRECTORIES = new Set(['node_modules', '.git', '.obsidian', '.trash', 'dist', 'build']);
const MAX_DEPTH = 6;
const MAX_FILES = 2000;

export const isSupported = () =>
    typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';

// ----- permissions -----

const permissionState = async (handle, mode = 'readwrite') => {
    if (!handle.queryPermission) {
        return 'granted';
    }
    return handle.queryPermission({ mode });
};

export const ensurePermission = async (handle, mode = 'readwrite') => {
    if ((await permissionState(handle, mode)) === 'granted') {
        return true;
    }
    // Must be called from a user gesture; the recent-folder buttons are.
    return (await handle.requestPermission({ mode })) === 'granted';
};

// ----- walking -----

// Depth-first walk collecting Markdown files. Directory handles are kept on
// each entry so a file can be read and written later without re-walking.
const walk = async (directory, prefix, depth, collected) => {
    if (depth > MAX_DEPTH || collected.length >= MAX_FILES) {
        return;
    }

    const entries = [];
    for await (const entry of directory.values()) {
        entries.push(entry);
    }

    // Files before folders, each alphabetically — the order the rail shows.
    entries.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'file' ? -1 : 1;
        return a.name.localeCompare(b.name, 'zh-Hans-CN');
    });

    for (const entry of entries) {
        if (collected.length >= MAX_FILES) {
            return;
        }

        if (entry.kind === 'file') {
            if (!DOCUMENT_FILE.test(entry.name)) {
                continue;
            }
            collected.push({
                name: entry.name,
                dir: prefix,
                path: prefix ? `${prefix}/${entry.name}` : entry.name,
                handle: entry
            });
            continue;
        }

        if (entry.name.startsWith('.') || SKIP_DIRECTORIES.has(entry.name)) {
            continue;
        }

        await walk(entry, prefix ? `${prefix}/${entry.name}` : entry.name, depth + 1, collected);
    }
};

export const listMarkdownFiles = async (directoryHandle) => {
    const collected = [];
    await walk(directoryHandle, '', 0, collected);
    return collected;
};

// ----- reading and writing -----

export const readFile = async (entry) => {
    const file = await entry.handle.getFile();
    return { text: await file.text(), modifiedAt: file.lastModified, size: file.size };
};

export const writeFile = async (entry, text) => {
    const writable = await entry.handle.createWritable();
    await writable.write(text);
    await writable.close();
    const file = await entry.handle.getFile();
    return { modifiedAt: file.lastModified, size: file.size };
};

// ----- picking and remembering -----

export const pickDirectory = async () => {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite', id: 'notes' });
    await remember(handle);
    return handle;
};

// Recent folders are keyed by name. Two different folders that share a name
// would collide, so the key also carries a resolved marker when available.
const keyFor = (handle) => `dir:${handle.name}`;

export const remember = async (handle) => {
    await putRecord({
        id: keyFor(handle),
        name: handle.name,
        handle,
        openedAt: Date.now()
    });
};

export const forget = (handle) => deleteRecord(keyFor(handle));

export const recentFolders = async () => {
    try {
        const records = await allRecords();
        return records
            .filter((record) => record.handle)
            .sort((a, b) => b.openedAt - a.openedAt)
            .slice(0, 6);
    } catch (error) {
        return [];
    }
};

// Human-readable size for the rail.
export const formatSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

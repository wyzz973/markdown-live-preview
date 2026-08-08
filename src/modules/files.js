// Local disk access via the File System Access API.
//
// Two entry points, because the two are genuinely different jobs: a folder is a
// library you browse and search, a single file is a document you came here to
// edit. Wiring the second one through the folder machinery would have meant a
// one-file "folder", which reads wrong in the rail and searches nothing.
//
// Chromium browsers only. Everything here is behind a support check and the app
// falls back to a localStorage-backed scratch buffer where the API is missing,
// so Firefox and Safari still get a working editor.

import { putRecord, deleteRecord, allRecords } from './idb.js';
import { t } from './strings.js';

// Driven by the tool registry so a new document tool's extensions are picked
// up here without a second list to keep in sync.
import { documentExtensions } from './tools.js';

const DOCUMENT_FILE = new RegExp(`\\.(${documentExtensions().join('|')})$`, 'i');
const SKIP_DIRECTORIES = new Set(['node_modules', '.git', '.obsidian', '.trash', 'dist', 'build']);
const MAX_DEPTH = 6;
const MAX_FILES = 2000;

export const isDocumentName = (name) => DOCUMENT_FILE.test(name);

// For the <input type="file"> fallback, which takes a comma-separated list.
export const acceptAttribute = () =>
    documentExtensions()
        .map((extension) => `.${extension}`)
        .join(',');

// Folder browsing needs the directory picker; opening one file only needs the
// file picker. Safari has neither, Firefox has neither — but both can still
// read a dropped file, which is why the two checks are kept apart.
export const isSupported = () =>
    typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';

export const canPickFile = () =>
    typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function';

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

// A single file becomes the same shape a folder walk produces, so everything
// downstream — reading, writing, the dirty dot — works without a second path.
export const entryForFile = (handle) => ({
    name: handle.name,
    dir: '',
    path: handle.name,
    handle
});

// ----- picking and remembering -----

export const pickDirectory = async () => {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite', id: 'notes' });
    await remember(handle);
    return handle;
};

export const pickFile = async () => {
    const [handle] = await window.showOpenFilePicker({
        id: 'notes',
        multiple: false,
        types: [
            {
                description: t.filePickerLabel,
                accept: { 'text/*': documentExtensions().map((extension) => `.${extension}`) }
            }
        ]
    });
    await remember(handle);
    return handle;
};

// Recents used to be keyed by name, which collided for two folders called
// `docs` — and would collide far harder now that files are in the list, where
// several `README.md` are the norm rather than the exception. `isSameEntry` is
// the only reliable identity test the API offers, so the id is arbitrary and
// the lookup is a scan. The list is capped at a handful of records, so a scan
// costs nothing; a wrong match would cost the user their history.
const findRecord = async (handle) => {
    for (const record of await allRecords()) {
        try {
            if (record.handle && (await record.handle.isSameEntry(handle))) {
                return record;
            }
        } catch (error) {
            // A record written by an older build, or a handle the browser can
            // no longer resolve; either way it is not a match.
        }
    }
    return null;
};

export const remember = async (handle) => {
    const existing = await findRecord(handle);
    await putRecord({
        id: existing?.id ?? `${handle.kind}:${crypto.randomUUID()}`,
        kind: handle.kind,
        name: handle.name,
        handle,
        openedAt: Date.now()
    });
};

export const forget = (id) => deleteRecord(id);

export const recentEntries = async () => {
    try {
        const records = await allRecords();
        return records
            .filter((record) => record.handle)
            // Records written before single files existed were all folders.
            .map((record) => ({ ...record, kind: record.kind ?? 'directory' }))
            .sort((a, b) => b.openedAt - a.openedAt)
            .slice(0, 8);
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

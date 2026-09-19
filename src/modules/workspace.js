// The open folder: a library of documents to browse and search.
//
// What is open in tabs, and how each tab is saved, belongs to documents.js.
// This module only knows which folder is on the shelf and what is in it — the
// file list the rail draws, the index search reads, and the handle relative
// paths are resolved against. It used to hold "the current file" and its save
// timer as well; one timer shared by every file is what let an edit land in
// the wrong file.

import * as files from './files.js';
import { createIndex } from './search.js';

// Re-walking a large tree on every return to the window would be wasted
// work; files appearing a few seconds late is not.
const REFRESH_INTERVAL = 5000;

export const create = ({ onChange }) => {
    const index = createIndex();

    let directory = null;
    let key = null;
    let entries = [];
    let truncated = false;
    let lastWalk = 0;
    // A folder remembered from the last session that the browser has not
    // granted access to again yet.
    let pending = null;
    let indexRun = 0;
    let adoptRun = 0;

    // Read every file once so search has something to work with. Done in the
    // background so the folder is usable immediately; opening or closing a
    // folder abandons a build still running for the previous one. Indexing a
    // few newly found files (`only`) does not cancel the full build.
    const buildIndex = async (only = null) => {
        const run = only ? indexRun : ++indexRun;
        for (const entry of only ?? entries) {
            if (run !== indexRun) return;
            try {
                const { text, size } = await files.readFile(entry);
                entry.size = size;
                index.put(entry, text);
            } catch (error) {
                // A file that cannot be read is simply not searchable.
            }
        }
        if (run === indexRun) onChange('index');
    };

    // Nothing changes until the walk has succeeded, so a folder that cannot
    // be read leaves the previous one on the shelf. When two folders are being
    // opened at once, the one asked for last wins, not the one walked fastest.
    const adopt = async (handle, record = null) => {
        const run = ++adoptRun;
        const nextKey = record ?? (await files.remember(handle));
        const result = await files.listMarkdownFiles(handle, nextKey);
        if (run !== adoptRun) return entries;
        directory = handle;
        key = nextKey;
        pending = null;
        lastWalk = Date.now();
        entries = result.entries;
        truncated = result.truncated;
        index.clear();
        onChange('folder');
        buildIndex();
        return entries;
    };

    // From the picker. AbortError (the dialog was dismissed) propagates for
    // the caller to ignore.
    const open = async () => adopt(await files.pickDirectory());

    // From a drop or the recent list: a handle that may not be authorised.
    const openHandle = async (handle, record = null) => {
        if (!(await files.ensurePermission(handle))) return false;
        await adopt(handle, record);
        return true;
    };

    // The folder of a previous session. It opens straight away when the
    // browser still grants access (a reload, usually); otherwise it waits for
    // `resume`, which has to run inside a click.
    const restore = async (recordId) => {
        const record = await files.recordById(recordId);
        if (!record || record.kind !== 'directory') return 'gone';
        try {
            if ((await files.permissionOf(record.handle)) === 'granted') {
                await adopt(record.handle, record.id);
                return 'open';
            }
        } catch (error) {
            return 'gone';
        }
        pending = record;
        onChange('pending');
        return 'pending';
    };

    const resume = async () => {
        if (!pending) return false;
        const record = pending;
        if (!(await files.ensurePermission(record.handle))) return false;
        await adopt(record.handle, record.id);
        return true;
    };

    const close = () => {
        adoptRun += 1;
        directory = null;
        key = null;
        entries = [];
        truncated = false;
        pending = null;
        indexRun += 1;
        index.clear();
        onChange('folder');
    };

    // Pick up files added, renamed or removed outside the app. The walk is
    // of the folder open when it started; if another folder was opened (or
    // this one closed) meanwhile, its result is stale and dropped — otherwise
    // a slow walk of the old folder could land on top of the new one.
    const refresh = async ({ force = false } = {}) => {
        if (!directory || (!force && Date.now() - lastWalk < REFRESH_INTERVAL)) return false;
        const walked = directory;
        const walkedKey = key;
        let result;
        try {
            result = await files.listMarkdownFiles(walked, walkedKey);
        } catch (error) {
            return false;
        }
        if (directory !== walked) return false;
        lastWalk = Date.now();
        const known = new Map(entries.map((entry) => [entry.path, entry]));
        const added = result.entries.filter((entry) => !known.has(entry.path));
        const kept = new Set(result.entries.map((entry) => entry.path));
        const removed = entries.filter((entry) => !kept.has(entry.path));
        if (added.length === 0 && removed.length === 0) return false;

        // Keep the objects we already had, so sizes and open tabs still
        // point at the same entries.
        entries = result.entries.map((entry) => known.get(entry.path) ?? entry);
        truncated = result.truncated;
        removed.forEach((entry) => index.remove(entry.path));
        onChange('folder');
        buildIndex(added);
        return true;
    };

    return {
        open,
        openHandle,
        restore,
        resume,
        close,
        refresh,
        search: (query) => index.search(query),
        indexPut: (entry, text) => {
            if (entry?.root && entry.root === key) index.put(entry, text);
        },
        entries: () => entries,
        truncated: () => truncated,
        isOpen: () => directory !== null,
        key: () => key,
        handle: () => directory,
        name: () => directory?.name ?? pending?.name ?? null,
        pending: () => pending,
        entryByPath: (path) => entries.find((entry) => entry.path === path) ?? null,
        // Any file under the folder by relative path, listed or not — images,
        // for instance, are never in the list.
        fileAt: (path) => (directory ? files.fileAt(directory, path) : Promise.reject(new Error('no folder')))
    };
};

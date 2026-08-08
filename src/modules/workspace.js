// The workspace: what is open, which file is being edited, and where edits go.
//
// Three modes, deliberately distinct:
//   - 'scratch' : nothing opened; a buffer kept in localStorage (works in every
//                 browser, including the ones without the File System Access API)
//   - 'file'    : one file opened directly; it IS the document
//   - 'folder'  : a library to browse and search; the selected file is the
//                 document
//
// In both disk modes edits are written back to the file, debounced. Modes 'file'
// and 'folder' differ only in what surrounds the document — the read/write path
// is the same, which is why a single file is represented as the same entry shape
// the folder walk produces rather than as a folder of one.
//
// The save dot in the header tells which state the buffer is in rather than
// claiming "all changes saved" the way a cloud editor would.

import * as files from './files.js';
import { createIndex } from './search.js';
import { read, write, remove, KEYS, debounce } from './storage.js';
import { t } from './strings.js';

const DISK_SAVE_DELAY = 700;
const SCRATCH_SAVE_DELAY = 300;

export const create = ({ onFilesChanged, onFileOpened, onDirtyChanged, onError }) => {
    const index = createIndex();

    let directory = null;
    let entries = [];
    let current = null; // the open file entry, or null in scratch mode
    let dirty = false;

    const mode = () => (directory ? 'folder' : current ? 'file' : 'scratch');

    const setDirty = (next) => {
        if (dirty === next) return;
        dirty = next;
        onDirtyChanged(next);
    };

    // ----- saving -----

    const saveToDisk = debounce(async (text) => {
        if (!current) return;
        try {
            const { size } = await files.writeFile(current, text);
            current.size = size;
            index.put(current, text);
            setDirty(false);
            onFilesChanged(entries);
        } catch (error) {
            onError(t.writeFileFailed);
        }
    }, DISK_SAVE_DELAY);

    // Each document tool keeps its own scratch buffer. Sharing one would mean
    // switching to the JSON tool hands it whatever Markdown you were writing
    // and reports it as broken JSON.
    let scratchKind = 'markdown';
    const scratchKey = (kind) => `${KEYS.content}:${kind}`;

    const saveScratch = debounce((text) => {
        write(scratchKey(scratchKind), text);
        setDirty(false);
    }, SCRATCH_SAVE_DELAY);

    const readScratch = (kind) => read(scratchKey(kind), null);

    // Buffers used to live under one un-suffixed key. Move it across once so an
    // existing document survives the split into per-tool buffers.
    const migrateLegacyScratch = () => {
        const legacy = read(KEYS.content, null);
        if (legacy !== null && readScratch('markdown') === null) {
            write(scratchKey('markdown'), legacy);
        }
        remove(KEYS.content);
    };
    migrateLegacyScratch();

    const recordEdit = (text) => {
        setDirty(true);
        if (current) {
            saveToDisk(text);
        } else {
            saveScratch(text);
        }
    };

    // ----- opening -----

    const openEntry = async (entry) => {
        try {
            const { text, size } = await files.readFile(entry);
            entry.size = size;
            current = entry;
            index.put(entry, text);
            onFileOpened({ entry, text });
            setDirty(false);
            onFilesChanged(entries);
        } catch (error) {
            onError(t.readFileFailed);
        }
    };

    // Read every file once so search has something to work with. Done after the
    // first file is on screen so the editor is usable immediately.
    const buildIndex = async () => {
        for (const entry of entries) {
            if (entry === current) continue;
            try {
                const { text, size } = await files.readFile(entry);
                entry.size = size;
                index.put(entry, text);
            } catch (error) {
                // A file that cannot be read is simply not searchable.
            }
        }
        onFilesChanged(entries);
    };

    const adoptDirectory = async (handle) => {
        directory = handle;
        entries = await files.listMarkdownFiles(handle);
        index.clear();
        onFilesChanged(entries);

        if (entries.length === 0) {
            current = null;
            onError(t.folderEmpty);
            return;
        }

        await openEntry(entries[0]);
        buildIndex();
    };

    // One file, no library around it. The rail falls back to the outline of
    // what is open, which is all there is to navigate.
    const adoptFile = async (handle) => {
        directory = null;
        entries = [];
        index.clear();
        // openEntry announces both the file and the (now empty) file list, so
        // the chrome never paints a half-switched state.
        await openEntry(files.entryForFile(handle));
    };

    // Shared by the recent list and by dropping something on the window: both
    // arrive holding a handle that may not be authorised yet.
    const adopt = async (handle) => {
        if (!(await files.ensurePermission(handle))) {
            onError(t.permissionDenied);
            return;
        }
        await files.remember(handle);
        if (handle.kind === 'file') {
            await adoptFile(handle);
        } else {
            await adoptDirectory(handle);
        }
    };

    // AbortError means the user dismissed the picker; that is not a failure
    // worth reporting.
    const runPicker = async (pick, adoptPicked, failure) => {
        try {
            await adoptPicked(await pick());
        } catch (error) {
            if (error?.name !== 'AbortError') {
                onError(failure);
            }
        }
    };

    const openFolder = () =>
        runPicker(files.pickDirectory, adoptDirectory, t.openFolderFailed);

    const openFile = () => runPicker(files.pickFile, adoptFile, t.openFileFailed);

    const openHandle = async (handle) => {
        try {
            await adopt(handle);
        } catch (error) {
            onError(handle.kind === 'file' ? t.openFileFailed : t.openFolderFailed);
        }
    };

    // A remembered handle can outlive the thing it points at. Rather than
    // reporting a generic failure every time, drop the record so the list
    // reflects what is actually still there.
    const reopenRecent = async (record) => {
        try {
            if (!(await files.ensurePermission(record.handle))) {
                onError(t.permissionDenied);
                return;
            }
            // openEntry reports its own read failures, so a file that has been
            // moved or deleted would arrive as a vague "read failed". Touching
            // it first lets the record be cleaned up instead.
            if (record.kind === 'file') {
                await record.handle.getFile();
            }
            await adopt(record.handle);
        } catch (error) {
            if (error?.name === 'NotFoundError') {
                await files.forget(record.id);
                onError(t.entryGone);
                return;
            }
            onError(record.kind === 'file' ? t.openFileFailed : t.openFolderFailed);
        }
    };

    // Step back from the open file without closing the library around it. Used
    // when a utility hands a produced document to the editor: that text is a
    // new scratch buffer, and leaving the file attached would send it to disk
    // on the next autosave.
    const detach = () => {
        if (!current) return;
        current = null;
        setDirty(false);
        onFilesChanged(entries);
    };

    const close = (scratchText) => {
        directory = null;
        entries = [];
        current = null;
        index.clear();
        onFilesChanged(entries);
        onFileOpened({ entry: null, text: scratchText ?? readScratch(scratchKind) ?? null });
        setDirty(false);
    };

    return {
        openFolder,
        openFile,
        openHandle,
        reopenRecent,
        detach,
        close,
        openEntry,
        recordEdit,
        search: (query) => index.search(query),
        mode,
        isFolderOpen: () => directory !== null,
        // True whenever edits go to disk rather than to the scratch buffer.
        isDocumentOpen: () => current !== null,
        folderName: () => directory?.name ?? null,
        // What the recent list should mark as current.
        openHandleRef: () => directory ?? current?.handle ?? null,
        entries: () => entries,
        currentPath: () => current?.path ?? null,
        currentEntry: () => current,
        // Force a write now, bypassing the debounce — used by ⌘S.
        flush: (text) => {
            if (current) {
                saveToDisk(text);
                saveToDisk.flush();
            } else {
                saveScratch.cancel();
                write(scratchKey(scratchKind), text);
                setDirty(false);
            }
        },

        // Switch which scratch buffer is live, persisting the outgoing one
        // first. Returns the incoming buffer's text.
        switchScratch: (kind, currentText, fallback) => {
            if (!current) {
                saveScratch.cancel();
                write(scratchKey(scratchKind), currentText);
            }
            scratchKind = kind;
            setDirty(false);
            return readScratch(kind) ?? fallback;
        },

        scratchKind: () => scratchKind,

        // The buffer to show on first paint for a given tool.
        initialScratch: (kind, fallback) => {
            scratchKind = kind;
            return readScratch(kind) ?? fallback;
        }
    };
};

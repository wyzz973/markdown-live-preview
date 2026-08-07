// The folder workspace: which folder is open, which file is being edited, and
// where edits are saved.
//
// Two storage modes, deliberately distinct:
//   - no folder open -> a scratch buffer kept in localStorage (works in every
//     browser, including the ones without the File System Access API)
//   - folder open    -> the open file IS the document; edits are written back
//     to disk, debounced
//
// The save dot in the header tells which state the buffer is in rather than
// claiming "all changes saved" the way a cloud editor would.

import * as files from './files.js';
import { createIndex } from './search.js';
import { read, write, KEYS, debounce } from './storage.js';
import { t } from './strings.js';

const DISK_SAVE_DELAY = 700;
const SCRATCH_SAVE_DELAY = 300;

export const create = ({ onFilesChanged, onFileOpened, onDirtyChanged, onError }) => {
    const index = createIndex();

    let directory = null;
    let entries = [];
    let current = null; // the open file entry, or null in scratch mode
    let dirty = false;

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

    const openFolder = async () => {
        try {
            const handle = await files.pickDirectory();
            await adoptDirectory(handle);
        } catch (error) {
            // AbortError means the user dismissed the picker; that is not a
            // failure worth reporting.
            if (error?.name !== 'AbortError') {
                onError(t.openFolderFailed);
            }
        }
    };

    const reopenFolder = async (handle) => {
        try {
            if (!(await files.ensurePermission(handle))) {
                onError(t.permissionDenied);
                return;
            }
            await files.remember(handle);
            await adoptDirectory(handle);
        } catch (error) {
            onError(t.openFolderFailed);
        }
    };

    const closeFolder = (scratchText) => {
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
        reopenFolder,
        closeFolder,
        openEntry,
        recordEdit,
        search: (query) => index.search(query),
        isFolderOpen: () => directory !== null,
        folderName: () => directory?.name ?? null,
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

        scratchKind: () => scratchKind
    };
};

// The open documents: what the tab strip shows and where every edit goes.
//
// Each open document owns its own editor model — and with it its own undo
// stack, cursor and dirty state — and, more importantly, its own save queue.
// The single-buffer design this replaces debounced "write the buffer to
// whichever file is current". Opening another file inside that window wrote
// the first file's text into the second one on disk.
//
// This module is headless. The editor, the disk and the scratch storage come in
// as adapters, which is what lets the save pipeline be tested without Monaco or
// a real file system.
//
// Dirty means "the model's alternative version id differs from the one last
// written": typing makes a document dirty, and undoing back to the saved text
// makes it clean again, the way the editors people already know behave.

const DEFAULT_DELAYS = { file: 700, scratch: 300 };
const CLOSED_LIMIT = 20;

export const create = ({
    models,
    disk,
    scratch,
    titleOf = () => '',
    delays = DEFAULT_DELAYS,
    timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id) },
    newId = () => crypto.randomUUID()
}) => {
    const docs = new Map();
    let order = [];
    let activeId = null;
    // Most recently used first; decides which tab takes over when one closes.
    let mru = [];
    const closed = [];
    const listeners = new Set();
    // Bumped by every temporary open; an older one still reading its file
    // when a newer one starts gives way instead of landing on top of it.
    let previewRun = 0;

    const emit = (type, doc = null, extra = {}) => {
        listeners.forEach((listener) => listener({ type, doc, ...extra }));
    };

    const list = () => order.map((id) => docs.get(id));

    const isDirty = (doc) =>
        Boolean(doc?.model) && doc.model.getAlternativeVersionId() !== doc.savedVersion;

    // A file whose latest text has not reached the disk yet, or cannot.
    const isUnsafe = (doc) =>
        doc.kind === 'file' &&
        (isDirty(doc) || doc.saving !== null || doc.timer !== null || doc.conflict !== null);

    const refreshDirty = (doc) => {
        const dirty = isDirty(doc);
        if (dirty !== doc.lastDirty) {
            doc.lastDirty = dirty;
            emit('state', doc);
        }
    };

    const refreshTitle = (doc) => {
        if (doc.kind !== 'scratch' || !doc.model) return;
        const title = titleOf(doc.model.getValue(), doc.type) || '';
        if (title !== doc.title) {
            doc.title = title;
            emit('state', doc);
        }
    };

    // ----- saving -----

    const clearTimer = (doc) => {
        if (doc.timer !== null) {
            timers.clear(doc.timer);
            doc.timer = null;
        }
    };

    // Scratch text lives in local storage, which is synchronous — so a scratch
    // document can always be flushed, even from an unload handler.
    const writeScratch = (doc) => {
        clearTimer(doc);
        if (!doc.model) return true;
        const version = doc.model.getAlternativeVersionId();
        // Local storage refuses once its quota is full. The text is still in
        // the editor, so the document stays dirty and the caller is told.
        if (scratch.write(doc.scratchId, doc.model.getValue()) === false) {
            const error = Object.assign(new Error('scratch storage full'), { name: 'QuotaExceededError' });
            if (doc.error?.name !== error.name) {
                doc.error = error;
                emit('error', doc, { error });
            }
            return false;
        }
        doc.error = null;
        doc.savedVersion = version;
        refreshDirty(doc);
        return true;
    };

    // Resolves true once the model's text as of the call is on disk (or needed
    // no writing), false when it could not be written — a conflict, a missing
    // file, a failed write. Writes to one file never overlap: a save requested
    // while another is in flight waits for it, then writes whatever is newer.
    const writeFile = (doc) => {
        clearTimer(doc);
        if (doc.state !== 'ready' || !doc.model || doc.conflict) return Promise.resolve(false);
        if (doc.saving) return doc.saving.then(() => writeFile(doc));

        const version = doc.model.getAlternativeVersionId();
        if (version === doc.savedVersion) return Promise.resolve(true);
        const text = doc.model.getValue();
        // Monotonic, unlike the alternative id (undo walks that one back), so
        // a hot-exit backup can tell whether this write is newer than itself.
        const versionId = doc.model.getVersionId?.() ?? 0;

        const attempt = async () => {
            try {
                // Someone else may have written the file since we last did.
                // Compare contents as well as timestamps, so a file that was
                // merely touched is not reported as a conflict.
                const stat = await disk.stat(doc.entry);
                if (doc.diskModifiedAt !== null && stat.modifiedAt !== doc.diskModifiedAt) {
                    const current = await disk.read(doc.entry);
                    if (current.text !== doc.baseText) {
                        doc.conflict = { text: current.text, modifiedAt: current.modifiedAt };
                        emit('conflict', doc);
                        return false;
                    }
                }

                const result = await disk.write(doc.entry, text);
                doc.diskModifiedAt = result.modifiedAt;
                doc.size = result.size;
                doc.baseText = text;
                doc.savedVersion = version;
                doc.error = null;
                emit('saved', doc, { text, versionId });
                return true;
            } catch (error) {
                if (error?.name === 'NotFoundError') {
                    doc.state = 'missing';
                }
                doc.error = error;
                emit('error', doc, { error });
                return false;
            }
        };

        // Cleared inside the chain rather than in a `finally` of the attempt,
        // so anyone waiting on this promise already sees the slot free.
        const run = attempt().then((ok) => {
            doc.saving = null;
            refreshDirty(doc);
            emit('state', doc);
            return ok;
        });
        doc.saving = run;
        return run;
    };

    const save = (doc) =>
        doc.kind === 'scratch' ? Promise.resolve(writeScratch(doc)) : writeFile(doc);

    const scheduleSave = (doc) => {
        clearTimer(doc);
        doc.timer = timers.set(
            () => {
                doc.timer = null;
                save(doc);
            },
            doc.kind === 'scratch' ? delays.scratch : delays.file
        );
    };

    // ----- models -----

    const attachModel = (doc, text) => {
        doc.model = models.create(text, doc.type);
        doc.savedVersion = doc.model.getAlternativeVersionId();
        doc.lastDirty = false;
        doc.subscription = doc.model.onDidChangeContent(() => {
            if (doc.suppress) return;
            // Editing a temporary tab keeps it: the change has earned a slot.
            if (doc.preview) {
                doc.preview = false;
                emit('state', doc);
            }
            refreshDirty(doc);
            refreshTitle(doc);
            emit('content', doc);
            scheduleSave(doc);
        });
        refreshTitle(doc);
    };

    const detachModel = (doc) => {
        clearTimer(doc);
        doc.subscription?.dispose();
        doc.subscription = null;
        if (doc.model) {
            models.dispose(doc.model);
            doc.model = null;
        }
    };

    // Replace a model's whole text without it counting as the user's edit. The
    // replacement is still an undoable step in the editor.
    const replaceText = (doc, text) => {
        doc.suppress = true;
        try {
            models.replace(doc.model, text);
        } finally {
            doc.suppress = false;
        }
        doc.savedVersion = doc.model.getAlternativeVersionId();
        refreshTitle(doc);
        refreshDirty(doc);
        emit('content', doc);
    };

    // ----- building documents -----

    const blankDoc = (fields) => ({
        id: newId(),
        kind: 'file',
        type: 'markdown',
        key: '',
        entry: null,
        scratchId: null,
        title: '',
        // A fixed name for a scratch document that stands in for a file (a
        // copy of a dropped file, say); otherwise the title comes from the text.
        label: '',
        model: null,
        savedVersion: 0,
        lastDirty: false,
        baseText: '',
        diskModifiedAt: null,
        size: null,
        preview: false,
        state: 'ready',
        conflict: null,
        saving: null,
        timer: null,
        error: null,
        suppress: false,
        subscription: null,
        unlocking: null,
        view: {},
        ...fields
    });

    const setActive = (id) => {
        if (id !== null && !docs.has(id)) return;
        if (activeId === id) return;
        activeId = id;
        if (id !== null) {
            mru = [id, ...mru.filter((other) => other !== id)];
        }
        emit('active', id === null ? null : docs.get(id));
    };

    const insert = (doc, { index, activate = true } = {}) => {
        docs.set(doc.id, doc);
        const fallback = activeId && order.includes(activeId) ? order.indexOf(activeId) + 1 : order.length;
        const at = Math.max(0, Math.min(index ?? fallback, order.length));
        order.splice(at, 0, doc.id);
        emit('list', doc);
        if (activate) setActive(doc.id);
        return doc;
    };

    const findByKey = (key) => list().find((doc) => doc.key === key) ?? null;

    const findSameFile = async (handle) => {
        if (!handle) return null;
        for (const doc of list()) {
            if (doc.kind !== 'file' || !doc.entry?.handle?.isSameEntry) continue;
            try {
                if (await doc.entry.handle.isSameEntry(handle)) return doc;
            } catch (error) {
                // A handle the browser can no longer resolve is not a match.
            }
        }
        return null;
    };

    const previewSlot = () => list().find((doc) => doc.preview && !isDirty(doc)) ?? null;

    // Swap one tab for another in the same position without passing through
    // a third: replacing the active temporary tab must not flash whichever tab
    // was used before it.
    const replaceSlot = (old, doc, { activate }) => {
        const at = order.indexOf(old.id);
        const wasActive = activeId === old.id;
        detachModel(old);
        docs.delete(old.id);
        mru = mru.filter((id) => id !== old.id);
        docs.set(doc.id, doc);
        order[at] = doc.id;
        emit('list', doc, { replaced: old });
        if (activate || wasActive) {
            activeId = null;
            setActive(doc.id);
        }
        return doc;
    };

    // Open a file, or bring it forward if it already has a tab. A temporary
    // (preview) open reuses the existing temporary tab's slot, so browsing a
    // folder by clicking through it does not pile up a tab per click.
    const openFile = async (entry, { key, type, preview = false, activate = true, index } = {}) => {
        const run = preview ? ++previewRun : null;
        const superseded = () => run !== null && run !== previewRun;

        const existing = (key && findByKey(key)) || (await findSameFile(entry.handle));
        if (superseded()) return null;
        if (existing) {
            if (!preview && existing.preview) {
                existing.preview = false;
                emit('state', existing);
            }
            // Reached by another route (the rail, ⌘O, the recent list): that
            // route holds a live handle, so the placeholder unlocks with it.
            if (existing.state === 'locked') {
                await unlock(existing.id, entry);
            }
            if (activate) setActive(existing.id);
            return existing;
        }

        const { text, modifiedAt, size } = await disk.read(entry);
        // Clicking through a folder quickly: the file clicked last is the one
        // that ends up in the temporary tab, whichever read finished first.
        if (superseded()) return null;
        // The same file may have been opened by another call meanwhile.
        const opened = key ? findByKey(key) : null;
        if (opened) {
            if (activate) setActive(opened.id);
            return opened;
        }
        const doc = blankDoc({
            kind: 'file',
            type,
            key: key ?? `file:${newId()}`,
            entry,
            baseText: text,
            diskModifiedAt: modifiedAt,
            size,
            preview
        });
        attachModel(doc, text);

        const slot = preview && index === undefined ? previewSlot() : null;
        const inserted = slot ? replaceSlot(slot, doc, { activate }) : insert(doc, { index, activate });
        emit('loaded', doc);
        return inserted;
    };

    // A tab restored from a previous session before the browser has granted
    // access again. It keeps its place and its name; the text arrives when
    // `unlock` runs from a user gesture.
    const addLocked = (entry, { key, type, index, activate = false } = {}) => {
        const doc = blankDoc({ kind: 'file', type, key, entry, state: 'locked' });
        return insert(doc, { index, activate });
    };

    // `entry` replaces the placeholder's own when the caller has found the
    // file again (a folder walk hands back fresh handles).
    // Concurrent calls (the banner's button and a click on the tab) share
    // one read, so the document never ends up with two models.
    const unlock = (id, entry = null) => {
        const doc = docs.get(id);
        if (!doc || doc.state !== 'locked') return Promise.resolve(doc ?? null);
        if (doc.unlocking) return doc.unlocking;
        if (entry) doc.entry = entry;
        doc.unlocking = (async () => {
            try {
                const { text, modifiedAt, size } = await disk.read(doc.entry);
                if (!docs.has(id) || doc.state !== 'locked') return doc;
                doc.baseText = text;
                doc.diskModifiedAt = modifiedAt;
                doc.size = size;
                doc.state = 'ready';
                attachModel(doc, text);
                emit('state', doc);
                emit('loaded', doc);
                if (activeId === id) emit('active', doc);
                return doc;
            } finally {
                doc.unlocking = null;
            }
        })();
        return doc.unlocking;
    };

    const openScratch = ({ type, text = '', scratchId = newId(), label = '', index, activate = true } = {}) => {
        const doc = blankDoc({ kind: 'scratch', type, key: `scratch:${scratchId}`, scratchId, label });
        attachModel(doc, text);
        // Persisted from the moment it exists, so a tab that is opened and
        // never typed in still survives a reload. If storage refuses (a large
        // paste into a full quota) the tab starts out unsaved rather than
        // pretending the text is kept.
        const stored = scratch.write(scratchId, text) !== false;
        if (!stored) {
            doc.savedVersion = -1;
            doc.lastDirty = true;
            doc.error = Object.assign(new Error('scratch storage full'), { name: 'QuotaExceededError' });
        }
        insert(doc, { index, activate });
        if (!stored) emit('error', doc, { error: doc.error });
        return doc;
    };

    // ----- closing -----

    const removeDoc = (doc) => {
        const at = order.indexOf(doc.id);
        closed.unshift({
            kind: doc.kind,
            type: doc.type,
            key: doc.key,
            entry: doc.entry,
            scratchId: doc.scratchId,
            title: doc.title,
            label: doc.label,
            index: at
        });
        // A closed scratch document keeps its text only while it can still
        // be reopened.
        while (closed.length > CLOSED_LIMIT) {
            const dropped = closed.pop();
            if (dropped.kind === 'scratch') scratch.remove(dropped.scratchId);
        }

        detachModel(doc);
        docs.delete(doc.id);
        order = order.filter((id) => id !== doc.id);
        mru = mru.filter((id) => id !== doc.id);
        emit('list', doc, { removed: true });

        if (activeId === doc.id) {
            activeId = null;
            const next = mru.find((id) => docs.has(id)) ?? order[Math.min(at, order.length - 1)];
            if (next) {
                setActive(next);
            } else {
                emit('active', null);
            }
        }
    };

    // Close a tab. Its latest text is written first; if that fails the tab
    // stays open and the caller learns why, rather than the edit vanishing
    // along with the tab.
    const close = async (id, { force = false } = {}) => {
        const doc = docs.get(id);
        if (!doc) return { ok: true };

        if (doc.kind === 'scratch') {
            // Its only copy is the editor's when storage is full.
            if (!writeScratch(doc) && !force) return { ok: false, doc, reason: 'storage' };
        } else if (!force) {
            if (doc.state === 'ready') {
                const ok = await writeFile(doc);
                if (!ok || isDirty(doc)) {
                    return { ok: false, doc, reason: doc.conflict ? 'conflict' : 'error' };
                }
            } else if (doc.state === 'missing' && isDirty(doc)) {
                return { ok: false, doc, reason: 'missing' };
            }
        }

        removeDoc(doc);
        return { ok: true, doc };
    };

    const reopenClosed = async () => {
        const record = closed.shift();
        if (!record) return null;
        if (record.kind === 'scratch') {
            const text = scratch.read(record.scratchId) ?? '';
            return openScratch({
                type: record.type,
                text,
                scratchId: record.scratchId,
                label: record.label,
                index: record.index
            });
        }
        try {
            return await openFile(record.entry, {
                key: record.key,
                type: record.type,
                index: record.index
            });
        } catch (error) {
            return null;
        }
    };

    // ----- external changes -----

    // Look at the file on disk. A clean document quietly picks up the new
    // text; a document with unsaved edits is put into conflict rather than
    // either side being thrown away.
    const checkDisk = async (id) => {
        const doc = docs.get(id);
        if (!doc || doc.kind !== 'file' || doc.saving || doc.conflict) return 'skipped';
        if (doc.state !== 'ready' && doc.state !== 'missing') return 'skipped';

        let stat;
        try {
            stat = await disk.stat(doc.entry);
        } catch (error) {
            if (error?.name === 'NotFoundError' && doc.state !== 'missing') {
                doc.state = 'missing';
                emit('state', doc);
                return 'missing';
            }
            return 'skipped';
        }

        // Back again — a branch switched back, a folder restored. The text on
        // disk is compared below like any other change.
        const recovered = doc.state === 'missing';
        if (recovered) {
            doc.state = 'ready';
            doc.error = null;
            emit('state', doc);
        } else if (stat.modifiedAt === doc.diskModifiedAt) {
            return 'unchanged';
        }

        let current;
        try {
            current = await disk.read(doc.entry);
        } catch (error) {
            return 'skipped';
        }
        // The document may have been closed or saved while the disk was read.
        if (!docs.has(id) || doc.saving) return 'skipped';
        if (current.text === doc.baseText) {
            doc.diskModifiedAt = current.modifiedAt;
            // Edits that could not be written while the file was gone.
            if (recovered && isDirty(doc)) scheduleSave(doc);
            return recovered ? 'recovered' : 'unchanged';
        }

        if (isDirty(doc) || doc.timer !== null) {
            clearTimer(doc);
            doc.conflict = { text: current.text, modifiedAt: current.modifiedAt };
            emit('conflict', doc);
            emit('state', doc);
            return 'conflict';
        }

        doc.baseText = current.text;
        doc.diskModifiedAt = current.modifiedAt;
        doc.size = current.size;
        replaceText(doc, current.text);
        emit('reloaded', doc);
        return 'reloaded';
    };

    const checkAll = async () => {
        const results = [];
        for (const doc of list()) {
            results.push(await checkDisk(doc.id));
        }
        return results;
    };

    // Settle a conflict. 'disk' takes the version on disk (the replacement is
    // still undoable in the editor); 'mine' writes the editor's text over it.
    const resolve = async (id, choice) => {
        const doc = docs.get(id);
        if (!doc?.conflict) return false;
        const { text, modifiedAt } = doc.conflict;
        doc.conflict = null;
        doc.baseText = text;
        doc.diskModifiedAt = modifiedAt;

        if (choice === 'disk') {
            replaceText(doc, text);
            emit('state', doc);
            return true;
        }

        // Force the write even when the model happens to match its last saved
        // version: the point is to put this text back on disk.
        doc.savedVersion = -1;
        const ok = await writeFile(doc);
        emit('state', doc);
        return ok;
    };

    // ----- ordering -----

    const move = (id, index) => {
        if (!order.includes(id)) return;
        const next = order.filter((other) => other !== id);
        next.splice(Math.max(0, Math.min(index, next.length)), 0, id);
        order = next;
        emit('list', docs.get(id));
    };

    const pin = (id) => {
        const doc = docs.get(id);
        if (!doc || !doc.preview) return;
        doc.preview = false;
        emit('state', doc);
    };

    // Turn a scratch document into a file once its text has been written
    // somewhere. `version` is the model version that text came from, so edits
    // made while the save dialog was open still count as unsaved.
    const adoptFile = (id, entry, { key, text, modifiedAt, size, version }) => {
        const doc = docs.get(id);
        if (!doc) return null;
        const scratchId = doc.scratchId;
        doc.kind = 'file';
        doc.key = key;
        doc.entry = entry;
        doc.scratchId = null;
        doc.title = '';
        doc.baseText = text;
        doc.diskModifiedAt = modifiedAt;
        doc.size = size;
        doc.savedVersion = version;
        doc.lastDirty = isDirty(doc);
        if (scratchId) scratch.remove(scratchId);
        emit('state', doc);
        emit('list', doc);
        if (isDirty(doc)) scheduleSave(doc);
        return doc;
    };

    // ----- hot exit -----

    // A file write is asynchronous and a page that is going away does not wait
    // for it: reload within the save delay and the last edits were lost. So on
    // the way out every file with unwritten text is also backed up
    // synchronously (see main.js), together with the disk version it was
    // edited from.
    const backups = () =>
        list()
            .filter((doc) => doc.kind === 'file' && doc.model && (isDirty(doc) || doc.conflict))
            .map((doc) => ({
                key: doc.key,
                text: doc.model.getValue(),
                base: doc.diskModifiedAt,
                docId: doc.id,
                version: doc.model.getVersionId?.() ?? 0
            }));

    // Put a backed-up text back into its reopened document, as unsaved work.
    // If the file on disk has changed since the backup was taken, the two
    // meet as a conflict instead of one silently replacing the other.
    const restoreBackup = (id, { text, base }) => {
        const doc = docs.get(id);
        if (!doc?.model || doc.kind !== 'file' || text === doc.model.getValue()) return false;
        doc.suppress = true;
        try {
            models.replace(doc.model, text);
        } finally {
            doc.suppress = false;
        }
        if (base !== doc.diskModifiedAt) {
            doc.conflict = { text: doc.baseText, modifiedAt: doc.diskModifiedAt };
            emit('conflict', doc);
        } else {
            scheduleSave(doc);
        }
        refreshDirty(doc);
        emit('content', doc);
        emit('state', doc);
        return true;
    };

    // Give a tab a new identity — used when a file from a folder that is no
    // longer open stays open on its own.
    const rebind = (id, { entry, key }) => {
        const doc = docs.get(id);
        if (!doc) return null;
        doc.entry = entry;
        doc.key = key;
        emit('state', doc);
        emit('list', doc);
        return doc;
    };

    // Write everything that is waiting. Used before a folder closes, when the
    // page is hidden and when it is about to unload.
    const flushAll = () => Promise.all(list().map((doc) => save(doc)));

    // The synchronous half of flushAll, for `pagehide`: scratch text can still
    // be written after the page has started to go away; files cannot.
    const flushScratchNow = () => {
        list().forEach((doc) => {
            if (doc.kind === 'scratch') writeScratch(doc);
        });
    };

    return {
        list,
        get: (id) => docs.get(id) ?? null,
        active: () => (activeId ? docs.get(activeId) ?? null : null),
        activeId: () => activeId,
        // Recently used first, then every tab not yet visited this session
        // in strip order — after a reload only the restored tab has been used.
        mru: () => {
            const used = mru.filter((id) => docs.has(id));
            return [...used, ...order.filter((id) => !used.includes(id))].map((id) => docs.get(id));
        },
        closedCount: () => closed.length,
        findByKey,
        isDirty,
        hasUnsaved: () => list().some(isUnsafe),
        // Scratch text that local storage refused: the editor holds the only copy.
        hasUnstoredScratch: () => list().some((doc) => doc.kind === 'scratch' && doc.error),
        rebind,
        openFile,
        openScratch,
        addLocked,
        unlock,
        activate: setActive,
        close,
        reopenClosed,
        move,
        pin,
        save,
        flush: (id) => (docs.has(id) ? save(docs.get(id)) : Promise.resolve(true)),
        flushAll,
        flushScratchNow,
        backups,
        restoreBackup,
        checkDisk,
        checkAll,
        resolve,
        adoptFile,
        replaceText: (id, text) => {
            const doc = docs.get(id);
            if (doc?.model) replaceText(doc, text);
        },
        onChange: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        }
    };
};

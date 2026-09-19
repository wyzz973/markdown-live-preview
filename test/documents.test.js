import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { create } from '../src/modules/documents.js';

let createdModels = 0;

// A stand-in for a Monaco text model: enough surface for the store.
const fakeModels = () => ({
    create(text) {
        createdModels += 1;
        let value = text;
        let version = 1;
        const listeners = new Set();
        const fire = () => listeners.forEach((listener) => listener());
        return {
            getValue: () => value,
            getAlternativeVersionId: () => version,
            getVersionId: () => version,
            onDidChangeContent(listener) {
                listeners.add(listener);
                return { dispose: () => listeners.delete(listener) };
            },
            // Test helpers.
            type(extra) {
                value += extra;
                version += 1;
                fire();
            },
            set(next) {
                value = next;
                version += 1;
                fire();
            }
        };
    },
    dispose() {},
    replace(model, text) {
        model.set(text);
    }
});

// An in-memory disk with a clock, and a way to play "another program".
const fakeDisk = () => {
    let clock = 1000;
    const files = new Map();
    const writes = [];
    let gate = null;
    const notFound = () => Object.assign(new Error('gone'), { name: 'NotFoundError' });
    const disk = {
        files,
        writes,
        put(path, text) {
            clock += 10;
            files.set(path, { text, modifiedAt: clock });
        },
        // Hold every write until the returned function is called.
        hold() {
            let release;
            gate = new Promise((resolve) => {
                release = resolve;
            });
            return () => {
                gate = null;
                release();
            };
        },
        async stat(entry) {
            const file = files.get(entry.path);
            if (!file) throw notFound();
            return { modifiedAt: file.modifiedAt, size: file.text.length };
        },
        async read(entry) {
            const file = files.get(entry.path);
            if (!file) throw notFound();
            return { text: file.text, modifiedAt: file.modifiedAt, size: file.text.length };
        },
        async write(entry, text) {
            if (gate) await gate;
            if (!files.has(entry.path)) throw notFound();
            clock += 10;
            files.set(entry.path, { text, modifiedAt: clock });
            writes.push({ path: entry.path, text });
            return { modifiedAt: clock, size: text.length };
        }
    };
    return disk;
};

const fakeScratch = () => {
    const store = new Map();
    return {
        store,
        read: (id) => (store.has(id) ? store.get(id) : null),
        write: (id, text) => store.set(id, text),
        remove: (id) => store.delete(id)
    };
};

const entry = (path) => ({ name: path.split('/').pop(), dir: '', path, handle: null });

let disk;
let scratch;
let store;
let ids;

// Another store over the same disk: what the page finds after a reload.
const makeStore = () =>
    create({
        models: fakeModels(),
        disk,
        scratch,
        titleOf: (text) => text.match(/^#\s+(.+)$/m)?.[1] ?? '',
        newId: () => `id${(ids += 1)}`
    });

beforeEach(() => {
    vi.useFakeTimers();
    disk = fakeDisk();
    scratch = fakeScratch();
    ids = 0;
    store = makeStore();
    disk.put('a.md', '# A\n');
    disk.put('b.md', '# B\n');
});

afterEach(() => {
    vi.useRealTimers();
});

const open = (path, options = {}) =>
    store.openFile(entry(path), { key: `k:${path}`, type: 'markdown', ...options });

describe('saving', () => {
    it('writes an edit to its own file even when another file opens before the delay runs out', async () => {
        const a = await open('a.md');
        a.model.type('edited');
        await open('b.md');
        await vi.advanceTimersByTimeAsync(1000);

        expect(disk.files.get('a.md').text).toBe('# A\nedited');
        expect(disk.files.get('b.md').text).toBe('# B\n');
    });

    it('marks a document dirty while an edit is waiting and clean once written', async () => {
        const a = await open('a.md');
        a.model.type('x');
        expect(store.isDirty(a)).toBe(true);
        expect(store.hasUnsaved()).toBe(true);
        await vi.advanceTimersByTimeAsync(1000);
        expect(store.isDirty(a)).toBe(false);
        expect(store.hasUnsaved()).toBe(false);
    });

    it('never overlaps two writes to the same file', async () => {
        const a = await open('a.md');
        const release = disk.hold();
        a.model.type('1');
        const first = store.flush(a.id);
        a.model.type('2');
        const second = store.flush(a.id);
        await vi.advanceTimersByTimeAsync(0);
        expect(disk.writes).toHaveLength(0);
        release();
        await Promise.all([first, second]);
        expect(disk.writes.map((write) => write.text)).toEqual(['# A\n1', '# A\n12']);
        expect(store.isDirty(a)).toBe(false);
    });

    it('writes pending edits before a tab closes', async () => {
        const a = await open('a.md');
        a.model.type('last words');
        const result = await store.close(a.id);
        expect(result.ok).toBe(true);
        expect(disk.files.get('a.md').text).toBe('# A\nlast words');
        expect(store.list()).toHaveLength(0);
    });

    it('flushAll writes every waiting document', async () => {
        const a = await open('a.md');
        const b = await open('b.md');
        a.model.type('a');
        b.model.type('b');
        await store.flushAll();
        expect(disk.files.get('a.md').text).toBe('# A\na');
        expect(disk.files.get('b.md').text).toBe('# B\nb');
    });
});

describe('external changes', () => {
    it('reloads a clean document when the file changes on disk', async () => {
        const a = await open('a.md');
        disk.put('a.md', '# A\nfrom elsewhere');
        expect(await store.checkDisk(a.id)).toBe('reloaded');
        expect(a.model.getValue()).toBe('# A\nfrom elsewhere');
        expect(store.isDirty(a)).toBe(false);
    });

    it('does not treat a touched but unchanged file as a change', async () => {
        const a = await open('a.md');
        disk.put('a.md', '# A\n');
        expect(await store.checkDisk(a.id)).toBe('unchanged');
    });

    it('turns unsaved edits plus an outside change into a conflict instead of overwriting', async () => {
        const a = await open('a.md');
        a.model.type('mine');
        disk.put('a.md', '# A\ntheirs');
        await vi.advanceTimersByTimeAsync(1000);

        expect(a.conflict?.text).toBe('# A\ntheirs');
        expect(disk.files.get('a.md').text).toBe('# A\ntheirs');

        // Further typing must not sneak past the conflict either.
        a.model.type('!');
        await vi.advanceTimersByTimeAsync(1000);
        expect(disk.files.get('a.md').text).toBe('# A\ntheirs');
    });

    it('resolves a conflict in favour of the editor', async () => {
        const a = await open('a.md');
        a.model.type('mine');
        disk.put('a.md', '# A\ntheirs');
        await vi.advanceTimersByTimeAsync(1000);
        expect(await store.resolve(a.id, 'mine')).toBe(true);
        expect(disk.files.get('a.md').text).toBe('# A\nmine');
        expect(a.conflict).toBe(null);
    });

    it('resolves a conflict in favour of the disk', async () => {
        const a = await open('a.md');
        a.model.type('mine');
        disk.put('a.md', '# A\ntheirs');
        await vi.advanceTimersByTimeAsync(1000);
        await store.resolve(a.id, 'disk');
        expect(a.model.getValue()).toBe('# A\ntheirs');
        expect(store.isDirty(a)).toBe(false);
    });

    it('keeps a tab open when its edits cannot be written', async () => {
        const a = await open('a.md');
        a.model.type('mine');
        disk.put('a.md', '# A\ntheirs');
        const result = await store.close(a.id);
        expect(result.ok).toBe(false);
        expect(result.reason).toBe('conflict');
        expect(store.list()).toHaveLength(1);
    });

    it('notices a file that was deleted', async () => {
        const a = await open('a.md');
        disk.files.delete('a.md');
        expect(await store.checkDisk(a.id)).toBe('missing');
        expect(a.state).toBe('missing');
    });
});

describe('tabs', () => {
    it('reuses the temporary tab for the next temporary open', async () => {
        await open('a.md', { preview: true });
        const b = await open('b.md', { preview: true });
        expect(store.list().map((doc) => doc.entry.path)).toEqual(['b.md']);
        expect(store.active()).toBe(b);
    });

    it('keeps a temporary tab once it has been edited', async () => {
        const a = await open('a.md', { preview: true });
        a.model.type('x');
        expect(a.preview).toBe(false);
        await open('b.md', { preview: true });
        expect(store.list().map((doc) => doc.entry.path)).toEqual(['a.md', 'b.md']);
    });

    it('brings an already open file forward instead of opening it twice', async () => {
        const a = await open('a.md');
        await open('b.md');
        const again = await open('a.md');
        expect(again).toBe(a);
        expect(store.list()).toHaveLength(2);
        expect(store.active()).toBe(a);
    });

    it('activates the most recently used tab when the active one closes', async () => {
        const a = await open('a.md');
        disk.put('c.md', '# C\n');
        await open('b.md');
        await open('c.md');
        store.activate(a.id);
        await store.close(a.id);
        expect(store.active().entry.path).toBe('c.md');
    });

    it('moves a tab', async () => {
        const a = await open('a.md');
        await open('b.md');
        store.move(a.id, 1);
        expect(store.list().map((doc) => doc.entry.path)).toEqual(['b.md', 'a.md']);
    });

    it('reopens a closed scratch tab with its text', async () => {
        const doc = store.openScratch({ type: 'markdown', text: '# 草稿\n' });
        doc.model.type('内容');
        await store.close(doc.id);
        expect(store.list()).toHaveLength(0);
        const back = await store.reopenClosed();
        expect(back.model.getValue()).toBe('# 草稿\n内容');
        expect(back.title).toBe('草稿');
    });

    it('persists scratch text on its own delay', async () => {
        const doc = store.openScratch({ type: 'markdown', text: '' });
        doc.model.type('hello');
        await vi.advanceTimersByTimeAsync(400);
        expect(scratch.store.get(doc.scratchId)).toBe('hello');
    });
});

describe('races', () => {
    it('shows the file clicked last in the temporary tab, whichever read finishes first', async () => {
        let releaseA;
        const slowRead = disk.read;
        disk.read = async (target) => {
            if (target.path === 'a.md') await new Promise((resolve) => (releaseA = resolve));
            return slowRead(target);
        };
        const first = open('a.md', { preview: true });
        // Let the first open get as far as reading its file.
        while (!releaseA) await Promise.resolve();
        const second = open('b.md', { preview: true });
        await second;
        releaseA();
        expect(await first).toBe(null);
        expect(store.list().map((doc) => doc.entry.path)).toEqual(['b.md']);
        expect(store.active().entry.path).toBe('b.md');
    });

    it('unlocks a restored tab once even when asked twice at the same time', async () => {
        const doc = store.addLocked(entry('a.md'), { key: 'k:a.md', type: 'markdown' });
        const before = createdModels;
        const [one, two] = await Promise.all([store.unlock(doc.id), store.unlock(doc.id)]);
        expect(one).toBe(doc);
        expect(two).toBe(doc);
        expect(doc.state).toBe('ready');
        expect(createdModels - before).toBe(1);
        expect(doc.model.getValue()).toBe('# A\n');
    });
});

describe('hot exit', () => {
    it('backs up text that has not reached the disk and restores it as unsaved work', async () => {
        const a = await open('a.md');
        a.model.type('late');
        const [backup] = store.backups();
        expect(backup.text).toBe('# A\nlate');

        const reloaded = makeStore();
        const again = await reloaded.openFile(entry('a.md'), { key: 'k:a.md', type: 'markdown' });
        expect(reloaded.restoreBackup(again.id, backup)).toBe(true);
        expect(reloaded.isDirty(again)).toBe(true);
        await vi.advanceTimersByTimeAsync(1000);
        expect(disk.files.get('a.md').text).toBe('# A\nlate');
    });

    it('has nothing to back up once everything is written', async () => {
        const a = await open('a.md');
        a.model.type('x');
        await vi.advanceTimersByTimeAsync(1000);
        expect(store.backups()).toEqual([]);
    });

    it('meets a file changed in the meantime as a conflict', async () => {
        const a = await open('a.md');
        a.model.type('late');
        const [backup] = store.backups();
        disk.put('a.md', '# A\nchanged elsewhere');

        const reloaded = makeStore();
        const again = await reloaded.openFile(entry('a.md'), { key: 'k:a.md', type: 'markdown' });
        reloaded.restoreBackup(again.id, backup);
        expect(again.conflict?.text).toBe('# A\nchanged elsewhere');
        expect(again.model.getValue()).toBe('# A\nlate');
        await vi.advanceTimersByTimeAsync(1000);
        expect(disk.files.get('a.md').text).toBe('# A\nchanged elsewhere');
    });
});

describe('scratch storage full', () => {
    const fullStore = () => {
        const refusing = { ...scratch, write: () => false };
        return create({ models: fakeModels(), disk, scratch: refusing, newId: () => `id${(ids += 1)}` });
    };

    it('opens a scratch document that could not be stored as unsaved', () => {
        const full = fullStore();
        const doc = full.openScratch({ type: 'markdown', text: 'a large paste' });
        expect(full.isDirty(doc)).toBe(true);
        expect(full.hasUnstoredScratch()).toBe(true);
    });

    it('refuses to close it, since the editor holds the only copy', async () => {
        const full = fullStore();
        const doc = full.openScratch({ type: 'markdown', text: 'a large paste' });
        const result = await full.close(doc.id);
        expect(result.ok).toBe(false);
        expect(result.reason).toBe('storage');
        expect(full.list()).toHaveLength(1);
    });
});

describe('restored tabs', () => {
    it('unlocks a placeholder with the handle of whichever route reaches it', async () => {
        const placeholder = store.addLocked({ name: 'a.md', dir: '', path: 'a.md', handle: null }, { key: 'k:a.md', type: 'markdown' });
        const events = [];
        store.onChange((event) => events.push(event.type));
        const doc = await open('a.md');
        expect(doc).toBe(placeholder);
        expect(doc.state).toBe('ready');
        expect(doc.model.getValue()).toBe('# A\n');
        expect(events).toContain('loaded');
    });

    it('announces every document whose text came from disk', async () => {
        const loaded = [];
        store.onChange((event) => {
            if (event.type === 'loaded') loaded.push(event.doc.entry.path);
        });
        await open('a.md');
        await open('b.md', { preview: true });
        expect(loaded).toEqual(['a.md', 'b.md']);
    });
});

describe('missing files', () => {
    it('picks a file up again when it comes back', async () => {
        const a = await open('a.md');
        const text = disk.files.get('a.md').text;
        disk.files.delete('a.md');
        expect(await store.checkDisk(a.id)).toBe('missing');
        disk.put('a.md', text);
        expect(await store.checkDisk(a.id)).toBe('recovered');
        expect(a.state).toBe('ready');
    });

    it('writes edits that were held while the file was gone', async () => {
        const a = await open('a.md');
        const text = disk.files.get('a.md').text;
        disk.files.delete('a.md');
        a.model.type('kept');
        await vi.advanceTimersByTimeAsync(1000);
        expect(a.state).toBe('missing');
        disk.put('a.md', text);
        await store.checkDisk(a.id);
        await vi.advanceTimersByTimeAsync(1000);
        expect(disk.files.get('a.md').text).toBe('# A\nkept');
    });

    it('does not let a failing read break the check of every other tab', async () => {
        const a = await open('a.md');
        const b = await open('b.md');
        disk.put('a.md', '# A\nchanged');
        const read = disk.read;
        disk.read = async (target) => {
            if (target.path === 'a.md') throw Object.assign(new Error('busy'), { name: 'NotReadableError' });
            return read(target);
        };
        disk.put('b.md', '# B\nchanged');
        const results = await store.checkAll();
        expect(results).toEqual(['skipped', 'reloaded']);
        expect(b.model.getValue()).toBe('# B\nchanged');
        expect(a.model.getValue()).toBe('# A\n');
    });
});

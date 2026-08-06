// A minimal IndexedDB store, used to keep FileSystemDirectoryHandle objects.
//
// Handles are structured-cloneable, so a folder the user picked once can be
// reopened on a later visit with a single permission click instead of another
// trip through the system file dialog. localStorage cannot hold them — it only
// stores strings — which is why this exists at all.

const DB_NAME = 'markdown-live-preview';
const DB_VERSION = 1;
const STORE = 'handles';

let dbPromise = null;

const open = () => {
    if (dbPromise) {
        return dbPromise;
    }

    dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE)) {
                db.createObjectStore(STORE, { keyPath: 'id' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });

    return dbPromise;
};

const transact = async (mode, run) => {
    const db = await open();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const store = tx.objectStore(STORE);
        const request = run(store);
        tx.oncomplete = () => resolve(request?.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
};

export const putRecord = (record) => transact('readwrite', (store) => store.put(record));

export const deleteRecord = (id) => transact('readwrite', (store) => store.delete(id));

export const allRecords = () => transact('readonly', (store) => store.getAll());

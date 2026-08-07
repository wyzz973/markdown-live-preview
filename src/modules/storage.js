// Namespaced localStorage wrapper. Replaces the storehouse-js git dependency.
//
// Values are stored as JSON so booleans survive a round trip — the old code
// had to defensively normalize 'true' vs true on read because of that.

const NAMESPACE = 'markdown-live-preview';

const key = (name) => `${NAMESPACE}:${name}`;

export const read = (name, fallback = null) => {
    try {
        const raw = localStorage.getItem(key(name));
        return raw === null ? fallback : JSON.parse(raw);
    } catch (error) {
        return fallback;
    }
};

export const write = (name, value) => {
    try {
        localStorage.setItem(key(name), JSON.stringify(value));
    } catch (error) {
        // Quota exceeded or storage disabled (private mode) — losing the
        // autosave is acceptable, breaking the editor is not.
    }
};

export const remove = (name) => {
    try {
        localStorage.removeItem(key(name));
    } catch (error) {
        // ignore
    }
};

export const KEYS = {
    content: 'content',
    scrollSync: 'scroll-sync',
    theme: 'theme',
    splitRatio: 'split-ratio',
    viewMode: 'view-mode',
    railOpen: 'rail-open',
    activeTool: 'active-tool'
};

// Read the persisted theme without pulling in the rest of the app. Used by the
// boot script in index.html to set the theme before first paint.
export const readTheme = () => (read(KEYS.theme) === 'dark' ? 'dark' : 'light');

// Trailing-edge debounce. `flush()` runs a pending call immediately, which is
// what a deliberate save (⌘S) needs — waiting out the timer there would be
// exactly the wrong behaviour.
export const debounce = (fn, wait) => {
    let timer = null;
    let pending = null;

    const debounced = (...args) => {
        pending = args;
        if (timer) {
            clearTimeout(timer);
        }
        timer = setTimeout(() => {
            timer = null;
            const args2 = pending;
            pending = null;
            fn(...args2);
        }, wait);
    };

    debounced.flush = () => {
        if (!timer) {
            return;
        }
        clearTimeout(timer);
        timer = null;
        const args = pending;
        pending = null;
        fn(...args);
    };

    debounced.cancel = () => {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
        pending = null;
    };

    return debounced;
};

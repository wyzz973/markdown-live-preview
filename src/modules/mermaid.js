// Mermaid diagram rendering for the preview pane.
//
// The preview used to rebuild its whole DOM on every keystroke, and with it
// every diagram: each one fell back to its source text and was drawn again, so
// a document with a few charts flickered and jumped while you typed anywhere
// in it. Now the preview keeps unchanged blocks (see preview.js), and this
// module only draws diagrams that are new or whose source changed. Finished
// SVG is cached by theme and source, so switching tabs or undoing an edit
// shows the drawing at once instead of redrawing it.

const CACHE_LIMIT = 200;

let mermaidPromise = null;
let configuredTheme = null;
let counter = 0;
let pass = 0;
const cache = new Map();

// Mermaid is by far the heaviest thing the preview can need, and most documents
// contain no diagrams at all. Load it the first time one actually appears.
const loadMermaid = () => {
    if (!mermaidPromise) {
        mermaidPromise = import('mermaid').then((module) => module.default);
    }
    return mermaidPromise;
};

const configure = (mermaid, theme) => {
    if (configuredTheme === theme) return;
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme });
    configuredTheme = theme;
};

const remember = (key, svg) => {
    cache.delete(key);
    cache.set(key, svg);
    if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
};

const sourceOf = (element) => {
    if (element.dataset.mermaidSource === undefined) {
        element.dataset.mermaidSource = element.textContent;
    }
    return element.dataset.mermaidSource;
};

const showError = (element, error) => {
    element.classList.add('mermaid-error');
    element.textContent = `Mermaid: ${error?.message || String(error)}`;
};

// Draw every diagram in `container` that is not yet drawn in `theme`. A
// diagram being redrawn for a new theme keeps its old drawing until the new
// one is ready, so a theme switch never flashes source text.
export const render = async (container, theme) => {
    if (!container) return;
    const elements = Array.from(container.querySelectorAll('.mermaid')).filter(
        (element) => element.dataset.theme !== theme
    );
    if (elements.length === 0) return;

    const run = ++pass;
    const waiting = [];
    for (const element of elements) {
        const key = `${theme}\n${sourceOf(element)}`;
        const cached = cache.get(key);
        if (cached !== undefined) {
            element.classList.remove('mermaid-error');
            element.innerHTML = cached;
            element.dataset.theme = theme;
        } else {
            waiting.push({ element, key });
        }
    }
    if (waiting.length === 0) return;

    const mermaid = await loadMermaid();
    for (const { element, key } of waiting) {
        // A newer pass owns the preview now; anything left is its job.
        if (run !== pass) return;
        if (!element.isConnected || element.dataset.theme === theme) continue;
        configure(mermaid, theme);
        try {
            counter += 1;
            const { svg, bindFunctions } = await mermaid.render(`mermaid-svg-${counter}`, sourceOf(element));
            remember(key, svg);
            if (!element.isConnected) continue;
            element.classList.remove('mermaid-error');
            element.innerHTML = svg;
            bindFunctions?.(element);
        } catch (error) {
            showError(element, error);
        }
        element.dataset.theme = theme;
    }
};

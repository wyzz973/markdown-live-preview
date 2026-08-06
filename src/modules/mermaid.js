// Mermaid diagram rendering for the preview pane.
//
// Rendering is async and re-triggered on every keystroke, so each pass carries a
// version number: a pass that finds itself superseded stops immediately rather
// than writing stale SVG into the DOM.

let renderVersion = 0;
let renderTimer = null;
let mermaidPromise = null;

// Mermaid is by far the heaviest thing the preview can need, and most documents
// contain no diagrams at all. Load it the first time one actually appears.
const loadMermaid = () => {
    if (!mermaidPromise) {
        mermaidPromise = import('mermaid').then((module) => module.default);
    }
    return mermaidPromise;
};

const configure = (mermaid, theme) => {
    mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme
    });
};

const showError = (element, error) => {
    const message = error?.message || 'Unable to render Mermaid chart.';
    element.classList.add('mermaid-error');
    element.textContent = `Mermaid render error: ${message}`;
};

export const renderNow = async (container, theme) => {
    if (!container) {
        return;
    }

    const elements = Array.from(container.querySelectorAll('.mermaid'));
    if (elements.length === 0) {
        // Still bump the version so a slower in-flight pass from a previous
        // document cannot write its SVG into the now-diagramless preview.
        renderVersion += 1;
        return;
    }

    const version = ++renderVersion;
    const mermaid = await loadMermaid();
    if (version !== renderVersion) {
        return;
    }
    configure(mermaid, theme);

    for (const [index, element] of elements.entries()) {
        if (version !== renderVersion) {
            return;
        }

        // The source is stashed on first render because the element's text is
        // replaced by SVG; a theme switch needs the original back.
        const source = element.dataset.mermaidSource || element.textContent;
        element.dataset.mermaidSource = source;
        element.classList.remove('mermaid-error');

        try {
            const { svg, bindFunctions } = await mermaid.render(
                `mermaid-${version}-${index}`,
                source
            );
            if (version !== renderVersion) {
                return;
            }
            element.innerHTML = svg;
            bindFunctions?.(element);
        } catch (error) {
            showError(element, error);
        }
    }
};

export const scheduleRender = (container, theme, delay = 150) => {
    if (renderTimer) {
        clearTimeout(renderTimer);
    }

    renderTimer = setTimeout(() => {
        renderTimer = null;
        renderNow(container, theme);
    }, delay);
};

export const cancelScheduledRender = () => {
    if (renderTimer) {
        clearTimeout(renderTimer);
        renderTimer = null;
    }
};

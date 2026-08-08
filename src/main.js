import './styles/app.css';

import { defaultDocument, defaultJson } from './default-document.js';
import { t } from './modules/strings.js';
import { read, write, KEYS } from './modules/storage.js';
import * as editorModule from './modules/editor.js';
import * as renderer from './modules/renderer.js';
import * as mermaidRenderer from './modules/mermaid.js';
import * as theme from './modules/theme.js';
import * as layout from './modules/layout.js';
import * as railModule from './modules/rail.js';
import * as toolbarModule from './modules/toolbar.js';
import * as paletteModule from './modules/palette.js';
import * as scrollSync from './modules/scroll-sync.js';
import * as files from './modules/files.js';
import * as workspaceModule from './modules/workspace.js';
import * as toolsRegistry from './modules/tools.js';
import * as jsonTools from './modules/json-tools.js';
import * as jsonToolView from './tools/json-tool.js';
import * as streamTool from './tools/stream-tool.js';
import * as unicodeTool from './tools/unicode-tool.js';
import { toPdf } from './modules/export.js';

const TOAST_MS = 3200;

// Fill every [data-i18n] slot from the strings table so the markup carries no
// copy of its own.
const applyStrings = (root) => {
    root.querySelectorAll('[data-i18n]').forEach((element) => {
        const value = t[element.dataset.i18n];
        if (typeof value === 'string') {
            element.textContent = value;
        }
    });
};

const titleOf = (headings) =>
    headings.find((h) => h.level === 1)?.text || headings[0]?.text || t.untitled;

const init = () => {
    const el = {
        container: document.querySelector('#container'),
        divider: document.querySelector('#split-divider'),
        editorHost: document.querySelector('#editor'),
        preview: document.querySelector('#preview'),
        output: document.querySelector('#output'),
        toolbar: document.querySelector('#toolbar'),
        outline: document.querySelector('#outline'),
        headingCount: document.querySelector('#heading-count'),
        rail: document.querySelector('#rail'),
        railEmpty: document.querySelector('#rail-empty'),
        railToggle: document.querySelector('#rail-toggle'),
        folderButton: document.querySelector('#folder-button'),
        folderName: document.querySelector('#folder-name'),
        folderMenu: document.querySelector('#folder-menu'),
        recentFolders: document.querySelector('#recent-folders'),
        pickFolder: document.querySelector('#pick-folder'),
        closeFolder: document.querySelector('#close-folder'),
        emptyOpen: document.querySelector('#empty-open'),
        modes: document.querySelector('#modes'),
        docTitle: document.querySelector('#doc-title'),
        docSep: document.querySelector('#doc-sep'),
        saveDot: document.querySelector('#save-dot'),
        toolButton: document.querySelector('#tool-button'),
        toolName: document.querySelector('#tool-name'),
        toolMenu: document.querySelector('#tool-menu'),
        jsonHost: document.querySelector('#json-panel-host'),
        utilityHost: document.querySelector('#utility-host'),
        resetButton: document.querySelector('#reset-button'),
        copyButton: document.querySelector('#copy-button'),
        exportButton: document.querySelector('#export-button'),
        searchButton: document.querySelector('#search-button'),
        searchShortcut: document.querySelector('#search-shortcut'),
        searchInput: document.querySelector('#search-input'),
        searchResults: document.querySelector('#search-results'),
        scrim: document.querySelector('#scrim'),
        syncCheckbox: document.querySelector('#sync-scroll-checkbox'),
        themeButton: document.querySelector('#theme-button'),
        toast: document.querySelector('#toast'),
        mobileTabs: Array.from(document.querySelectorAll('.mobile-tab'))
    };

    applyStrings(document);
    el.rail.setAttribute('aria-label', t.railLabel);
    el.searchInput.placeholder = t.searchPlaceholder;

    const isMac = /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);
    el.searchShortcut.textContent = isMac ? '⌘K' : 'Ctrl K';

    theme.init();

    const editor = editorModule.create(el.editorHost);
    editor.getModel()?.updateOptions({ tabSize: 2 });
    editorModule.setTheme(theme.isDark());

    // ----- toast -----

    let toastTimer = null;
    const toast = (message) => {
        el.toast.textContent = message;
        el.toast.hidden = false;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
            el.toast.hidden = true;
        }, TOAST_MS);
    };

    // ----- workspace -----

    // Set while a file is being loaded into the editor, so the resulting
    // change event is not mistaken for the user typing.
    let loading = false;

    // Declared before the workspace so its callbacks can reach it. The rail's
    // own callback reaches the workspace through a closure that only runs on
    // click, by which point both exist.
    const rail = railModule.setup({
        container: el.outline,
        countLabel: el.headingCount,
        preview: el.preview,
        output: el.output,
        onOpenFile: (entry) => workspace.openEntry(entry),
        // Markdown anchors live in the preview; a JSON outline row points at an
        // editor line. Returning false hands the click back to the default
        // preview-scrolling behaviour.
        onNavigate: (heading) => {
            if (docType !== 'json' || heading.line === undefined) {
                return false;
            }
            editor.revealLineInCenter(heading.line);
            editor.setPosition({ lineNumber: heading.line, column: 1 });
            editor.focus();
            return true;
        }
    });

    const workspace = workspaceModule.create({
        onFilesChanged: (entries) => {
            rail.setFiles(entries);
            syncFolderChrome();
        },
        onFileOpened: ({ entry, text }) => {
            loading = true;
            // With a folder open the file is the source of truth: opening
            // config.json moves the whole workbench to the JSON tool.
            const type = entry ? toolsRegistry.toolForFile(entry.name).id : 'markdown';
            if (entry && type !== activeTool) {
                activateTool(type);
            }
            setDocType(type);
            editor.setValue(text ?? defaultDocument);
            editor.revealPosition({ lineNumber: 1, column: 1 });
            loading = false;
            convert(editor.getValue());
            el.preview.scrollTo({ top: 0 });
            rail.setCurrentPath(entry?.path ?? null);
            editor.focus();
        },
        onDirtyChanged: (dirty) => {
            el.saveDot.classList.toggle('dirty', dirty);
            el.saveDot.title = dirty ? t.unsaved : t.saved;
            rail.setDirty(dirty);
        },
        onError: toast
    });

    const toolbar = toolbarModule.setup({
        container: el.toolbar,
        editor,
        jsonOps: {
            format: (text) => jsonTools.format(text),
            minify: (text) => jsonTools.minify(text),
            repair: (text) => jsonTools.repair(text),
            sort: (text) => JSON.stringify(jsonTools.sortKeys(JSON.parse(text)), null, 2),
            escape: (text) => jsonTools.escape(text),
            unescape: (text) => jsonTools.unescape(text),
            toChinese: (text) => jsonTools.unicodeToText(text),
            toUnicode: (text) => jsonTools.textToUnicode(text),
            onError: (error) => toast(t.jsonInvalid(error.message))
        }
    });

    // ----- render pipeline -----
    //
    // One editor, one rail, one preview slot; which renderer and which outline
    // extractor run is decided by the document's type.

    const jsonPanel = jsonToolView.create({
        onOpenInMarkdown: (text) => openScratchMarkdown(text)
    });
    el.jsonHost.appendChild(jsonPanel.root);

    let docType = 'markdown';

    const setDocType = (type) => {
        docType = type;
        el.container.dataset.doctype = type;
        editorModule.setLanguage(editor, type === 'json' ? 'json' : 'markdown');
        toolbar.setDocType(type);
    };

    const convert = (text) => {
        const entry = workspace.currentEntry();

        if (docType === 'json') {
            jsonPanel.update(text);
            rail.setHeadings(jsonTools.outlineFromText(text));
            el.docTitle.textContent = entry ? entry.name : t.toolJson;
            return;
        }

        el.output.innerHTML = renderer.render(text);
        const headings = renderer.outline(el.output);
        rail.setHeadings(headings);
        el.docTitle.textContent = entry ? entry.name : titleOf(headings);
        mermaidRenderer.scheduleRender(el.output, theme.mermaidTheme());
    };

    editor.onDidChangeModelContent(() => {
        const value = editor.getValue();
        convert(value);
        if (!loading) {
            workspace.recordEdit(value);
        }
    });

    // Hand a produced document — a reassembled reply, a generated table — to
    // the Markdown tool as a scratch buffer. The whole point of these tools
    // living in one app is that output flows between them.
    const openScratchMarkdown = (text) => {
        if (!text?.trim()) {
            return;
        }
        activateTool('markdown');
        setDocType('markdown');
        loading = true;
        editor.setValue(text);
        loading = false;
        convert(text);
        workspace.recordEdit(text);
        el.preview.scrollTo({ top: 0 });
    };

    // ----- tools -----

    const utilities = {
        stream: streamTool.create({ onOpenInMarkdown: (text) => openScratchMarkdown(text) }),
        unicode: unicodeTool.create()
    };

    Object.values(utilities).forEach((tool) => {
        tool.root.hidden = true;
        el.utilityHost.appendChild(tool.root);
    });

    let activeTool = 'markdown';
    // Until the first tool is activated there is nothing in the editor, so the
    // activation must load a buffer even when the kind already matches.
    let bootstrapped = false;

    const activateTool = (id, { persist = true } = {}) => {
        const tool = toolsRegistry.byId(id);
        activeTool = tool.id;

        el.container.dataset.workbench = tool.kind;
        el.toolName.textContent = tool.name();

        Object.entries(utilities).forEach(([key, utility]) => {
            utility.root.hidden = key !== tool.id;
        });

        // The document title and save dot belong to the document workbench;
        // a utility has neither a file nor a save state.
        const isDocument = tool.kind === 'document';
        el.docSep.hidden = !isDocument;
        el.docTitle.hidden = !isDocument;
        el.saveDot.hidden = !isDocument;
        el.modes.hidden = !isDocument;
        el.syncCheckbox.closest('.switch').hidden = !isDocument;
        // PDF export renders the Markdown preview; in JSON mode that element
        // is hidden, so the button would produce a blank page.
        el.exportButton.hidden = !isDocument || tool.id === 'json';
        // "阅读" is a prose view; JSON has no such thing.
        el.modes.querySelector('[data-mode="read"]').hidden = tool.id === 'json';
        if (tool.id === 'json' && el.container.dataset.mode === 'read') {
            el.modes.querySelector('[data-mode="split"]').click();
        }
        el.resetButton.hidden = !isDocument;
        // Both act on the editor's document; in a utility they would operate on
        // a buffer that is not on screen, which is worse than being absent.
        el.copyButton.hidden = !isDocument;
        el.searchButton.hidden = !isDocument || !files.isSupported();

        // The narrow-screen tab strip is shared. In a document it switches
        // editor/preview; in a utility it switches input/output — same control,
        // named for whatever it is actually doing.
        el.mobileTabs[0].textContent = isDocument ? t.modeEdit : t.tabInput;
        el.mobileTabs[1].textContent = isDocument ? t.modeRead : t.tabOutput;

        if (isDocument) {
            // With a folder open the open file decides the type; otherwise the
            // tool brings its own scratch buffer forward.
            if (!workspace.isFolderOpen() && (!bootstrapped || workspace.scratchKind() !== tool.id)) {
                const fallback = tool.id === 'json' ? defaultJson : defaultDocument;
                // On first paint the editor is empty; handing that to
                // switchScratch would persist the blank as the outgoing
                // buffer and wipe whatever was saved.
                const text = bootstrapped
                    ? workspace.switchScratch(tool.id, editor.getValue(), fallback)
                    : workspace.initialScratch(tool.id, fallback);
                loading = true;
                setDocType(tool.id);
                editor.setValue(text);
                editor.revealPosition({ lineNumber: 1, column: 1 });
                loading = false;
            } else {
                setDocType(tool.id);
            }
            convert(editor.getValue());
            editor.layout();
            editor.focus();
        } else {
            utilities[tool.id]?.focus?.();
        }

        if (persist) {
            write(KEYS.activeTool, tool.id);
        }
        setToolMenu(false);
    };

    const setToolMenu = (open) => {
        el.toolMenu.hidden = !open;
        el.toolButton.setAttribute('aria-expanded', String(open));
    };

    el.toolMenu.replaceChildren(
        ...toolsRegistry.TOOLS.map((tool) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'tool-item';
            button.setAttribute('role', 'menuitem');
            button.dataset.tool = tool.id;

            const name = document.createElement('span');
            name.className = 'n';
            name.textContent = tool.name();
            const hint = document.createElement('span');
            hint.className = 'h';
            hint.textContent = tool.hint();

            button.append(name, hint);
            button.addEventListener('click', () => activateTool(tool.id));
            return button;
        })
    );

    const syncToolMenuState = () => {
        el.toolMenu.querySelectorAll('.tool-item').forEach((item) => {
            item.setAttribute('aria-current', String(item.dataset.tool === activeTool));
        });
    };

    el.toolButton.addEventListener('click', (event) => {
        event.stopPropagation();
        syncToolMenuState();
        setToolMenu(el.toolMenu.hidden);
    });
    el.toolMenu.addEventListener('click', (event) => event.stopPropagation());
    document.addEventListener('click', () => setToolMenu(false));
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') setToolMenu(false);
    });

    // ----- folder chrome -----

    const syncFolderChrome = () => {
        const open = workspace.isFolderOpen();
        el.folderName.textContent = open ? workspace.folderName() : t.noFolder;
        el.rail.dataset.folder = open ? 'open' : 'empty';
        el.railEmpty.hidden = open;
        el.closeFolder.hidden = !open;

        el.folderButton.title = open
            ? `${workspace.folderName()} · ${t.fileCount(workspace.entries().length)}`
            : t.switchFolder;
    };

    const setMenu = (open) => {
        el.folderMenu.hidden = !open;
        el.folderButton.setAttribute('aria-expanded', String(open));
        if (open) {
            paintRecents();
        }
    };

    const paintRecents = async () => {
        const records = await files.recentFolders();
        if (records.length === 0) {
            const empty = document.createElement('span');
            empty.className = 'menu-empty';
            empty.textContent = t.noRecentFolders;
            el.recentFolders.replaceChildren(empty);
            return;
        }

        el.recentFolders.replaceChildren(
            ...records.map((record) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'menu-item';
                button.setAttribute('role', 'menuitem');
                button.setAttribute('aria-current', String(record.name === workspace.folderName()));

                const name = document.createElement('span');
                name.className = 'name';
                name.textContent = record.name;
                button.appendChild(name);

                button.addEventListener('click', async () => {
                    setMenu(false);
                    await workspace.reopenFolder(record.handle);
                });
                return button;
            })
        );
    };

    if (files.isSupported()) {
        el.folderButton.addEventListener('click', (event) => {
            event.stopPropagation();
            setMenu(el.folderMenu.hidden);
        });
        el.folderMenu.addEventListener('click', (event) => event.stopPropagation());
        document.addEventListener('click', () => setMenu(false));

        const openFolder = async () => {
            setMenu(false);
            await workspace.openFolder();
        };

        el.pickFolder.addEventListener('click', openFolder);
        el.emptyOpen.addEventListener('click', openFolder);
        el.closeFolder.addEventListener('click', () => {
            setMenu(false);
            workspace.closeFolder();
        });
    } else {
        // Firefox and Safari: keep the editor, drop the folder affordances
        // rather than leaving buttons that cannot work.
        el.folderButton.disabled = true;
        el.folderButton.classList.add('unsupported');
        el.pickFolder.hidden = true;
        el.emptyOpen.hidden = true;
        el.searchButton.hidden = true;
    }

    // ----- search -----

    const palette = paletteModule.setup({
        root: el.container,
        input: el.searchInput,
        results: el.searchResults,
        search: (query) => (workspace.isFolderOpen() ? workspace.search(query) : []),
        onOpenHit: async (hit) => {
            await workspace.openEntry(hit.entry);
            editor.revealLineInCenter(hit.line);
            editor.setPosition({ lineNumber: hit.line, column: 1 });
            editor.focus();
        }
    });

    el.searchButton.addEventListener('click', () => {
        if (!workspace.isFolderOpen()) {
            toast(t.searchNeedsFolder);
            return;
        }
        palette.open();
    });

    // ----- toolbar actions -----

    el.resetButton.addEventListener('click', () => {
        if (editor.getValue() !== defaultDocument && !window.confirm(t.resetConfirm)) {
            return;
        }
        editor.setValue(defaultDocument);
        editor.revealPosition({ lineNumber: 1, column: 1 });
        editor.focus();
        el.preview.scrollTo({ top: 0 });
    });

    el.copyButton.addEventListener('click', async () => {
        const label = el.copyButton.querySelector('.label');
        try {
            await navigator.clipboard.writeText(editor.getValue());
            label.textContent = t.copied;
        } catch (error) {
            label.textContent = t.copyFailed;
        }
        setTimeout(() => {
            label.textContent = t.copy;
        }, 1200);
    });

    el.exportButton.addEventListener('click', async () => {
        el.exportButton.disabled = true;
        el.exportButton.textContent = t.exporting;
        try {
            await toPdf({ output: el.output, title: el.docTitle.textContent || t.appName });
        } catch (error) {
            console.error('导出 PDF 失败', error);
            toast(t.exportFailed);
        } finally {
            el.exportButton.disabled = false;
            el.exportButton.textContent = t.exportPdf;
        }
    });

    // ----- theme -----

    const syncThemeButton = (value) => {
        const dark = value === 'dark';
        el.themeButton.setAttribute('aria-pressed', String(dark));
        el.themeButton.title = dark ? t.toThemeLight : t.toThemeDark;
    };

    theme.onChange((value) => {
        syncThemeButton(value);
        editorModule.setTheme(value === 'dark');
        mermaidRenderer.renderNow(el.output, theme.mermaidTheme());
    });
    syncThemeButton(theme.get());

    el.themeButton.addEventListener('click', () => theme.toggle());

    // ----- layout -----

    const relayout = () => editor.layout();

    layout.setupSplit({ container: el.container, divider: el.divider, onResize: relayout });
    layout.setupModes({ container: el.container, group: el.modes, onChange: relayout });
    layout.setupRail({ container: el.container, toggle: el.railToggle, onChange: relayout });
    layout.setupMobileTabs({ container: el.container, tabs: el.mobileTabs, onChange: relayout });

    scrollSync.setup({ editor, preview: el.preview, checkbox: el.syncCheckbox });

    // ----- keyboard -----

    document.addEventListener('keydown', (event) => {
        const meta = event.metaKey || event.ctrlKey;
        if (!meta) return;

        const key = event.key.toLowerCase();
        if (key === 'k' && files.isSupported()) {
            event.preventDefault();
            if (workspace.isFolderOpen()) {
                palette.open();
            } else {
                toast(t.searchNeedsFolder);
            }
        } else if (key === 's') {
            event.preventDefault();
            workspace.flush(editor.getValue());
        } else if (key === 'b') {
            event.preventDefault();
            el.railToggle.click();
        }
    });

    // ----- start -----

    syncFolderChrome();

    el.saveDot.title = t.saved;

    // Open on whichever tool was last used — a tool station should resume, not
    // greet you with a landing page. The activation loads that tool's own
    // scratch buffer; startup must not preload one itself, or it would read a
    // different key from the one saves are written to.
    activateTool(read(KEYS.activeTool, 'markdown'), { persist: false });
    bootstrapped = true;
};

window.addEventListener('DOMContentLoaded', init);

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
import * as requestTool from './tools/request-tool.js';
import * as diffTool from './tools/diff-tool.js';
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
        openFile: document.querySelector('#open-file'),
        openFolder: document.querySelector('#open-folder'),
        openShortcut: document.querySelector('#open-shortcut'),
        closeOpen: document.querySelector('#close-open'),
        emptyOpenFile: document.querySelector('#empty-open-file'),
        emptyOpenFolder: document.querySelector('#empty-open-folder'),
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
    el.openShortcut.textContent = isMac ? '⌘O' : 'Ctrl O';

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
            syncWorkspaceChrome();
        },
        onFileOpened: ({ entry, text }) => {
            loading = true;
            // The open file is the source of truth: opening config.json moves
            // the whole workbench to the JSON tool. Closing it hands the
            // workbench back to whichever tool owns the scratch buffer that is
            // about to reappear — without this the header kept announcing JSON
            // over a Markdown document, with the PDF button still hidden.
            const type = entry
                ? toolsRegistry.toolForFile(entry.name).id
                : workspace.scratchKind();
            if (type !== activeTool) {
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

    // Put text in the editor as a scratch buffer: a reassembled reply handed
    // over from a utility, or a file read in a browser that cannot write back.
    // The whole point of these tools living in one app is that documents flow
    // between them.
    const openScratch = (text, toolId = 'markdown') => {
        // Whatever file was open stops being the destination — otherwise the
        // handed-over text would autosave straight over it.
        workspace.detach();
        rail.setCurrentPath(null);
        activateTool(toolId);
        setDocType(toolId);
        loading = true;
        editor.setValue(text);
        editor.revealPosition({ lineNumber: 1, column: 1 });
        loading = false;
        convert(text);
        workspace.recordEdit(text);
        el.preview.scrollTo({ top: 0 });
    };

    const openScratchMarkdown = (text) => {
        // An empty handoff would silently wipe the Markdown buffer, so the
        // button simply does nothing when there is nothing to hand over.
        if (text?.trim()) {
            openScratch(text);
        }
    };

    // Firefox and Safari can read a file but not write to one. Rather than
    // pretending, the content is loaded as a scratch buffer and the toast says
    // plainly that it is a copy.
    const openCopy = (name, text) => {
        openScratch(text, toolsRegistry.toolForFile(name).id);
        toast(t.openedCopy(name));
    };

    // ----- tools -----

    const utilities = {
        request: requestTool.create({ onOpenInMarkdown: (text) => openScratchMarkdown(text) }),
        stream: streamTool.create({ onOpenInMarkdown: (text) => openScratchMarkdown(text) }),
        diff: diffTool.create(),
        unicode: unicodeTool.create()
    };

    Object.values(utilities).forEach((tool) => {
        tool.root.hidden = true;
        el.utilityHost.appendChild(tool.root);
    });

    let activeTool = 'markdown';

    // Whether the editor holds a scratch buffer yet — not whether the app has
    // started. The two came apart once the station could resume on a utility:
    // booting into one leaves the editor empty, and treating that as "started"
    // meant the next switch to Markdown skipped the load (matching kind, so
    // nothing to switch) and the switch after that persisted the blank editor
    // over the saved buffer. Set only where a buffer is actually loaded.
    let editorLoaded = false;

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
            // With a file open — from a folder or on its own — that file decides
            // the type; otherwise the tool brings its own scratch buffer
            // forward. The test is "is a file open", not "is a folder open":
            // loading a scratch buffer over an open file would send the next
            // keystroke's autosave into that file on disk.
            if (!workspace.isDocumentOpen() && (!editorLoaded || workspace.scratchKind() !== tool.id)) {
                const fallback = tool.id === 'json' ? defaultJson : defaultDocument;
                // With nothing loaded yet the editor is empty; handing that to
                // switchScratch would persist the blank as the outgoing buffer
                // and wipe whatever was saved.
                const text = editorLoaded
                    ? workspace.switchScratch(tool.id, editor.getValue(), fallback)
                    : workspace.initialScratch(tool.id, fallback);
                loading = true;
                setDocType(tool.id);
                editor.setValue(text);
                editor.revealPosition({ lineNumber: 1, column: 1 });
                loading = false;
                editorLoaded = true;
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

    const toolItem = (tool) => {
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
    };

    el.toolMenu.replaceChildren(
        ...toolsRegistry.GROUPS.flatMap((group) => {
            const tools = toolsRegistry.TOOLS.filter((tool) => tool.kind === group.kind);
            if (tools.length === 0) return [];

            const label = document.createElement('span');
            label.className = 'menu-label';
            label.textContent = group.label();
            return [label, ...tools.map(toolItem)];
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

    // ----- workspace chrome -----

    // The rail's title names the scope of the tree below it: a folder, one
    // file, or nothing. A folder keeps its trailing slash so the two never read
    // alike at a glance.
    const syncWorkspaceChrome = () => {
        const mode = workspace.mode();
        const entry = workspace.currentEntry();

        el.folderName.textContent =
            mode === 'folder'
                ? `${workspace.folderName()}/`
                : mode === 'file'
                  ? entry.name
                  : t.noDocument;

        el.rail.dataset.folder = mode === 'scratch' ? 'empty' : 'open';
        el.railEmpty.hidden = mode !== 'scratch';

        el.closeOpen.hidden = mode === 'scratch';
        el.closeOpen.textContent = mode === 'folder' ? t.closeFolder : t.closeFile;

        el.folderButton.title =
            mode === 'folder'
                ? `${workspace.folderName()} · ${t.fileCount(workspace.entries().length)}`
                : mode === 'file'
                  ? entry.path
                  : t.switchFolder;
    };

    const setMenu = (open) => {
        el.folderMenu.hidden = !open;
        el.folderButton.setAttribute('aria-expanded', String(open));
        if (open) {
            paintRecents();
        }
    };

    // Files and folders share one list. Two handles are the same entry only if
    // `isSameEntry` says so — names collide constantly once README.md is a
    // candidate — so the current marker is resolved by asking, not by matching
    // strings.
    const paintRecents = async () => {
        const records = await files.recentEntries();
        if (records.length === 0) {
            const empty = document.createElement('span');
            empty.className = 'menu-empty';
            empty.textContent = t.noRecentFolders;
            el.recentFolders.replaceChildren(empty);
            return;
        }

        const open = workspace.openHandleRef();
        const current = await Promise.all(
            records.map((record) =>
                open ? record.handle.isSameEntry(open).catch(() => false) : false
            )
        );

        el.recentFolders.replaceChildren(
            ...records.map((record, i) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'menu-item';
                button.setAttribute('role', 'menuitem');
                button.setAttribute('aria-current', String(current[i]));
                button.title = record.name;

                const name = document.createElement('span');
                name.className = 'name';
                name.textContent = record.name;
                button.appendChild(name);

                if (record.kind === 'directory') {
                    const slash = document.createElement('span');
                    slash.className = 'kind';
                    slash.textContent = '/';
                    button.appendChild(slash);
                }

                button.addEventListener('click', async () => {
                    setMenu(false);
                    await workspace.reopenRecent(record);
                });
                return button;
            })
        );
    };

    // Opening one file needs only the file picker; browsing a folder needs the
    // directory picker. Where neither exists the file still opens, as a copy.
    const openFileFlow = async () => {
        setMenu(false);
        if (files.canPickFile()) {
            await workspace.openFile();
            return;
        }
        const file = await pickFileFallback();
        if (file) {
            openCopy(file.name, await file.text());
        }
    };

    const openFolderFlow = async () => {
        setMenu(false);
        await workspace.openFolder();
    };

    // A hidden input is the only way in for browsers without the File System
    // Access API. It hands back a File, never a handle, so nothing can be
    // written back — which is exactly what the toast tells the reader.
    const pickFileFallback = () =>
        new Promise((resolve) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = files.acceptAttribute();
            input.addEventListener('change', () => resolve(input.files?.[0] ?? null), {
                once: true
            });
            // A dismissed dialog fires nothing in some browsers; the promise is
            // simply never settled, and the input is garbage once it goes.
            input.click();
        });

    el.folderButton.addEventListener('click', (event) => {
        event.stopPropagation();
        setMenu(el.folderMenu.hidden);
    });
    el.folderMenu.addEventListener('click', (event) => event.stopPropagation());
    document.addEventListener('click', () => setMenu(false));

    el.openFile.addEventListener('click', openFileFlow);
    el.emptyOpenFile.addEventListener('click', openFileFlow);
    el.openFolder.addEventListener('click', openFolderFlow);
    el.emptyOpenFolder.addEventListener('click', openFolderFlow);
    el.closeOpen.addEventListener('click', () => {
        setMenu(false);
        workspace.close();
    });

    if (!files.isSupported()) {
        // Firefox and Safari: a folder is a library the browser cannot walk,
        // so those affordances go rather than sitting there unable to work.
        // Opening a single file stays — it is the errand people actually have.
        el.openFolder.hidden = true;
        el.emptyOpenFolder.hidden = true;
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

    // ----- dropping a document on the window -----
    //
    // The gesture people already have for "open this in that". Chromium hands
    // over a real handle, so a dropped file is editable in place exactly like a
    // picked one; elsewhere only the bytes come through and it opens as a copy.

    const setDropState = (over) => {
        if (over) {
            el.container.dataset.drop = 'over';
        } else {
            delete el.container.dataset.drop;
        }
    };

    const carriesFile = (event) =>
        Array.from(event.dataTransfer?.items ?? []).some((item) => item.kind === 'file');

    document.addEventListener('dragover', (event) => {
        if (!carriesFile(event)) return;
        // Without preventDefault the browser navigates to the dropped file and
        // the editor is gone.
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        setDropState(true);
    });

    // Fires on every child element too; only a null relatedTarget means the
    // pointer has actually left the window.
    document.addEventListener('dragleave', (event) => {
        if (event.relatedTarget === null) setDropState(false);
    });

    document.addEventListener('drop', async (event) => {
        if (!carriesFile(event)) return;
        event.preventDefault();
        setDropState(false);

        const item = event.dataTransfer.items[0];
        // Both of these must be read before the first await — the DataTransfer
        // is emptied as soon as the handler yields.
        const handlePromise = item.getAsFileSystemHandle?.();
        const file = item.getAsFile();

        if (handlePromise) {
            const handle = await handlePromise;
            if (handle.kind === 'file' && !files.isDocumentName(handle.name)) {
                toast(t.notDocumentFile);
                return;
            }
            await workspace.openHandle(handle);
            return;
        }

        if (!file || !files.isDocumentName(file.name)) {
            toast(t.notDocumentFile);
            return;
        }
        openCopy(file.name, await file.text());
    });

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
        } else if (key === 'o') {
            // The browser's own ⌘O opens a page, not a document; here the
            // document is the point.
            event.preventDefault();
            openFileFlow();
        } else if (key === 's') {
            event.preventDefault();
            workspace.flush(editor.getValue());
        } else if (key === 'b') {
            event.preventDefault();
            el.railToggle.click();
        }
    });

    // ----- start -----

    syncWorkspaceChrome();

    el.saveDot.title = t.saved;

    // Open on whichever tool was last used — a tool station should resume, not
    // greet you with a landing page. The activation loads that tool's own
    // scratch buffer; startup must not preload one itself, or it would read a
    // different key from the one saves are written to.
    activateTool(read(KEYS.activeTool, 'markdown'), { persist: false });
};

window.addEventListener('DOMContentLoaded', init);

import './styles/app.css';

import { defaultDocument, defaultJson } from './default-document.js';
import { t } from './modules/strings.js';
import { read, write, remove, KEYS } from './modules/storage.js';
import * as editorModule from './modules/editor.js';
import * as renderer from './modules/renderer.js';
import * as theme from './modules/theme.js';
import * as layout from './modules/layout.js';
import * as railModule from './modules/rail.js';
import * as toolbarModule from './modules/toolbar.js';
import * as paletteModule from './modules/palette.js';
import * as scrollSync from './modules/scroll-sync.js';
import * as files from './modules/files.js';
import * as workspaceModule from './modules/workspace.js';
import * as documentsModule from './modules/documents.js';
import * as previewModule from './modules/preview.js';
import * as tabsModule from './modules/tabs.js';
import * as session from './modules/session.js';
import * as scratch from './modules/scratch.js';
import { openMenu, arrowKeys, focusFirst } from './modules/menu.js';
import * as toolsRegistry from './modules/tools.js';
import * as jsonTools from './modules/json-tools.js';
import * as jsonToolView from './tools/json-tool.js';
import * as streamTool from './tools/stream-tool.js';
import * as unicodeTool from './tools/unicode-tool.js';
import * as requestTool from './tools/request-tool.js';
import * as diffTool from './tools/diff-tool.js';
import { toPdf } from './modules/export.js';

const TOAST_MS = 3200;
const TOAST_ACTION_MS = 6000;

const IS_MAC = /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);

// The app's own commands use ⌘ on a Mac and Ctrl elsewhere. Tab commands
// cannot: the browser keeps ⌘W, ⌘T and ⌃Tab for its own tabs and a page is
// never handed them. So tabs use ⌃ on a Mac — as VS Code does for ⌃1–9 — and
// Alt elsewhere.
const MOD = IS_MAC ? '⌘' : 'Ctrl+';
const TAB_MOD = IS_MAC ? '⌃' : 'Alt+';
const SHIFT = IS_MAC ? '⇧' : 'Shift+';

const isModKey = (event) =>
    (IS_MAC ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey) && !event.altKey;
const isTabKey = (event) =>
    IS_MAC
        ? event.ctrlKey && !event.metaKey && !event.altKey
        : event.altKey && !event.ctrlKey && !event.metaKey;

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

// A Markdown scratch document is named after its first H1, or failing that its
// first heading — skipping fenced code, where `# comment` is not a heading.
const titleOf = (text, type) => {
    if (type !== 'markdown') return '';
    let fence = null;
    let first = '';
    const lines = text.split('\n', 400);
    for (const line of lines) {
        const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
        if (marker) {
            if (!fence) fence = marker[1][0];
            else if (marker[1][0] === fence) fence = null;
            continue;
        }
        if (fence) continue;
        const heading = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
        if (!heading) continue;
        const text = heading[2].replace(/[*_`~]/g, '').trim();
        if (heading[1].length === 1) return text;
        first ||= text;
    }
    return first;
};

const basename = (path) => path.split('/').pop();
const dirname = (path) => path.split('/').slice(0, -1).join('/');

const init = async () => {
    const el = {
        container: document.querySelector('#container'),
        docs: document.querySelector('#docs'),
        panes: document.querySelector('#panes'),
        tabbar: document.querySelector('#tabbar'),
        tabs: document.querySelector('#tabs'),
        tabAdd: document.querySelector('#tab-add'),
        banner: document.querySelector('#doc-banner'),
        docsEmpty: document.querySelector('#docs-empty'),
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
        emptyNewMarkdown: document.querySelector('#empty-new-markdown'),
        emptyNewJson: document.querySelector('#empty-new-json'),
        emptyOpenFiles: document.querySelector('#empty-open-files'),
        modes: document.querySelector('#modes'),
        docSep: document.querySelector('#doc-sep'),
        docTitle: document.querySelector('#doc-title'),
        docDir: document.querySelector('#doc-dir'),
        docName: document.querySelector('#doc-name'),
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
        toastText: document.querySelector('#toast-text'),
        toastAction: document.querySelector('#toast-action'),
        mobileTabs: Array.from(document.querySelectorAll('.mobile-tab'))
    };

    applyStrings(document);
    el.rail.setAttribute('aria-label', t.railLabel);
    el.searchShortcut.textContent = IS_MAC ? '⌘K' : 'Ctrl K';
    el.openShortcut.textContent = `${MOD}O`;
    el.tabAdd.title = t.newTab;
    el.tabAdd.setAttribute('aria-label', t.newTab);
    el.resetButton.title = t.resetHint;

    theme.init();

    const editor = editorModule.create(el.editorHost);
    editorModule.setTheme(theme.isDark());

    // ----- toast -----

    let toastTimer = null;
    let toastRun = null;
    const hideToast = () => {
        el.toast.hidden = true;
        toastRun = null;
    };
    const toast = (message, { action = null } = {}) => {
        el.toastText.textContent = message;
        el.toastAction.hidden = !action;
        el.toastAction.textContent = action?.label ?? '';
        toastRun = action?.run ?? null;
        el.toast.hidden = false;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(hideToast, action ? TOAST_ACTION_MS : TOAST_MS);
    };
    el.toastAction.addEventListener('click', () => {
        const run = toastRun;
        hideToast();
        run?.();
    });

    // ----- documents and the folder -----

    const store = documentsModule.create({
        models: editorModule.models,
        disk: { read: files.readFile, write: files.writeFile, stat: files.statFile },
        scratch: scratch.store,
        titleOf
    });

    const library = workspaceModule.create({
        onChange: (what) => {
            syncLibrary();
            if (what === 'folder') persistSoon();
        }
    });

    // What a tab and the header call a document.
    const labelOf = (doc) => {
        if (doc.kind === 'scratch') {
            return { name: doc.label || doc.title || (doc.type === 'json' ? t.untitledJson : t.untitled) };
        }
        const name = doc.entry.name;
        const twin = store
            .list()
            .some((other) => other !== doc && other.kind === 'file' && other.entry.name === name);
        if (!twin) return { name };
        if (!doc.entry.root) return { name };
        return { name, dir: doc.entry.dir ? `${doc.entry.dir}/` : `${library.name() ?? ''}/` };
    };

    // The same document's location, for tooltips and quick open.
    const pathOf = (doc) => {
        if (doc.kind === 'scratch') return labelOf(doc).name;
        return doc.entry.root ? doc.entry.path : doc.entry.name;
    };

    const hintOf = (doc) => {
        const lines = [doc.kind === 'scratch' ? t.scratchHint : pathOf(doc)];
        if (doc.state === 'locked') lines.push(doc.hasBackup ? t.backupHint : t.lockedHint);
        else if (doc.state === 'missing') lines.push(t.missingHint);
        else if (doc.conflict) lines.push(t.conflictHint);
        else if (doc.preview) lines.push(t.previewTabHint);
        return lines.join('\n');
    };

    const inFolder = (doc) => Boolean(doc?.entry?.root) && doc.entry.root === library.key();

    // ----- rail -----

    const rail = railModule.setup({
        container: el.outline,
        countLabel: el.headingCount,
        preview: el.preview,
        output: el.output,
        onOpenFile: (entry, { pinned }) => openEntry(entry, { preview: !pinned }),
        onNavigate: (heading) => navigateTo(heading)
    });

    // ----- preview -----

    const imageUrls = new Map();

    // A relative image in a note is a file in the open folder. Read it once
    // and hand the preview a blob URL, rereading only when the file changes.
    const resolveImage = async (src) => {
        const doc = shown;
        if (!inFolder(doc)) return null;
        const path = files.joinPath(doc.entry.dir, src);
        if (!path) return null;
        const file = await (await library.fileAt(path)).getFile();
        const cached = imageUrls.get(path);
        if (cached?.modifiedAt === file.lastModified) return cached.url;
        if (cached) URL.revokeObjectURL(cached.url);
        const url = URL.createObjectURL(file);
        imageUrls.set(path, { url, modifiedAt: file.lastModified });
        return url;
    };

    const forgetImages = () => {
        imageUrls.forEach(({ url }) => URL.revokeObjectURL(url));
        imageUrls.clear();
    };

    const preview = previewModule.create({
        scroller: el.preview,
        output: el.output,
        theme: () => theme.mermaidTheme(),
        resolveImage,
        onLink: (href, options) => followLink(href, options),
        onReveal: (line) => revealSource(line),
        onRendered: () => {
            if (shown?.type === 'markdown') {
                rail.setHeadings(renderer.outline(el.output));
            }
        }
    });

    // ----- JSON panel -----

    const jsonPanel = jsonToolView.create({
        onOpenInMarkdown: (text) => openHandoff(text),
        onStateChange: () => {
            if (shown?.type === 'json') shown.view.json = jsonPanel.getState();
        }
    });
    el.jsonHost.appendChild(jsonPanel.root);

    // ----- toolbar -----

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

    // ----- utilities -----

    const diff = diffTool.create();
    const utilities = {
        request: requestTool.create({ onOpenInMarkdown: (text) => openHandoff(text) }),
        stream: streamTool.create({ onOpenInMarkdown: (text) => openHandoff(text) }),
        diff,
        unicode: unicodeTool.create()
    };

    Object.values(utilities).forEach((tool) => {
        tool.root.hidden = true;
        el.utilityHost.appendChild(tool.root);
    });

    // ----- showing a document -----

    // The document whose model is in the editor right now.
    let shown = null;
    let workbench = 'document';
    let jsonFrame = null;

    const setDocType = (type) => {
        el.container.dataset.doctype = type;
        toolbar.setDocType(type);
        // "阅读" is a prose view; JSON has no such thing.
        el.modes.querySelector('[data-mode="read"]').hidden = type === 'json';
        if (type === 'json' && el.container.dataset.mode === 'read') {
            el.modes.querySelector('[data-mode="split"]').click();
        }
    };

    const renderJson = (doc) => {
        const text = doc.model.getValue();
        jsonPanel.update(text);
        rail.setHeadings(jsonTools.outlineFromText(text));
    };

    // Render the shown document. A tab switch renders at once; typing is
    // left to the preview's own scheduling, and JSON gets one pass per frame.
    const render = (doc, { fresh = false } = {}) => {
        if (!doc?.model) return;
        if (doc.type === 'json') {
            if (fresh) {
                cancelAnimationFrame(jsonFrame);
                jsonFrame = null;
                renderJson(doc);
            } else if (jsonFrame === null) {
                jsonFrame = requestAnimationFrame(() => {
                    jsonFrame = null;
                    if (shown === doc && doc.model) renderJson(doc);
                });
            }
            return;
        }
        const text = doc.model.getValue();
        const local = inFolder(doc);
        if (fresh) preview.show(text, { local });
        else preview.update(text, { local });
    };

    const stashView = (doc) => {
        if (!doc?.model || doc.model.isDisposed?.()) return;
        doc.view.editor = editor.saveViewState();
        doc.view.previewTop = el.preview.scrollTop;
        if (doc.type === 'json') doc.view.json = jsonPanel.getState();
    };

    const showDoc = (doc) => {
        if (shown && shown !== doc) stashView(shown);
        shown = doc ?? null;

        el.container.dataset.docs = doc ? 'some' : 'none';
        el.container.dataset.docState = doc?.state ?? 'none';
        el.docsEmpty.hidden = Boolean(doc);

        if (!doc) {
            editor.setModel(null);
            preview.clear();
            rail.setHeadings([]);
            rail.setCurrentPath(null);
        } else {
            setDocType(doc.type);
            if (doc.model) {
                editor.setModel(doc.model);
                if (doc.view.editor) editor.restoreViewState(doc.view.editor);
                if (doc.type === 'json') jsonPanel.setState(doc.view.json);
                render(doc, { fresh: true });
                el.preview.scrollTop = doc.view.previewTop ?? 0;
            } else {
                // A tab that is waiting for access: nothing to show yet, and
                // the banner says how to get it.
                editor.setModel(null);
                preview.clear();
                rail.setHeadings([]);
            }
            rail.setCurrentPath(inFolder(doc) ? doc.entry.path : null);
        }

        syncChrome();
        syncBanner();
        tabs.render();
        tabs.revealActive();
    };

    // ----- header and banner -----

    const syncCrumb = () => {
        const doc = shown;
        const visible = workbench === 'document' && Boolean(doc);
        el.docSep.hidden = !visible;
        el.docTitle.hidden = !visible;
        if (!visible) return;
        if (doc.kind === 'file' && doc.entry.root && doc.entry.dir) {
            el.docDir.textContent = `${doc.entry.dir}/`;
        } else {
            el.docDir.textContent = '';
        }
        el.docName.textContent = labelOf(doc).name;
        el.docTitle.title = hintOf(doc);
    };

    const syncChrome = () => {
        const isDocument = workbench === 'document';
        const doc = isDocument ? shown : null;
        const tool = isDocument ? toolsRegistry.byId(doc?.type ?? 'markdown') : toolsRegistry.byId(workbench);
        el.container.dataset.workbench = tool.kind;
        el.toolName.textContent = tool.name();

        Object.entries(utilities).forEach(([key, utility]) => {
            utility.root.hidden = isDocument || key !== workbench;
        });

        const ready = Boolean(doc?.model);
        el.modes.hidden = !isDocument;
        el.syncCheckbox.closest('.switch').hidden = !isDocument;
        // The rail belongs to documents; in a utility its toggle would open a
        // panel that is not there (and quietly collapse the documents' rail).
        el.railToggle.hidden = !isDocument;
        el.searchButton.hidden = !isDocument;
        el.copyButton.hidden = !ready;
        // PDF export prints the Markdown preview.
        el.exportButton.hidden = !ready || doc.type !== 'markdown';
        // "重置" swaps in the sample text. It belongs to scratch documents
        // only: it used to overwrite a real file on disk with the sample.
        el.resetButton.hidden = !ready || doc.kind !== 'scratch';

        // The narrow-screen tab strip is shared. In a document it switches
        // editor/preview; in a utility it switches input/output.
        el.mobileTabs[0].textContent = isDocument ? t.modeEdit : t.tabInput;
        el.mobileTabs[1].textContent = isDocument ? t.modeRead : t.tabOutput;

        syncCrumb();
    };

    const bannerButton = (label, run, { primary = false } = {}) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        if (primary) button.className = 'primary';
        button.addEventListener('click', run);
        return button;
    };

    const showBanner = ({ label, text, tone = 'bad', actions = [] }) => {
        const labelElement = document.createElement('span');
        labelElement.className = 'banner-label';
        labelElement.textContent = label;
        const textElement = document.createElement('span');
        textElement.className = 'banner-text';
        textElement.textContent = text;
        const actionBox = document.createElement('span');
        actionBox.className = 'banner-actions';
        actionBox.append(...actions);
        el.banner.dataset.tone = tone;
        el.banner.replaceChildren(labelElement, textElement, actionBox);
        el.banner.hidden = false;
    };

    const syncBanner = () => {
        const doc = workbench === 'document' ? shown : null;
        const locked = store.list().filter((other) => other.state === 'locked');
        const name = doc ? labelOf(doc).name : '';

        if (doc?.conflict) {
            showBanner({
                label: t.conflictLabel,
                text: t.conflictBody(name),
                actions: [
                    bannerButton(t.compare, () => compareConflict(doc)),
                    bannerButton(t.useDisk, () => store.resolve(doc.id, 'disk')),
                    bannerButton(t.keepMine, () => store.resolve(doc.id, 'mine'), { primary: true })
                ]
            });
        } else if (doc?.state === 'missing') {
            showBanner({
                label: t.missingLabel,
                text: t.missingBody(name),
                actions: [
                    files.canSaveAs() && doc.model
                        ? bannerButton(t.saveAs, () => saveAs(doc.id), { primary: true })
                        : null,
                    bannerButton(t.discardTab, () => store.close(doc.id, { force: true }))
                ].filter(Boolean)
            });
        } else if (doc?.error && doc.kind === 'scratch') {
            showBanner({
                label: t.saveFailedLabel,
                text: t.scratchFullBody,
                actions: files.canSaveAs() ? [bannerButton(t.saveAs, () => saveAs(doc.id), { primary: true })] : []
            });
        } else if (doc?.error) {
            showBanner({
                label: t.saveFailedLabel,
                text: t.saveFailedBody(name),
                actions: [bannerButton(t.retry, () => store.flush(doc.id), { primary: true })]
            });
        } else if (locked.length > 0 && (doc?.state === 'locked' || library.pending())) {
            showBanner({
                label: t.lockedLabel,
                text: t.lockedBody(locked.length),
                tone: 'plain',
                actions: [bannerButton(t.resumeAccess, () => resumeAccess(), { primary: true })]
            });
        } else {
            el.banner.hidden = true;
            el.banner.replaceChildren();
        }
    };

    // ----- tabs -----

    const tabs = tabsModule.setup({
        strip: el.tabbar,
        list: el.tabs,
        addButton: el.tabAdd,
        store,
        labelOf,
        hintOf,
        actions: {
            activate: (id) => {
                store.activate(id);
                enterDocuments();
                const doc = store.get(id);
                if (doc?.state === 'locked') unlockOne(doc);
            },
            close: (id) => closeTab(id),
            pin: (id) => store.pin(id),
            reorder: (id, index) => store.move(id, index),
            menu: (id, point) => tabMenu(id, point),
            add: (anchor) => addMenu(anchor),
            focusEditor: () => editor.focus()
        }
    });

    // Every file dirty in the open folder, for the rail's "未保存" marks.
    const syncRailDirty = () => {
        rail.setDirty(
            store
                .list()
                .filter((doc) => inFolder(doc) && (store.isDirty(doc) || doc.conflict || doc.hasBackup))
                .map((doc) => doc.entry.path)
        );
    };

    store.onChange((event) => {
        switch (event.type) {
            case 'active':
                showDoc(event.doc);
                persistSoon();
                break;
            case 'list':
                tabs.render();
                syncRailDirty();
                syncCrumb();
                persistSoon();
                break;
            case 'state':
                tabs.render();
                syncRailDirty();
                if (event.doc === shown) {
                    el.container.dataset.docState = shown.state;
                    syncChrome();
                    syncBanner();
                }
                persistSoon();
                break;
            case 'content':
                if (event.doc === shown) render(event.doc);
                break;
            case 'loaded':
                applyBackup(event.doc);
                break;
            case 'saved':
                dropBackup(event);
                library.indexPut(event.doc.entry, event.text);
                if (inFolder(event.doc)) event.doc.entry.size = event.doc.size;
                break;
            case 'conflict':
                tabs.render();
                syncRailDirty();
                if (event.doc === shown) syncBanner();
                break;
            case 'reloaded':
                if (event.doc === shown) toast(t.reloadedFromDisk(labelOf(event.doc).name));
                break;
            case 'error':
                tabs.render();
                if (event.doc === shown) syncBanner();
                else if (event.doc.kind === 'scratch') toast(t.scratchFullBody);
                else toast(t.saveFailedBody(labelOf(event.doc).name));
                break;
            default:
        }
    });

    // ----- workbench -----

    const enterDocuments = () => {
        if (workbench === 'document') return;
        workbench = 'document';
        syncChrome();
        syncBanner();
        editor.layout();
        write(KEYS.activeTool, shown?.type ?? 'markdown');
    };

    const newScratch = (type, { text = '', label = '' } = {}) => {
        const doc = store.openScratch({ type, text, label });
        enterDocuments();
        editor.focus();
        return doc;
    };

    // The tool menu's Markdown and JSON entries: the most recent tab of that
    // kind, or a new scratch document with the sample text when there is none.
    const showType = (type) => {
        const doc = store.mru().find((other) => other.type === type) ?? null;
        if (doc) {
            store.activate(doc.id);
        } else {
            store.openScratch({ type, text: type === 'json' ? defaultJson : defaultDocument });
        }
        enterDocuments();
        editor.focus();
    };

    const activateTool = (id, { persist = true } = {}) => {
        const tool = toolsRegistry.byId(id);
        setToolMenu(false);
        if (tool.kind === 'document') {
            showType(tool.id);
        } else {
            if (shown) stashView(shown);
            workbench = tool.id;
            syncChrome();
            syncBanner();
            utilities[tool.id]?.focus?.();
        }
        if (persist) write(KEYS.activeTool, tool.id);
    };

    const setToolMenu = (open) => {
        el.toolMenu.hidden = !open;
        el.toolButton.setAttribute('aria-expanded', String(open));
        if (open) focusFirst(el.toolMenu);
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
            const items = toolsRegistry.TOOLS.filter((tool) => tool.kind === group.kind);
            if (items.length === 0) return [];
            const label = document.createElement('span');
            label.className = 'menu-label';
            label.textContent = group.label();
            return [label, ...items.map(toolItem)];
        })
    );
    arrowKeys(el.toolMenu);

    el.toolButton.addEventListener('click', (event) => {
        event.stopPropagation();
        const current = workbench === 'document' ? shown?.type ?? 'markdown' : workbench;
        el.toolMenu.querySelectorAll('.tool-item').forEach((item) => {
            item.setAttribute('aria-current', String(item.dataset.tool === current));
        });
        setToolMenu(el.toolMenu.hidden);
    });
    el.toolMenu.addEventListener('click', (event) => event.stopPropagation());
    document.addEventListener('click', () => setToolMenu(false));
    el.toolMenu.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            setToolMenu(false);
            el.toolButton.focus();
        }
    });

    // ----- opening -----

    const typeOf = (name) => toolsRegistry.toolForFile(name).id;

    // A file from the open folder.
    const openEntry = async (entry, { preview: temporary = false, activate = true } = {}) => {
        try {
            const doc = await store.openFile(entry, {
                key: session.folderKey(entry.root, entry.path),
                type: typeOf(entry.name),
                preview: temporary,
                activate
            });
            if (activate) {
                enterDocuments();
                editor.focus();
            }
            return doc;
        } catch (error) {
            toast(error?.name === 'NotFoundError' ? t.folderFileGone(entry.name) : t.readFileFailed);
            library.refresh({ force: true });
            return null;
        }
    };

    // A file on its own — picked, dropped or reopened from the recent list.
    const openFileHandle = async (handle, record = null) => {
        try {
            const id = record ?? (await files.remember(handle));
            const doc = await store.openFile(files.entryForFile(handle, id), {
                key: session.fileKey(id),
                type: typeOf(handle.name)
            });
            enterDocuments();
            editor.focus();
            return doc;
        } catch (error) {
            toast(t.openFileFailed);
            return null;
        }
    };

    // Firefox and Safari can read a file but not write to one. Rather than
    // pretending, the text opens as a scratch document named after the file,
    // and the toast says plainly that it is a copy.
    const openCopy = (name, text) => {
        newScratch(typeOf(name), { text, label: name });
        toast(t.openedCopy(name));
    };

    // Text handed over from a utility — a reassembled reply, a request
    // transcript, a table — opens in a tab of its own. It used to replace the
    // Markdown scratch buffer, and whatever was written there was gone.
    const openHandoff = (text) => {
        if (!text?.trim()) return;
        newScratch('markdown', { text });
    };

    // A hidden input is the only way in for browsers without the File System
    // Access API. It hands back Files, never handles, so nothing can be
    // written back — which is exactly what the toast tells the reader.
    const pickFilesFallback = () =>
        new Promise((resolve) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.multiple = true;
            input.accept = files.acceptAttribute();
            input.addEventListener('change', () => resolve(Array.from(input.files ?? [])), { once: true });
            input.click();
        });

    const openFilesFlow = async () => {
        setMenu(false);
        if (files.canPickFile()) {
            try {
                const handles = await files.pickFiles();
                for (const handle of handles) await openFileHandle(handle);
            } catch (error) {
                if (error?.name !== 'AbortError') toast(t.openFileFailed);
            }
            return;
        }
        for (const file of await pickFilesFallback()) {
            openCopy(file.name, await file.text());
        }
    };

    // ----- the folder -----

    // Tabs from a folder that is no longer open are closed (their text is
    // written first). A tab whose edits cannot be written stays.
    const closeFolderTabs = async (keep = null) => {
        for (const doc of store.list()) {
            if (doc.entry?.root && doc.entry.root !== keep) {
                const result = await store.close(doc.id);
                if (!result.ok) {
                    await detachFromFolder(doc);
                    store.activate(doc.id);
                    toast(t.closeBlocked(labelOf(doc).name));
                }
            }
        }
    };

    const afterFolderOpened = async () => {
        await closeFolderTabs(library.key());
        // The folder may be the one a previous session was waiting for.
        await restoreFolderTabs();
        forgetImages();
        enterDocuments();
        // A folder opens onto its README when it has one, as a temporary tab.
        const entries = library.entries();
        const hasTab = store.list().some((doc) => inFolder(doc));
        if (!hasTab && entries.length) {
            const readme = entries.find((entry) => !entry.dir && /^readme\.md$/i.test(entry.name));
            await openEntry(readme ?? entries[0], { preview: true });
        }
        if (entries.length === 0) toast(t.folderEmpty);
    };

    const openFolderFlow = async () => {
        setMenu(false);
        try {
            await library.open();
            await afterFolderOpened();
        } catch (error) {
            if (error?.name !== 'AbortError') toast(t.openFolderFailed);
        }
    };

    const closeFolderFlow = async () => {
        setMenu(false);
        await closeFolderTabs(null);
        library.close();
        forgetImages();
        persistSoon();
    };

    // The rail's head names the scope of the tree below it. A folder keeps
    // its trailing slash so it never reads like a file.
    const syncLibrary = () => {
        const open = library.isOpen();
        const pending = library.pending();
        el.folderName.textContent = open || pending ? `${library.name()}/` : t.noFolder;
        el.rail.dataset.folder = open ? 'open' : 'empty';
        el.railEmpty.hidden = open || Boolean(pending);
        el.closeOpen.hidden = !open;
        el.closeOpen.textContent = t.closeFolder;
        el.folderButton.title = open
            ? `${library.name()} · ${t.fileCount(library.entries().length)}`
            : t.switchFolder;
        rail.setFiles(library.entries(), { truncated: library.truncated() });
        rail.setCurrentPath(inFolder(shown) ? shown.entry.path : null);
        syncRailDirty();
        syncBanner();
    };

    // ----- the rail's folder menu -----

    const setMenu = (open) => {
        el.folderMenu.hidden = !open;
        el.folderButton.setAttribute('aria-expanded', String(open));
        if (open) paintRecents().then(() => focusFirst(el.folderMenu));
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

        const open = [library.handle(), ...store.list().map((doc) => doc.entry?.handle)].filter(Boolean);
        const current = await Promise.all(
            records.map(async (record) => {
                for (const handle of open) {
                    if (await record.handle.isSameEntry(handle).catch(() => false)) return true;
                }
                return false;
            })
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

                button.addEventListener('click', () => {
                    setMenu(false);
                    reopenRecent(record);
                });
                return button;
            })
        );
    };

    // A remembered handle can outlive the thing it points at. Rather than a
    // vague failure every time, drop the record so the list reflects what is
    // actually still there.
    const reopenRecent = async (record) => {
        try {
            if (!(await files.ensurePermission(record.handle))) {
                toast(t.permissionDenied);
                return;
            }
            if (record.kind === 'file') {
                await record.handle.getFile();
                await openFileHandle(record.handle, record.id);
            } else {
                await library.openHandle(record.handle, record.id);
                await afterFolderOpened();
            }
        } catch (error) {
            if (error?.name === 'NotFoundError') {
                await files.forget(record.id);
                toast(t.entryGone);
                return;
            }
            toast(record.kind === 'file' ? t.openFileFailed : t.openFolderFailed);
        }
    };

    el.folderButton.addEventListener('click', (event) => {
        event.stopPropagation();
        setMenu(el.folderMenu.hidden);
    });
    el.folderMenu.addEventListener('click', (event) => event.stopPropagation());
    el.folderMenu.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            setMenu(false);
            el.folderButton.focus();
        }
    });
    arrowKeys(el.folderMenu);
    document.addEventListener('click', () => setMenu(false));

    el.openFile.addEventListener('click', openFilesFlow);
    el.emptyOpenFile.addEventListener('click', openFilesFlow);
    el.emptyOpenFiles.addEventListener('click', openFilesFlow);
    el.openFolder.addEventListener('click', openFolderFlow);
    el.emptyOpenFolder.addEventListener('click', openFolderFlow);
    el.closeOpen.addEventListener('click', closeFolderFlow);
    el.emptyNewMarkdown.addEventListener('click', () => newScratch('markdown'));
    el.emptyNewJson.addEventListener('click', () => newScratch('json'));

    if (!files.isSupported()) {
        // Firefox and Safari: a folder is a library the browser cannot walk,
        // so those affordances go rather than sitting there unable to work.
        // Opening a single file stays — it is the errand people actually have.
        el.openFolder.hidden = true;
        el.emptyOpenFolder.hidden = true;
    }

    // ----- tab commands -----

    const closeTab = async (id) => {
        const doc = store.get(id);
        if (!doc) return;
        const name = labelOf(doc).name;
        const hadText = doc.kind === 'scratch' && doc.model && doc.model.getValue().trim() !== '';
        const result = await store.close(id);
        if (!result.ok) {
            store.activate(id);
            toast(result.reason === 'storage' ? t.scratchFullBody : t.closeBlocked(name));
            return;
        }
        // Closing a scratch document is the one close that can lose writing;
        // it is undone from the toast (or ⌃⇧T) instead of being asked about.
        if (hadText) {
            toast(t.closedTab(name), { action: { label: t.undoClose, run: () => reopenClosedTab() } });
        }
        if (store.list().length === 0) el.tabAdd.focus();
        else if (workbench === 'document') editor.focus();
    };

    const closeMany = async (ids) => {
        for (const id of ids) await closeTab(id);
    };

    const compare = (left, right) => {
        diff.load({
            left: left.model.getValue(),
            right: right.model.getValue(),
            leftName: labelOf(left).name,
            rightName: labelOf(right).name
        });
        activateTool('diff');
    };

    const compareConflict = (doc) => {
        const name = labelOf(doc).name;
        diff.load({
            left: doc.conflict.text,
            right: doc.model.getValue(),
            leftName: t.diskVersion(name),
            rightName: t.editorVersion(name)
        });
        activateTool('diff');
    };

    const copyText = async (text) => {
        try {
            await navigator.clipboard.writeText(text);
            toast(t.copied);
        } catch (error) {
            toast(t.copyFailed);
        }
    };

    const tabMenu = (id, { x, y }) => {
        const doc = store.get(id);
        if (!doc) return;
        const list = store.list();
        const at = list.indexOf(doc);
        const active = store.active();
        openMenu({
            x,
            y,
            label: labelOf(doc).name,
            items: [
                { label: t.closeTab, kbd: `${TAB_MOD}W`, run: () => closeTab(id) },
                {
                    label: t.closeOthers,
                    disabled: list.length < 2,
                    run: () => closeMany(list.filter((other) => other !== doc).map((other) => other.id))
                },
                {
                    label: t.closeRight,
                    disabled: at === list.length - 1,
                    run: () => closeMany(list.slice(at + 1).map((other) => other.id))
                },
                {
                    label: t.closeSaved,
                    run: () =>
                        closeMany(
                            list
                                .filter((other) => other.kind === 'file' && !store.isDirty(other) && !other.conflict)
                                .map((other) => other.id)
                        )
                },
                { rule: true },
                doc.preview && { label: t.keepTab, run: () => store.pin(id) },
                doc.kind === 'file' && { label: t.copyPath, run: () => copyText(pathOf(doc)) },
                inFolder(doc) && {
                    label: t.revealInRail,
                    run: () => {
                        if (el.container.dataset.rail !== 'open') el.railToggle.click();
                        store.activate(id);
                        rail.reveal(doc.entry.path);
                    }
                },
                active && active !== doc && active.model && doc.model && {
                    label: t.compareWithActive,
                    run: () => compare(doc, active)
                },
                doc.kind === 'scratch' && files.canSaveAs() && {
                    label: t.saveAs,
                    kbd: `${MOD}${SHIFT}S`,
                    run: () => saveAs(id)
                }
            ]
        });
    };

    const addMenu = (anchor) => {
        anchor.setAttribute('aria-expanded', 'true');
        openMenu({
            anchor,
            label: t.newTab,
            onClose: () => anchor.setAttribute('aria-expanded', 'false'),
            items: [
                { label: t.newMarkdown, kbd: `${TAB_MOD}${SHIFT}N`, run: () => newScratch('markdown') },
                { label: t.newJson, run: () => newScratch('json') },
                { rule: true },
                { label: t.openFileItem, kbd: `${MOD}O`, run: openFilesFlow },
                files.isSupported() && { label: t.openFolderItem, run: openFolderFlow }
            ]
        });
    };

    // Write a scratch document to a real file; the tab becomes that file.
    const saveAs = async (id) => {
        const doc = store.get(id);
        if (!doc?.model || !files.canSaveAs()) return;
        const extension = doc.type === 'json' ? '.json' : '.md';
        const base = (labelOf(doc).name || t.untitled).replace(/[\\/:*?"<>|]/g, '').trim() || t.untitled;
        const suggested = /\.(md|markdown|json)$/i.test(base) ? base : `${base}${extension}`;
        try {
            const handle = await files.pickSaveFile(suggested);
            const version = doc.model.getAlternativeVersionId();
            const text = doc.model.getValue();
            const record = await files.remember(handle);
            const entry = files.entryForFile(handle, record);
            const { modifiedAt, size } = await files.writeFile(entry, text);
            if (doc.state === 'missing') doc.state = 'ready';
            doc.error = null;
            store.adoptFile(id, entry, { key: session.fileKey(record), text, modifiedAt, size, version });
            toast(t.savedAs(handle.name));
            library.refresh({ force: true });
        } catch (error) {
            if (error?.name !== 'AbortError') toast(t.writeFileFailed);
        }
    };

    const cycleTab = (delta) => {
        const list = store.list();
        if (list.length < 2) return;
        const at = list.indexOf(store.active());
        store.activate(list[(at + delta + list.length) % list.length].id);
    };

    // ----- links, outline, source -----

    const followLink = async (href, { background = false } = {}) => {
        const doc = shown;
        if (!inFolder(doc)) {
            toast(t.onlyInFolder);
            return;
        }
        const [target, hash = ''] = href.split('#');
        const path = target.startsWith('/')
            ? files.joinPath('', target.slice(1))
            : files.joinPath(doc.entry.dir, target);
        if (!path) return;

        const entry = library.entryByPath(path);
        if (entry) {
            const opened = await openEntry(entry, { activate: !background });
            if (opened && hash && !background) {
                let id = hash;
                try {
                    id = decodeURIComponent(hash);
                } catch (error) {
                    // Use it as written.
                }
                requestAnimationFrame(() => preview.revealAnchor(id));
            }
            return;
        }

        // Not a document — an image, a PDF: show the file itself in a new
        // browser tab rather than navigating this one away.
        try {
            const file = await (await library.fileAt(path)).getFile();
            const url = URL.createObjectURL(file);
            window.open(url, '_blank', 'noopener');
            setTimeout(() => URL.revokeObjectURL(url), 60000);
        } catch (error) {
            toast(t.linkNotFound(path));
        }
    };

    const editorVisible = () => el.container.dataset.mode !== 'read';
    const previewVisible = () => el.container.dataset.mode !== 'edit';

    const revealInEditor = (line) => {
        editor.setScrollTop(Math.max(0, editor.getTopForLineNumber(line) - 8));
        editor.setPosition({ lineNumber: line, column: 1 });
    };

    // An outline row. Markdown moves both panes to the heading — the editor
    // too, which used to stay put, so in 编辑 view a click did nothing at all.
    // JSON reveals the line in the editor.
    const navigateTo = (heading) => {
        if (shown?.type === 'json') {
            if (heading.line === undefined) return;
            editor.revealLineInCenter(heading.line);
            editor.setPosition({ lineNumber: heading.line, column: 1 });
            editor.focus();
            return;
        }
        if (heading.line !== undefined && editorVisible()) revealInEditor(heading.line);
        if (previewVisible()) preview.revealAnchor(heading.id);
        else editor.focus();
    };

    // Double-click in the preview: find the source.
    const revealSource = (line) => {
        if (!editorVisible()) return;
        revealInEditor(line);
        editor.focus();
    };

    // ----- session -----

    let booted = false;
    let persistTimer = null;

    // The folder's key even while it waits for access. Saving null there
    // dropped every folder tab (and its backup) on the next reload.
    const folderKeyNow = () => library.key() ?? library.pending()?.id ?? null;

    const persistNow = () => {
        clearTimeout(persistTimer);
        if (!booted) return;
        session.save(session.snapshot({ docs: store.list(), active: store.active(), folder: folderKeyNow() }));
    };

    const persistSoon = () => {
        clearTimeout(persistTimer);
        persistTimer = setTimeout(persistNow, 300);
    };

    // Hot exit. On the way out, text that has not reached the disk is kept in
    // local storage (synchronously — the page will not wait for a file write).
    // The backup waits for its file: whenever that file is next loaded, by
    // any route, the text comes back as unsaved work. Backups of files that
    // are not loaded — a tab still waiting for access, or one closed before
    // it got it — are carried over until they expire.
    const BACKUP_TTL = 14 * 24 * 60 * 60 * 1000;

    const readBackups = () => read(KEYS.backups, null) ?? {};
    const storeBackups = (map) => {
        if (Object.keys(map).length === 0) {
            remove(KEYS.backups);
            return true;
        }
        return write(KEYS.backups, map);
    };

    const writeBackups = () => {
        const loaded = new Set(store.list().filter((doc) => doc.state !== 'locked').map((doc) => doc.key));
        const next = {};
        Object.entries(readBackups()).forEach(([key, backup]) => {
            if (!loaded.has(key)) next[key] = backup;
        });
        const at = Date.now();
        store.backups().forEach(({ key, text, base, docId, version }) => {
            next[key] = { text, base, docId, version, at };
        });
        return storeBackups(next);
    };

    // A write that reaches the disk makes a backup of the same or older text
    // history. An older write finishing later must not drop a newer backup.
    const dropBackup = ({ doc, text, versionId }) => {
        const all = readBackups();
        const backup = all[doc.key];
        if (!backup) return;
        const covered = backup.text === text || (backup.docId === doc.id && versionId >= backup.version);
        if (!covered) return;
        delete all[doc.key];
        storeBackups(all);
    };

    const applyBackup = (doc) => {
        const all = readBackups();
        const backup = all[doc.key];
        doc.hasBackup = false;
        if (!backup) return;
        store.restoreBackup(doc.id, backup);
        delete all[doc.key];
        storeBackups(all);
    };

    // A file from a folder that is going away keeps its tab — as a file on
    // its own, so the session and its backup can still find it.
    const detachFromFolder = async (doc) => {
        if (!doc.entry?.handle) return;
        const record = await files.remember(doc.entry.handle);
        const oldKey = doc.key;
        const key = session.fileKey(record);
        store.rebind(doc.id, { entry: files.entryForFile(doc.entry.handle, record), key });
        const all = readBackups();
        if (all[oldKey]) {
            all[key] = all[oldKey];
            delete all[oldKey];
            storeBackups(all);
        }
    };

    const reopenClosedTab = async () => {
        const doc = await store.reopenClosed();
        if (!doc) return;
        if (doc.entry?.root && doc.entry.root !== library.key()) await detachFromFolder(doc);
        enterDocuments();
    };

    const unlockOne = async (doc) => {
        try {
            if (doc.entry.root) {
                if (library.isOpen() && doc.entry.root === library.key()) {
                    await restoreFolderTabs();
                } else if (library.pending()?.id === doc.entry.root && (await library.resume())) {
                    await restoreFolderTabs();
                }
            } else if (doc.entry.handle && (await files.ensurePermission(doc.entry.handle))) {
                await store.unlock(doc.id);
            }
        } catch (error) {
            toast(t.openFileFailed);
        }
        syncLibrary();
        syncBanner();
    };

    // Placeholders of the open folder get the entries of its fresh walk. A
    // file the folder no longer has is closed — and if it held unsaved text,
    // that text opens as a draft named after it instead of disappearing.
    const restoreFolderTabs = async () => {
        for (const doc of store.list()) {
            if (doc.state !== 'locked' || !doc.entry.root || doc.entry.root !== library.key()) continue;
            const entry = library.entryByPath(doc.entry.path);
            if (entry) {
                try {
                    await store.unlock(doc.id, entry);
                    continue;
                } catch (error) {
                    // Unreadable: treated as gone below.
                }
            }
            const backup = readBackups()[doc.key];
            await store.close(doc.id, { force: true });
            if (backup) {
                store.openScratch({ type: doc.type, text: backup.text, label: doc.entry.name, activate: false });
                const all = readBackups();
                delete all[doc.key];
                storeBackups(all);
                toast(t.folderFileGone(doc.entry.name));
            }
        }
    };

    // One click grants what the previous session had: the folder and each
    // file opened on its own.
    const resumeAccess = async () => {
        try {
            if (library.pending() && (await library.resume())) await restoreFolderTabs();
            for (const doc of store.list()) {
                if (doc.state === 'locked' && !doc.entry.root && doc.entry.handle) {
                    if (await files.ensurePermission(doc.entry.handle)) await store.unlock(doc.id);
                }
            }
        } catch (error) {
            toast(t.permissionDenied);
        }
        syncLibrary();
        syncBanner();
    };

    const restoreSession = async (saved) => {
        for (const tab of saved.tabs) {
            if (tab.kind === 'scratch') {
                store.openScratch({
                    type: tab.type,
                    text: scratch.store.read(tab.id) ?? '',
                    scratchId: tab.id,
                    label: tab.label ?? '',
                    activate: false
                });
            } else if (tab.kind === 'folder') {
                // Older sessions did not record each tab's folder.
                const root = tab.root ?? saved.folder;
                if (!root || root !== saved.folder) continue;
                store.addLocked(
                    { name: basename(tab.path), dir: dirname(tab.path), path: tab.path, handle: null, root },
                    { key: session.folderKey(root, tab.path), type: tab.type }
                );
            } else if (tab.kind === 'file') {
                store.addLocked(
                    { name: tab.name, dir: '', path: tab.name, handle: null, root: null, record: tab.record },
                    { key: session.fileKey(tab.record), type: tab.type }
                );
            }
        }

        // Tabs still holding last session's unwritten text show it at once.
        const pending = readBackups();
        store.list().forEach((doc) => {
            if (doc.state === 'locked' && pending[doc.key]) doc.hasBackup = true;
        });

        if (saved.folder) {
            const state = await library.restore(saved.folder);
            if (state === 'open') await restoreFolderTabs();
            if (state === 'gone') {
                for (const doc of store.list()) {
                    if (doc.entry?.root) await store.close(doc.id, { force: true });
                }
            }
        }

        for (const doc of store.list()) {
            if (doc.state !== 'locked' || doc.entry.root) continue;
            const record = await files.recordById(doc.entry.record);
            if (!record) {
                await store.close(doc.id, { force: true });
                continue;
            }
            doc.entry.handle = record.handle;
            try {
                if ((await files.permissionOf(record.handle)) === 'granted') await store.unlock(doc.id);
            } catch (error) {
                // Still locked; the banner offers to ask again.
            }
        }

        // Scratch text nobody refers to any more, and backups past their time.
        scratch.prune(new Set(store.list().filter((doc) => doc.kind === 'scratch').map((doc) => doc.scratchId)));
        const backups = readBackups();
        const now = Date.now();
        Object.keys(backups).forEach((key) => {
            if (!(now - (backups[key].at ?? 0) < BACKUP_TTL)) delete backups[key];
        });
        storeBackups(backups);
        tabs.render();
    };

    // ----- keyboard -----

    const openPalette = () => {
        enterDocuments();
        palette.open({ placeholder: library.isOpen() ? t.searchPlaceholder : t.searchPlaceholderTabs });
    };

    document.addEventListener(
        'keydown',
        (event) => {
            if (isModKey(event)) {
                const key = event.key.toLowerCase();
                let handled = true;
                if (key === 'k' || (key === 'p' && !event.shiftKey)) {
                    // ⌘P too: the quick-open key people already have.
                    openPalette();
                } else if (key === 'o') {
                    // The browser's own ⌘O opens a page, not a document.
                    openFilesFlow();
                } else if (key === 's' && workbench === 'document' && shown) {
                    if (event.shiftKey) {
                        if (shown.kind === 'scratch') saveAs(shown.id);
                    } else {
                        store.flush(shown.id);
                    }
                } else if (key === 'b' && workbench === 'document') {
                    el.railToggle.click();
                } else {
                    handled = false;
                }
                // Kept from the editor as well: Monaco reads ⌘K as the start
                // of a chord and would sit waiting for the second key.
                if (handled) {
                    event.preventDefault();
                    event.stopPropagation();
                }
                return;
            }

            if (!isTabKey(event) || workbench !== 'document') return;
            // By physical key: with ⌥ held a Mac types ∑ for W, and other
            // layouts put brackets under other characters.
            const code = event.code;
            let handled = true;
            if (code === 'KeyW' && !event.shiftKey) {
                if (shown) closeTab(shown.id);
            } else if (code === 'KeyT' && event.shiftKey) {
                reopenClosedTab();
            } else if (code === 'KeyN' && event.shiftKey) {
                newScratch(shown?.type ?? 'markdown');
            } else if (/^Digit[1-9]$/.test(code)) {
                const list = store.list();
                const n = Number(code.slice(5));
                const target = n === 9 ? list.at(-1) : list[n - 1];
                if (target) store.activate(target.id);
            } else if (code === 'BracketRight') {
                cycleTab(1);
            } else if (code === 'BracketLeft') {
                cycleTab(-1);
            } else {
                handled = false;
            }
            if (handled) {
                event.preventDefault();
                event.stopPropagation();
            }
        },
        true
    );

    // ----- search -----

    const palette = paletteModule.setup({
        root: el.container,
        scrim: el.scrim,
        input: el.searchInput,
        results: el.searchResults,
        sources: () => ({
            tabs: store
                .mru()
                .filter((doc) => doc !== shown)
                .map((doc) => ({
                    kind: 'tab',
                    id: doc.id,
                    key: doc.key,
                    path: pathOf(doc),
                    note: doc.kind === 'scratch' ? t.draft : ''
                })),
            files: library.entries().map((entry) => ({
                kind: 'file',
                entry,
                key: session.folderKey(entry.root, entry.path),
                path: entry.path
            })),
            search: (query) => (library.isOpen() ? library.search(query) : [])
        }),
        onChoose: async (row) => {
            if (row.kind === 'tab') {
                store.activate(row.id);
                enterDocuments();
                editor.focus();
            } else if (row.kind === 'file') {
                await openEntry(row.entry);
            } else {
                const doc = await openEntry(row.entry);
                if (doc) {
                    editor.revealLineInCenter(row.line);
                    editor.setPosition({ lineNumber: row.line, column: 1 });
                    editor.focus();
                }
            }
        }
    });

    el.searchButton.addEventListener('click', openPalette);

    // ----- header actions -----

    el.resetButton.addEventListener('click', () => {
        const doc = shown;
        if (!doc?.model || doc.kind !== 'scratch') return;
        const sample = doc.type === 'json' ? defaultJson : defaultDocument;
        // An ordinary edit, so ⌘Z brings the old text back — no confirm
        // dialog standing between the click and the change.
        editor.pushUndoStop();
        editor.executeEdits('reset', [{ range: doc.model.getFullModelRange(), text: sample }]);
        editor.pushUndoStop();
        editor.setPosition({ lineNumber: 1, column: 1 });
        editor.revealLine(1);
        el.preview.scrollTo({ top: 0 });
        toast(t.resetDone(`${MOD}Z`));
    });

    el.copyButton.addEventListener('click', async () => {
        const label = el.copyButton.querySelector('.label');
        try {
            await navigator.clipboard.writeText(shown?.model?.getValue() ?? '');
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
        preview.flush();
        try {
            await toPdf({ output: el.output, title: shown ? labelOf(shown).name : t.appName });
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
        preview.rerenderDiagrams();
    });
    syncThemeButton(theme.get());

    el.themeButton.addEventListener('click', () => theme.toggle());

    // ----- layout -----

    const relayout = () => editor.layout();

    layout.setupSplit({ container: el.container, panes: el.panes, divider: el.divider, onResize: relayout });
    layout.setupModes({ container: el.container, group: el.modes, onChange: relayout });
    layout.setupRail({ container: el.container, toggle: el.railToggle, onChange: relayout });
    layout.setupMobileTabs({ container: el.container, tabs: el.mobileTabs, onChange: relayout });

    scrollSync.setup({
        editor,
        scroller: el.preview,
        checkbox: el.syncCheckbox,
        preview,
        isActive: () => shown?.type === 'markdown' && el.container.dataset.mode === 'split'
    });

    // ----- dropping documents on the window -----
    //
    // The gesture people already have for "open this in that". Chromium hands
    // over real handles, so dropped files are editable in place exactly like
    // picked ones — every one of them, now that there are tabs to put them in.
    // Elsewhere only the bytes come through and each opens as a copy.

    const setDropState = (over) => {
        if (over) el.container.dataset.drop = 'over';
        else delete el.container.dataset.drop;
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

        // Everything must be read before the first await — the DataTransfer
        // is emptied as soon as the handler yields.
        const dropped = Array.from(event.dataTransfer.items)
            .filter((item) => item.kind === 'file')
            .map((item) => ({ handle: item.getAsFileSystemHandle?.() ?? null, file: item.getAsFile() }));

        let rejected = false;
        for (const { handle: pending, file } of dropped) {
            // A synthetic or foreign item can resolve to no handle at all;
            // fall back to its bytes instead of failing on the missing handle.
            const handle = pending ? await pending.catch(() => null) : null;
            if (handle?.kind === 'directory') {
                try {
                    if (await library.openHandle(handle)) await afterFolderOpened();
                    else toast(t.permissionDenied);
                } catch (error) {
                    toast(t.openFolderFailed);
                }
                continue;
            }
            const name = handle?.name ?? file?.name ?? '';
            if (!files.isDocumentName(name)) {
                rejected = true;
                continue;
            }
            if (handle) {
                if (await files.ensurePermission(handle).catch(() => false)) await openFileHandle(handle);
                else toast(t.permissionDenied);
            } else if (file) {
                openCopy(file.name, await file.text());
            }
        }
        if (rejected) toast(t.notDocumentFile);
    });

    // ----- leaving and coming back -----

    // A page that goes away mid-debounce used to take the last edits with it.
    // On the way out scratch text is written and every unwritten file edit is
    // backed up, both synchronously; the file writes are started too. Only if
    // the backup itself fails (storage full) does the browser ask before
    // leaving — otherwise leaving is safe and needs no question.
    const leave = () => {
        store.flushScratchNow();
        const backedUp = writeBackups();
        persistNow();
        store.flushAll();
        return backedUp;
    };

    window.addEventListener('beforeunload', (event) => {
        const backedUp = leave();
        if ((!backedUp && store.hasUnsaved()) || store.hasUnstoredScratch()) {
            event.preventDefault();
            event.returnValue = '';
        }
    });

    window.addEventListener('pagehide', leave);

    // Files changed by other programs while the page was in the background:
    // clean tabs pick up the new text, tabs with edits go into conflict, and
    // the folder list picks up added and removed files.
    let checking = false;
    const checkDisk = async () => {
        if (checking || !booted) return;
        checking = true;
        try {
            await store.checkAll();
            await library.refresh();
        } finally {
            checking = false;
        }
    };

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            // A phone may discard a background tab without any unload event.
            leave();
        } else {
            checkDisk();
        }
    });
    window.addEventListener('focus', checkDisk);

    // ----- start -----

    scratch.migrateLegacy();
    const saved = session.load();
    const savedTool = read(KEYS.activeTool, 'markdown');

    if (saved) {
        await restoreSession(saved);
    } else {
        // First run with tabs: the old per-tool buffers become the first tabs,
        // so nothing written before this version is lost to it.
        store.openScratch({
            type: 'markdown',
            text: scratch.store.read('markdown') ?? defaultDocument,
            scratchId: 'markdown',
            activate: false
        });
        const json = scratch.store.read('json');
        if (json !== null) {
            store.openScratch({ type: 'json', text: json, scratchId: 'json', activate: false });
        }
    }

    const tool = toolsRegistry.byId(savedTool);
    const preferred =
        (saved?.active && store.findByKey(saved.active)) ||
        store.list().find((doc) => doc.state === 'ready' && (tool.kind !== 'document' || doc.type === tool.id)) ||
        store.list().find((doc) => doc.state === 'ready') ||
        store.list()[0] ||
        null;

    syncLibrary();
    if (preferred) store.activate(preferred.id);
    else showDoc(null);

    if (tool.kind !== 'document') activateTool(tool.id, { persist: false });
    else {
        syncChrome();
        syncBanner();
    }

    booted = true;
    persistNow();
};

window.addEventListener('DOMContentLoaded', init);

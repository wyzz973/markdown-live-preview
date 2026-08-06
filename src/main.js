import './styles/app.css';

import { defaultDocument } from './default-document.js';
import { t } from './modules/strings.js';
import { read, KEYS } from './modules/storage.js';
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
        previewWrapper: document.querySelector('#preview-wrapper'),
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
        saveDot: document.querySelector('#save-dot'),
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
        onOpenFile: (entry) => workspace.openEntry(entry)
    });

    const workspace = workspaceModule.create({
        onFilesChanged: (entries) => {
            rail.setFiles(entries);
            syncFolderChrome();
        },
        onFileOpened: ({ entry, text }) => {
            loading = true;
            editor.setValue(text ?? defaultDocument);
            editor.revealPosition({ lineNumber: 1, column: 1 });
            loading = false;
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

    toolbarModule.setup({ container: el.toolbar, editor });

    // ----- render pipeline -----

    const convert = (markdown) => {
        el.output.innerHTML = renderer.render(markdown);
        const headings = renderer.outline(el.output);
        rail.setHeadings(headings);
        const entry = workspace.currentEntry();
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
            await toPdf({ source: el.previewWrapper, output: el.output });
        } catch (error) {
            console.error('导出 PDF 失败', error);
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

    // Loading the scratch buffer is not an edit, so it must not mark the
    // document dirty or trigger a save.
    loading = true;
    editor.setValue(read(KEYS.content) || defaultDocument);
    loading = false;

    editor.revealPosition({ lineNumber: 1, column: 1 });
    editor.focus();
    el.saveDot.title = t.saved;
};

window.addEventListener('DOMContentLoaded', init);

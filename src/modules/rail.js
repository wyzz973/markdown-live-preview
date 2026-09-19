// The navigator rail.
//
// One rail, not two sidebars. Folder depth and heading depth are the same tree,
// so the open file expands in place into its headings. Heading depth is drawn
// in the document's own hash marks; the indent is applied in pixels rather than
// by padding the string, so a Chinese heading indents exactly like a Latin one,
// and a document that jumps from `#` to `####` shows the gap in the staircase.
//
// A long document's outline can push the rest of the folder far down the rail,
// so clicking the current file folds its outline away (and back).

import { t } from './strings.js';
import { formatSize } from './files.js';

const INDENT_PER_LEVEL = 9;
const BASE_INDENT = 8;

export const setup = ({ container, countLabel, preview, output, onOpenFile, onNavigate }) => {
    let headings = [];
    let headingRows = [];
    let headingSignature = '';
    let files = [];
    let truncated = false;
    let currentPath = null;
    let dirtyPaths = new Set();
    let collapsed = false;
    // The preview elements the headings point at, resolved once per render
    // rather than looked up again on every scroll event.
    let targets = null;

    const setActiveHeading = (row) => {
        headingRows.forEach((r) => r.classList.toggle('active', r === row));
    };

    // Markdown scrolls the preview to the heading and marks it; JSON has no
    // preview anchor and reveals the line in the editor instead. The rail does
    // not need to know which — the active tool supplies the behaviour.
    const jumpTo = (heading, row) => {
        setActiveHeading(row);
        onNavigate?.(heading);
    };

    // The left column always speaks the notation of the format being edited:
    // Markdown draws depth in its own hashes, JSON in its own braces and
    // brackets. Both list only what is navigable — headings, containers — and
    // never the leaves, which would bury the structure they are meant to show.
    const buildHeadingRows = () => {
        headingRows = headings.map((heading) => {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'head-row';
            row.style.paddingLeft = `${BASE_INDENT + (heading.level - 1) * INDENT_PER_LEVEL}px`;

            const token = document.createElement('span');
            token.className = 'hashes';
            token.setAttribute('aria-hidden', 'true');
            token.textContent = heading.token ?? '#'.repeat(heading.level);

            const label = document.createElement('span');
            label.className = 'label';
            label.textContent = heading.text;

            row.append(token, label);

            if (heading.count !== undefined) {
                const count = document.createElement('span');
                count.className = 'meta';
                count.textContent =
                    heading.unit === 'items' ? t.items(heading.count) : t.keys(heading.count);
                row.appendChild(count);
            }

            row.title = heading.text;
            row.addEventListener('click', () => jumpTo(heading, row));
            return row;
        });

        return headingRows;
    };

    const emptyOutline = () => {
        const box = document.createElement('div');
        box.className = 'outline-empty';
        const first = document.createElement('p');
        first.textContent = t.outlineEmpty;
        const second = document.createElement('p');
        second.textContent = t.outlineEmptyHint;
        box.append(first, second);
        return box;
    };

    const buildFileRow = (file) => {
        const current = file.path === currentPath;
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'file-row';
        row.setAttribute('aria-current', String(current));
        if (current) row.setAttribute('aria-expanded', String(!collapsed));
        row.title = file.path;
        row.dataset.path = file.path;

        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = file.name;

        const unsaved = dirtyPaths.has(file.path);
        const meta = document.createElement('span');
        // Red is reserved for unsaved work; a file size is not a warning.
        meta.className = unsaved ? 'meta unsaved' : 'meta';
        meta.textContent = unsaved
            ? t.edited
            : file.size === undefined
              ? ''
              : formatSize(file.size);

        row.append(name, meta);
        row.addEventListener('click', (event) => {
            if (current && !event.metaKey && !event.ctrlKey) {
                collapsed = !collapsed;
                render();
                return;
            }
            onOpenFile(file, { pinned: event.metaKey || event.ctrlKey });
        });
        row.addEventListener('dblclick', () => onOpenFile(file, { pinned: true }));
        return row;
    };

    const render = () => {
        targets = null;
        // With a folder open the headline number is how many documents it
        // holds; the per-file heading count is implicit in the tree below.
        // Both live here so the two never race to write the same label.
        // "标题" belongs to Markdown; a JSON outline counts containers. The
        // outline rows carry their own notation, so read it off them.
        const isMarkdown = headings.length === 0 || headings[0].token === undefined;
        countLabel.textContent = files.length
            ? (truncated ? t.fileCountTruncated : t.fileCount)(files.length)
            : headings.length
              ? (isMarkdown ? t.headingCount : t.nodeCount)(headings.length)
              : '';

        // No folder open: the rail is just the outline of the open document.
        if (files.length === 0) {
            container.replaceChildren(...(headings.length ? buildHeadingRows() : [emptyOutline()]));
            return;
        }

        const nodes = [];
        let lastDir = null;
        headingRows = [];

        files.forEach((file) => {
            const dir = file.dir || '';
            if (dir !== lastDir) {
                const label = document.createElement('span');
                label.className = 'group-label';
                label.textContent = dir ? `${dir}/` : t.folderRoot;
                nodes.push(label);
                lastDir = dir;
            }

            nodes.push(buildFileRow(file));

            // The open file continues into its own heading tree — same rail,
            // same gesture, one level deeper.
            if (file.path === currentPath && !collapsed) {
                const box = document.createElement('div');
                box.className = 'outline-nested';
                box.append(...(headings.length ? buildHeadingRows() : [emptyOutline()]));
                nodes.push(box);
            }
        });

        container.replaceChildren(...nodes);
    };

    // Highlight whichever heading the reader is currently under.
    const syncActive = () => {
        // Only meaningful when the outline points at anchors in the preview —
        // a JSON outline points at editor lines and has nothing to follow here.
        if (headingRows.length === 0 || !headings[0]?.id) return;

        if (!targets) {
            targets = headings.map((heading) => output.querySelector(`#${CSS.escape(heading.id)}`));
        }

        const top = preview.scrollTop + 24;
        let index = 0;
        for (let i = 0; i < targets.length; i += 1) {
            const element = targets[i];
            if (!element) continue;
            if (element.offsetTop > top) break;
            index = i;
        }
        setActiveHeading(headingRows[index]);
    };

    preview.addEventListener('scroll', syncActive, { passive: true });

    return {
        setHeadings(next) {
            // Most keystrokes change no heading at all; rebuilding hundreds of
            // rows for each of them was the rail's whole cost while typing.
            const signature = next.map((h) => `${h.level}|${h.token ?? ''}|${h.text}|${h.id ?? ''}|${h.line ?? ''}|${h.count ?? ''}`).join('\n');
            if (signature === headingSignature) {
                targets = null;
                return;
            }
            headingSignature = signature;
            headings = next;
            render();
        },
        setFiles(next, { truncated: isTruncated = false } = {}) {
            files = next;
            truncated = isTruncated;
            render();
        },
        setCurrentPath(path) {
            if (path === currentPath) return;
            currentPath = path;
            collapsed = false;
            render();
            container.querySelector('.file-row[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
        },
        setDirty(paths) {
            const next = new Set(paths);
            if (next.size === dirtyPaths.size && [...next].every((path) => dirtyPaths.has(path))) return;
            dirtyPaths = next;
            render();
        },
        reveal(path) {
            collapsed = false;
            render();
            const row = Array.from(container.querySelectorAll('.file-row')).find((r) => r.dataset.path === path);
            row?.scrollIntoView({ block: 'center' });
            row?.focus();
        }
    };
};

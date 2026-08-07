// The navigator rail.
//
// One rail, not two sidebars. Folder depth and heading depth are the same tree,
// so the open file expands in place into its headings. Heading depth is drawn
// in the document's own hash marks; the indent is applied in pixels rather than
// by padding the string, so a Chinese heading indents exactly like a Latin one,
// and a document that jumps from `#` to `####` shows the gap in the staircase.

import { t } from './strings.js';
import { formatSize } from './files.js';

const INDENT_PER_LEVEL = 9;
const BASE_INDENT = 8;

export const setup = ({ container, countLabel, preview, output, onOpenFile, onNavigate }) => {
    let headings = [];
    let headingRows = [];
    let files = [];
    let currentPath = null;
    let dirty = false;

    const setActiveHeading = (row) => {
        headingRows.forEach((r) => r.classList.toggle('active', r === row));
    };

    // Markdown scrolls the preview to the heading and marks it; JSON has no
    // preview anchor and reveals the line in the editor instead. The rail does
    // not need to know which — the active tool supplies the behaviour.
    const jumpTo = (heading, row) => {
        setActiveHeading(row);

        if (onNavigate?.(heading) !== false) {
            return;
        }

        const target = output.querySelector(`#${CSS.escape(heading.id)}`);
        if (!target) {
            return;
        }

        preview.scrollTo({
            top: target.offsetTop - 12,
            behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
                ? 'auto'
                : 'smooth'
        });

        target.classList.remove('jump-flash');
        // Force a reflow so the animation restarts on a repeat click.
        void target.offsetWidth;
        target.classList.add('jump-flash');
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
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'file-row';
        row.setAttribute('aria-current', String(file.path === currentPath));
        row.title = file.path;

        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = file.name;

        const unsaved = file.path === currentPath && dirty;
        const meta = document.createElement('span');
        // Red is reserved for unsaved work; a file size is not a warning.
        meta.className = unsaved ? 'meta unsaved' : 'meta';
        meta.textContent = unsaved
            ? t.edited
            : file.size === undefined
              ? ''
              : formatSize(file.size);

        row.append(name, meta);
        row.addEventListener('click', () => onOpenFile(file));
        return row;
    };

    const render = () => {
        // With a folder open the headline number is how many documents it
        // holds; the per-file heading count is implicit in the tree below.
        // Both live here so the two never race to write the same label.
        // "标题" belongs to Markdown; a JSON outline counts containers. The
        // outline rows carry their own notation, so read it off them.
        const isMarkdown = headings.length === 0 || headings[0].token === undefined;
        countLabel.textContent = files.length
            ? t.fileCount(files.length)
            : headings.length
              ? (isMarkdown ? t.headingCount : t.nodeCount)(headings.length)
              : '';

        // No folder open: the rail is just the outline of the scratch buffer.
        if (files.length === 0) {
            container.replaceChildren(
                ...(headings.length ? buildHeadingRows() : [emptyOutline()])
            );
            return;
        }

        const nodes = [];
        let lastDir = null;

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
            if (file.path === currentPath) {
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
        if (headingRows.length === 0 || !headings[0]?.id) {
            return;
        }

        const top = preview.scrollTop + 24;
        let index = 0;
        headings.forEach((heading, i) => {
            const el = output.querySelector(`#${CSS.escape(heading.id)}`);
            if (el && el.offsetTop <= top) {
                index = i;
            }
        });

        setActiveHeading(headingRows[index]);
    };

    preview.addEventListener('scroll', syncActive, { passive: true });

    return {
        setHeadings(next) {
            headings = next;
            render();
        },
        setFiles(next) {
            files = next;
            render();
        },
        setCurrentPath(path) {
            currentPath = path;
            render();
        },
        setDirty(next) {
            if (dirty === next) return;
            dirty = next;
            render();
        }
    };
};

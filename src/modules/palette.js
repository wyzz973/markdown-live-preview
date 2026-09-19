// The ⌘K / ⌘P palette: quick open.
//
// It used to search file contents only, and only with a folder open. Finding a
// file by name meant scrolling a rail whose current file had unfolded its
// whole outline in between. Now one box answers all three questions — which
// tab, which file, which line — in that order:
//
//   empty query  the open tabs, most recently used first
//   a query      matching tabs, then files by name, then lines by content
//
// Matches wear the same wash as the active file and the jump flash, so the
// colour means one thing throughout: this is marked.

import { t } from './strings.js';
import { rank } from './fuzzy.js';

const TAB_LIMIT = 6;
const FILE_LIMIT = 12;

// Wrap the characters at `positions` in <mark>.
const highlighted = (text, positions = []) => {
    const fragment = document.createDocumentFragment();
    const marks = new Set(positions);
    let run = '';
    let marking = false;
    const flush = () => {
        if (!run) return;
        if (marking) {
            const mark = document.createElement('mark');
            mark.textContent = run;
            fragment.appendChild(mark);
        } else {
            fragment.append(run);
        }
        run = '';
    };
    for (let i = 0; i < text.length; i += 1) {
        const marked = marks.has(i);
        if (marked !== marking) {
            flush();
            marking = marked;
        }
        run += text[i];
    }
    flush();
    return fragment;
};

export const setup = ({ root, scrim, input, results, sources, onChoose }) => {
    let rows = [];
    let selected = 0;

    const isOpen = () => root.dataset.search === 'open';

    const close = () => {
        root.dataset.search = 'closed';
    };

    const choose = (row) => {
        close();
        onChoose(row);
    };

    const buildRow = (row, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `result${index === selected ? ' selected' : ''}`;
        button.dataset.index = String(index);

        const where = document.createElement('span');
        where.className = 'result-where';

        if (row.kind === 'hit') {
            if (row.entry.dir) {
                const dir = document.createElement('span');
                dir.className = 'result-dir';
                dir.textContent = `${row.entry.dir}/`;
                where.appendChild(dir);
            }
            const name = document.createElement('span');
            name.textContent = row.entry.name;
            where.appendChild(name);
            const line = document.createElement('span');
            line.className = 'result-line-no';
            line.textContent = t.lineNumber(row.line);
            where.appendChild(line);

            const snippet = document.createElement('span');
            snippet.className = 'result-snippet';
            const before = row.snippet.slice(0, row.matchStart);
            const match = row.snippet.slice(row.matchStart, row.matchStart + row.matchLength);
            const after = row.snippet.slice(row.matchStart + row.matchLength);
            const mark = document.createElement('mark');
            mark.textContent = match;
            snippet.append(before, mark, after);
            button.append(where, snippet);
        } else {
            // A tab or a file: the path, with the typed characters marked.
            const path = row.path;
            const slash = path.lastIndexOf('/');
            const positions = row.positions ?? [];
            if (slash !== -1) {
                const dir = document.createElement('span');
                dir.className = 'result-dir';
                dir.appendChild(highlighted(path.slice(0, slash + 1), positions.filter((p) => p <= slash)));
                where.appendChild(dir);
            }
            const name = document.createElement('span');
            name.appendChild(
                highlighted(
                    path.slice(slash + 1),
                    positions.filter((p) => p > slash).map((p) => p - slash - 1)
                )
            );
            where.appendChild(name);
            if (row.note) {
                const note = document.createElement('span');
                note.className = 'result-line-no';
                note.textContent = row.note;
                where.appendChild(note);
            }
            button.appendChild(where);
        }

        button.addEventListener('click', () => choose(row));
        return button;
    };

    const paint = () => {
        const sections = [];
        let index = 0;
        let label = null;
        rows.forEach((row) => {
            if (row.section !== label) {
                label = row.section;
                const heading = document.createElement('span');
                heading.className = 'menu-label palette-section';
                heading.textContent = label;
                sections.push(heading);
            }
            sections.push(buildRow(row, index));
            index += 1;
        });

        if (rows.length === 0) {
            const message = document.createElement('p');
            message.className = 'palette-empty';
            message.textContent = input.value.trim() ? t.searchNoMatch : t.searchHint;
            results.replaceChildren(message);
            return;
        }
        results.replaceChildren(...sections);
    };

    const run = () => {
        const query = input.value.trim();
        const { tabs, files, search } = sources();

        if (!query) {
            rows = tabs.map((tab) => ({ ...tab, section: t.sectionTabs }));
        } else {
            const openKeys = new Set(tabs.map((tab) => tab.key));
            const tabHits = rank(query, tabs, (tab) => tab.path, TAB_LIMIT).map((hit) => ({
                ...hit.item,
                positions: hit.positions,
                section: t.sectionTabs
            }));
            const fileHits = rank(
                query,
                files.filter((file) => !openKeys.has(file.key)),
                (file) => file.path,
                FILE_LIMIT
            ).map((hit) => ({ ...hit.item, positions: hit.positions, section: t.sectionFiles }));
            const lineHits = search(query).map((hit) => ({ ...hit, kind: 'hit', section: t.sectionContent }));
            rows = [...tabHits, ...fileHits, ...lineHits];
        }
        selected = 0;
        paint();
    };

    const move = (delta) => {
        if (rows.length === 0) return;
        selected = Math.min(rows.length - 1, Math.max(0, selected + delta));
        results.querySelectorAll('.result').forEach((button) => {
            button.classList.toggle('selected', Number(button.dataset.index) === selected);
        });
        results.querySelector('.result.selected')?.scrollIntoView({ block: 'nearest' });
    };

    const open = ({ placeholder }) => {
        root.dataset.search = 'open';
        input.placeholder = placeholder;
        input.value = '';
        run();
        input.focus();
    };

    input.addEventListener('input', run);

    input.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            close();
        } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            move(1);
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            move(-1);
        } else if (event.key === 'Enter' && rows[selected]) {
            event.preventDefault();
            choose(rows[selected]);
        }
    });

    // A press on the dimmed backdrop closes the palette. (The old check
    // compared against the container instead of the backdrop, so only Escape
    // ever closed it.)
    scrim.addEventListener('mousedown', (event) => {
        if (event.target === scrim) close();
    });

    return { open, close, isOpen };
};

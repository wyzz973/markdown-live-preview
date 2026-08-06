// The ⌘K search overlay.
//
// Matches are highlighted with the same wash used for the active file and the
// jump flash, so the colour means one thing throughout: this is marked.

import { t } from './strings.js';

export const setup = ({ root, input, results, onOpenHit, search }) => {
    let hits = [];
    let selected = 0;

    const isOpen = () => root.dataset.search === 'open';

    const paint = () => {
        if (hits.length === 0) {
            const message = document.createElement('p');
            message.className = 'palette-empty';
            message.textContent = input.value.trim() ? t.searchNoMatch : t.searchHint;
            results.replaceChildren(message);
            return;
        }

        results.replaceChildren(
            ...hits.map((hit, index) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = `result${index === selected ? ' selected' : ''}`;

                const where = document.createElement('span');
                where.className = 'result-where';

                if (hit.entry.dir) {
                    const dir = document.createElement('span');
                    dir.className = 'result-dir';
                    dir.textContent = `${hit.entry.dir}/`;
                    where.appendChild(dir);
                }

                const name = document.createElement('span');
                name.textContent = hit.entry.name;
                where.appendChild(name);

                const line = document.createElement('span');
                line.className = 'result-line-no';
                line.textContent = t.lineNumber(hit.line);
                where.appendChild(line);

                const snippet = document.createElement('span');
                snippet.className = 'result-snippet';
                const before = hit.snippet.slice(0, hit.matchStart);
                const match = hit.snippet.slice(hit.matchStart, hit.matchStart + hit.matchLength);
                const after = hit.snippet.slice(hit.matchStart + hit.matchLength);
                const mark = document.createElement('mark');
                mark.textContent = match;
                snippet.append(before, mark, after);

                button.append(where, snippet);
                button.addEventListener('click', () => {
                    onOpenHit(hit);
                    close();
                });
                return button;
            })
        );
    };

    const run = () => {
        hits = search(input.value);
        selected = 0;
        paint();
    };

    const move = (delta) => {
        if (hits.length === 0) return;
        selected = Math.min(hits.length - 1, Math.max(0, selected + delta));
        paint();
        results.children[selected]?.scrollIntoView({ block: 'nearest' });
    };

    const open = () => {
        root.dataset.search = 'open';
        input.value = '';
        run();
        input.focus();
    };

    const close = () => {
        root.dataset.search = 'closed';
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
        } else if (event.key === 'Enter' && hits[selected]) {
            event.preventDefault();
            onOpenHit(hits[selected]);
            close();
        }
    });

    root.addEventListener('mousedown', (event) => {
        if (event.target === root) {
            close();
        }
    });

    return { open, close, isOpen };
};

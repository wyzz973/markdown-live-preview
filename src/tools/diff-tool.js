// Compare two things.
//
// Two lenses on the same pair of inputs rather than two tools: 「并排」 is
// Monaco's character diff, 「结构」 compares the two as JSON trees. The second
// exists because a character diff of two API responses is mostly noise — the
// keys came back in a different order, one side was pretty-printed — and the
// question you actually have is which values changed.

import * as editorModule from '../modules/editor.js';
import { diff as structuralDiff, preview } from '../modules/json-diff.js';
import { t } from '../modules/strings.js';

const SAMPLE_LEFT = `{
  "name": "工具站",
  "version": "1.2.0",
  "features": ["markdown", "json"],
  "limits": { "depth": 6, "files": 2000 },
  "users": [
    { "id": "u1", "name": "阿榆", "role": "admin" },
    { "id": "u2", "name": "小林", "role": "member" }
  ]
}`;

const SAMPLE_RIGHT = `{
  "version": "1.3.0",
  "name": "工具站",
  "features": ["markdown", "json", "diff"],
  "limits": { "depth": 6, "files": 4000 },
  "users": [
    { "id": "u0", "name": "新同事", "role": "member" },
    { "id": "u1", "name": "阿榆", "role": "owner" },
    { "id": "u2", "name": "小林", "role": "member" }
  ]
}`;

const MARKS = { add: '+', remove: '−', change: '~' };

const parse = (text) => {
    if (!text.trim()) return { ok: false };
    try {
        return { ok: true, value: JSON.parse(text) };
    } catch (error) {
        return { ok: false, error };
    }
};

export const create = () => {
    let activeTab = 'side';
    let ignoreWhitespace = false;

    const root = document.createElement('div');
    root.className = 'utility utility-diff';

    // ----- bar -----

    const bar = document.createElement('div');
    bar.className = 'utility-bar utility-tabs';
    bar.setAttribute('role', 'tablist');

    const makeTab = (id, label) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'utility-tab';
        button.dataset.tab = id;
        button.setAttribute('role', 'tab');
        button.textContent = label;
        button.addEventListener('click', () => {
            activeTab = id;
            paint();
        });
        return button;
    };

    const sideTab = makeTab('side', t.diffTabSideBySide);
    const structureTab = makeTab('structure', t.diffTabStructure);

    const ghost = (label, onClick) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'ghost';
        button.textContent = label;
        button.addEventListener('click', onClick);
        return button;
    };

    const sampleButton = ghost(t.diffSample, () => {
        original.setValue(SAMPLE_LEFT);
        modified.setValue(SAMPLE_RIGHT);
        run();
    });

    const swapButton = ghost(t.swap, () => {
        const left = original.getValue();
        original.setValue(modified.getValue());
        modified.setValue(left);
        run();
    });

    const formatButton = ghost(t.diffFormatBoth, () => {
        [original, modified].forEach((model) => {
            const parsed = parse(model.getValue());
            if (parsed.ok) {
                model.setValue(JSON.stringify(parsed.value, null, 2));
            }
        });
        run();
    });

    const whitespaceToggle = document.createElement('label');
    whitespaceToggle.className = 'utility-switch';
    const whitespaceInput = document.createElement('input');
    whitespaceInput.type = 'checkbox';
    const whitespaceText = document.createElement('span');
    whitespaceText.textContent = t.diffIgnoreWhitespace;
    whitespaceToggle.append(whitespaceInput, whitespaceText);

    // A flex:1 spacer, not an auto margin on the first button: `.utility-tabs
    // .ghost` sets margin-left:auto, and with several ghosts flexbox splits the
    // free space between all of them, scattering the actions across the bar.
    // The spacer eats the free space first, leaving the auto margins with none.
    const spacer = document.createElement('span');
    spacer.className = 'bar-spacer';

    bar.append(
        sideTab,
        structureTab,
        spacer,
        sampleButton,
        swapButton,
        formatButton,
        whitespaceToggle
    );

    // ----- side-by-side -----

    const sideView = document.createElement('div');
    sideView.className = 'diff-side';

    // Which column is "before" is not guessable, and the whole reading of a
    // monochrome diff depends on knowing it.
    const columns = document.createElement('div');
    columns.className = 'diff-columns';
    [t.diffOriginal, t.diffModified].forEach((label) => {
        const cell = document.createElement('span');
        cell.textContent = label;
        columns.appendChild(cell);
    });

    const diffHost = document.createElement('div');
    diffHost.className = 'diff-host';

    sideView.append(columns, diffHost);

    const { diffEditor, original, modified } = editorModule.createDiff(diffHost);

    // ----- structure -----

    const structureView = document.createElement('div');
    structureView.className = 'utility-body diff-structure';
    structureView.hidden = true;

    const status = document.createElement('div');
    status.className = 'utility-status';

    root.append(bar, sideView, structureView, status);

    // ----- painting -----

    const chip = (text, tone) => {
        const span = document.createElement('span');
        span.className = tone ? `chip chip-${tone}` : 'chip';
        span.textContent = text;
        return span;
    };

    const emptyNote = (text) => {
        const note = document.createElement('p');
        note.className = 'utility-empty';
        note.textContent = text;
        return note;
    };

    let structure = null;

    const buildRow = (change) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = `diff-row diff-${change.kind}`;

        const mark = document.createElement('span');
        mark.className = 'diff-mark';
        mark.setAttribute('aria-hidden', 'true');
        mark.textContent = MARKS[change.kind];

        const path = document.createElement('span');
        path.className = 'diff-path';
        path.textContent = change.path;

        const value = document.createElement('span');
        value.className = 'diff-value';
        if (change.kind === 'change') {
            const before = document.createElement('span');
            before.className = 'diff-before';
            before.textContent = preview(change.before);
            const arrow = document.createElement('span');
            arrow.className = 'diff-arrow';
            arrow.textContent = '→';
            const after = document.createElement('span');
            after.textContent = preview(change.after);
            value.append(before, arrow, after);
        } else {
            value.textContent = preview(change.kind === 'add' ? change.after : change.before);
        }

        row.append(mark, path, value);
        // The path is the thing you want next — to paste into the JSON tool's
        // query box, or into code.
        row.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(change.path);
                row.classList.add('copied');
                setTimeout(() => row.classList.remove('copied'), 900);
            } catch (error) {
                // Clipboard refused; the path is still on screen to select.
            }
        });
        return row;
    };

    const paintStructure = () => {
        const left = parse(original.getValue());
        const right = parse(modified.getValue());

        if (!left.ok || !right.ok) {
            structure = null;
            structureView.replaceChildren(
                emptyNote(
                    original.getValue().trim() || modified.getValue().trim()
                        ? t.diffNeedsJson
                        : t.diffEmpty
                )
            );
            return;
        }

        structure = structuralDiff(left.value, right.value);

        if (structure.changes.length === 0) {
            structureView.replaceChildren(emptyNote(t.diffStructureSame));
            return;
        }

        const list = document.createElement('div');
        list.className = 'diff-rows';
        structure.changes.forEach((change) => list.appendChild(buildRow(change)));
        structureView.replaceChildren(list);
    };

    const paintStatus = () => {
        status.replaceChildren();

        const left = original.getValue();
        const right = modified.getValue();
        if (!left.trim() && !right.trim()) {
            return;
        }

        if (left === right) {
            status.appendChild(chip(t.diffSame, 'strong'));
            return;
        }

        status.appendChild(
            chip(t.diffLines(left.split('\n').length, right.split('\n').length))
        );

        if (structure) {
            const { add, remove, change } = structure.counts;
            status.appendChild(chip(t.diffCounts(add, remove, change), 'strong'));
            if (structure.truncated) {
                status.appendChild(chip(t.diffTruncated, 'warn'));
            }
        } else if (activeTab === 'structure') {
            status.appendChild(chip(t.diffBadJson, 'warn'));
        }
    };

    const paint = () => {
        const showSide = activeTab === 'side';
        sideTab.classList.toggle('active', showSide);
        sideTab.setAttribute('aria-selected', String(showSide));
        structureTab.classList.toggle('active', !showSide);
        structureTab.setAttribute('aria-selected', String(!showSide));

        sideView.hidden = !showSide;
        structureView.hidden = showSide;
        // Toggling only matters to the side-by-side pane; a structural diff
        // compares parsed values, where whitespace never existed.
        whitespaceToggle.hidden = !showSide;
        formatButton.hidden = !showSide;

        if (showSide) {
            diffEditor.layout();
        }

        // The counts in the status strip come from the structural pass, so it
        // runs even when the side-by-side tab is showing.
        paintStructure();
        paintStatus();
    };

    const run = () => {
        // JSON on both sides gets JSON highlighting; anything else stays plain
        // so a Markdown or log comparison is not painted with false syntax.
        const language =
            parse(original.getValue()).ok && parse(modified.getValue()).ok ? 'json' : 'plaintext';
        editorModule.setModelLanguage(original, language);
        editorModule.setModelLanguage(modified, language);
        paint();
    };

    original.onDidChangeContent(run);
    modified.onDidChangeContent(run);

    whitespaceInput.addEventListener('change', () => {
        ignoreWhitespace = whitespaceInput.checked;
        diffEditor.updateOptions({ ignoreTrimWhitespace: ignoreWhitespace });
    });

    paint();

    return {
        root,
        focus: () => {
            diffEditor.layout();
            diffEditor.getOriginalEditor().focus();
        }
    };
};

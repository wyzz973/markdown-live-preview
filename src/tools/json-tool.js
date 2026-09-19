// The JSON document tool's preview pane.
//
// Deliberately not a tree view: Monaco already folds and colours the document,
// and the rail already carries the structure, so a third copy of the same tree
// would earn nothing. What is missing is everything you want to *do* with the
// payload — query it, convert it, check it — so that is what this pane is.
//
// Query and conversion compose: with a JSONPath typed in, every conversion
// works on what the query selected, so `$.data` then CSV turns the records of
// an API response into a table instead of one row holding the whole payload.
// Which mode and which query are per tab; the tab carries them (see main.js).

import * as json from '../modules/json-tools.js';
import { t } from '../modules/strings.js';

const MODES = [
    { id: 'query', label: () => t.jsonQueryLabel },
    { id: 'yaml', label: () => t.convertYaml },
    { id: 'csv', label: () => t.convertCsv },
    { id: 'markdown', label: () => t.convertMarkdown },
    { id: 'ts', label: () => t.convertTs },
    { id: 'go', label: () => t.convertGo }
];

export const create = ({ onOpenInMarkdown, onStateChange }) => {
    let parsed = { ok: true, value: null, empty: true };
    let mode = 'query';
    let path = '';

    const root = document.createElement('div');
    root.className = 'json-panel';

    // ----- mode selector -----
    const bar = document.createElement('div');
    bar.className = 'json-modes';
    bar.setAttribute('role', 'tablist');

    const modeButtons = MODES.map((item) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'json-mode';
        button.dataset.mode = item.id;
        button.setAttribute('role', 'tab');
        button.textContent = item.label();
        button.addEventListener('click', () => {
            mode = item.id;
            paint();
            onStateChange?.();
        });
        bar.appendChild(button);
        return button;
    });

    // ----- query input -----
    const queryRow = document.createElement('div');
    queryRow.className = 'json-query';

    const queryInput = document.createElement('input');
    queryInput.type = 'text';
    queryInput.spellcheck = false;
    queryInput.placeholder = t.jsonQueryPlaceholder;
    queryInput.setAttribute('aria-label', t.jsonQueryLabel);
    queryInput.addEventListener('input', () => {
        path = queryInput.value;
        paint();
        onStateChange?.();
    });

    const queryCount = document.createElement('span');
    queryCount.className = 'json-query-count';

    queryRow.append(queryInput, queryCount);

    // ----- output -----
    const output = document.createElement('pre');
    output.className = 'json-output';

    const note = document.createElement('p');
    note.className = 'json-note';

    const actions = document.createElement('div');
    actions.className = 'json-actions';

    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.className = 'ghost';
    copyButton.textContent = t.copyOutput;
    copyButton.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(output.textContent);
            copyButton.textContent = t.copied;
        } catch (error) {
            copyButton.textContent = t.copyFailed;
        }
        setTimeout(() => {
            copyButton.textContent = t.copyOutput;
        }, 1200);
    });

    const openMarkdownButton = document.createElement('button');
    openMarkdownButton.type = 'button';
    openMarkdownButton.className = 'ghost';
    openMarkdownButton.textContent = t.streamOpenInMarkdown;
    openMarkdownButton.addEventListener('click', () => onOpenInMarkdown?.(output.textContent));

    actions.append(copyButton, openMarkdownButton);

    root.append(bar, queryRow, note, output, actions);

    // ----- painting -----

    const setNote = (text, tone) => {
        note.textContent = text ?? '';
        note.hidden = !text;
        note.className = tone ? `json-note json-note-${tone}` : 'json-note';
    };

    const convert = (value) => {
        if (mode === 'yaml') return { text: json.toYaml(value) };
        if (mode === 'ts') return { text: json.toTypeScript(value) };
        if (mode === 'go') return { text: json.toGo(value) };

        const table = mode === 'csv' ? json.toCsv(value) : json.toMarkdownTable(value);
        return table === null ? { error: t.convertNeedsRows } : { text: table };
    };

    // Whether the document parses, said every time: a query with no matches
    // on a document that only parsed after repair used to report nothing but
    // "0 个匹配".
    const validity = () =>
        parsed.repaired ? { text: t.jsonRepaired, tone: 'warn' } : { text: t.jsonValid, tone: 'good' };

    const paint = () => {
        modeButtons.forEach((button) => {
            const selected = button.dataset.mode === mode;
            button.classList.toggle('active', selected);
            button.setAttribute('aria-selected', String(selected));
        });

        openMarkdownButton.hidden = mode !== 'markdown';
        queryCount.textContent = '';

        if (parsed.empty) {
            setNote(t.jsonEmpty);
            output.textContent = '';
            actions.hidden = true;
            return;
        }

        if (!parsed.ok) {
            setNote(t.jsonInvalid(parsed.error.message), 'bad');
            output.textContent = '';
            actions.hidden = true;
            return;
        }

        actions.hidden = false;

        const result = json.query(parsed.value, path);
        if (!result.ok) {
            setNote(t.jsonQueryBad, 'bad');
            output.textContent = '';
            actions.hidden = true;
            return;
        }

        // A path that selects one node (`$.data`) means that node, not a
        // one-element list around it — otherwise `$.data` then CSV would see
        // an array holding an array and refuse to make a table.
        const selection = result.empty
            ? parsed.value
            : result.result.length === 1
              ? result.result[0]
              : result.result;
        if (!result.empty) {
            queryCount.textContent = t.jsonQueryHits(result.result.length);
        }

        if (mode === 'query') {
            const { text, tone } = validity();
            setNote(text, tone);
            output.textContent = JSON.stringify(selection, null, 2);
            return;
        }

        const converted = convert(selection);
        if (converted.error) {
            setNote(converted.error, 'warn');
            output.textContent = '';
            actions.hidden = true;
            return;
        }
        if (result.empty) {
            const { text, tone } = validity();
            setNote(text, tone);
        } else {
            setNote(t.jsonConvertingQuery(result.result.length), 'good');
        }
        output.textContent = converted.text;
    };

    paint();

    return {
        root,
        // Called on every keystroke in the editor.
        update(text) {
            parsed = json.parseLoose(text);
            paint();
        },
        getState: () => ({ mode, path }),
        setState(state = {}) {
            mode = MODES.some((item) => item.id === state.mode) ? state.mode : 'query';
            path = state.path ?? '';
            queryInput.value = path;
        }
    };
};

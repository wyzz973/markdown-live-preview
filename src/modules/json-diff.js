// Structural diff for JSON.
//
// A character diff of two API responses is mostly noise: reorder the keys or
// reindent one side and every line lights up. What you actually want to know is
// which keys appeared, which vanished, and which changed value — independent of
// key order and formatting. That is a different computation, not a display
// option on the text diff, which is why it lives here.
//
// Arrays are the hard part. Index-by-index comparison reports an entire array
// as changed when one element is inserted at the front, so:
//   - if every element is an object carrying the same unique identity key,
//     elements are matched by that key (the case that matters for API payloads)
//   - otherwise an LCS alignment finds the common run, and adjacent
//     removed/added pairs are recursed into rather than reported as a wholesale
//     replacement

const IDENTITY_KEYS = ['id', 'uuid', '_id', 'key', 'slug', 'name'];

// Beyond this the O(n·m) alignment is not worth the memory; long arrays fall
// back to positional comparison, which is still correct, just noisier.
const LCS_LIMIT = 1500;

// A wholly different pair of documents can produce a change per leaf. The list
// stops being readable long before it stops being generated.
const MAX_CHANGES = 3000;

const isPlainObject = (value) =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

// JSONPath notation, matching what the JSON tool's query box accepts, so a path
// can be copied from here straight into it.
export const childPath = (path, key) =>
    typeof key === 'number'
        ? `${path}[${key}]`
        : IDENTIFIER.test(key)
          ? `${path}.${key}`
          : `${path}[${JSON.stringify(key)}]`;

const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// An identity key qualifies only if every element on both sides has it and no
// value repeats — otherwise matching by it would pair up the wrong elements.
const identityKeyFor = (left, right) => {
    const all = [...left, ...right];
    if (all.length === 0 || !all.every(isPlainObject)) {
        return null;
    }

    return (
        IDENTITY_KEYS.find((key) => {
            if (!all.every((item) => ['string', 'number'].includes(typeof item[key]))) {
                return false;
            }
            const leftIds = left.map((item) => item[key]);
            const rightIds = right.map((item) => item[key]);
            return (
                new Set(leftIds).size === leftIds.length &&
                new Set(rightIds).size === rightIds.length
            );
        }) ?? null
    );
};

// Classic dynamic-programming LCS over serialised elements, returning the
// alignment as a list of operations rather than just the length.
const alignByLcs = (left, right) => {
    const a = left.map((item) => JSON.stringify(item));
    const b = right.map((item) => JSON.stringify(item));

    const table = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
    for (let i = a.length - 1; i >= 0; i -= 1) {
        for (let j = b.length - 1; j >= 0; j -= 1) {
            table[i][j] =
                a[i] === b[j]
                    ? table[i + 1][j + 1] + 1
                    : Math.max(table[i + 1][j], table[i][j + 1]);
        }
    }

    const steps = [];
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
        if (a[i] === b[j]) {
            steps.push({ op: 'same', left: i, right: j });
            i += 1;
            j += 1;
        } else if (table[i + 1][j] >= table[i][j + 1]) {
            steps.push({ op: 'remove', left: i });
            i += 1;
        } else {
            steps.push({ op: 'add', right: j });
            j += 1;
        }
    }
    while (i < a.length) steps.push({ op: 'remove', left: i++ });
    while (j < b.length) steps.push({ op: 'add', right: j++ });

    return steps;
};

// LCS reports a modified element as a removal followed by an addition. Pairing
// those back up and recursing is what turns "element 3 replaced" into "element
// 3's status changed" — the difference between a useful diff and a useless one.
const pairRuns = (steps) => {
    const paired = [];
    let index = 0;

    while (index < steps.length) {
        const step = steps[index];
        if (step.op !== 'remove') {
            paired.push(step);
            index += 1;
            continue;
        }

        const removals = [];
        while (index < steps.length && steps[index].op === 'remove') {
            removals.push(steps[index]);
            index += 1;
        }
        const additions = [];
        while (index < steps.length && steps[index].op === 'add') {
            additions.push(steps[index]);
            index += 1;
        }

        const paired_ = Math.min(removals.length, additions.length);
        for (let k = 0; k < paired_; k += 1) {
            paired.push({ op: 'modify', left: removals[k].left, right: additions[k].right });
        }
        paired.push(...removals.slice(paired_), ...additions.slice(paired_));
    }

    return paired;
};

export const diff = (left, right) => {
    const changes = [];
    let truncated = false;

    const record = (change) => {
        if (changes.length >= MAX_CHANGES) {
            truncated = true;
            return;
        }
        changes.push(change);
    };

    const walk = (a, b, path) => {
        if (truncated) return;

        if (isPlainObject(a) && isPlainObject(b)) {
            // Union of both key sets, in the order they appear on the left and
            // then whatever the right added — so a diff reads in document order.
            const keys = [...Object.keys(a), ...Object.keys(b).filter((key) => !(key in a))];
            keys.forEach((key) => {
                const here = childPath(path, key);
                if (!(key in a)) {
                    record({ kind: 'add', path: here, after: b[key] });
                } else if (!(key in b)) {
                    record({ kind: 'remove', path: here, before: a[key] });
                } else {
                    walk(a[key], b[key], here);
                }
            });
            return;
        }

        if (Array.isArray(a) && Array.isArray(b)) {
            walkArrays(a, b, path);
            return;
        }

        if (!sameValue(a, b)) {
            record({ kind: 'change', path, before: a, after: b });
        }
    };

    const walkArrays = (a, b, path) => {
        const identity = identityKeyFor(a, b);

        if (identity) {
            const rightById = new Map(b.map((item, index) => [item[identity], { item, index }]));
            a.forEach((item, index) => {
                const match = rightById.get(item[identity]);
                if (!match) {
                    record({ kind: 'remove', path: childPath(path, index), before: item });
                    return;
                }
                rightById.delete(item[identity]);
                walk(item, match.item, childPath(path, match.index));
            });
            rightById.forEach(({ item, index }) => {
                record({ kind: 'add', path: childPath(path, index), after: item });
            });
            return;
        }

        if (a.length > LCS_LIMIT || b.length > LCS_LIMIT) {
            const length = Math.max(a.length, b.length);
            for (let index = 0; index < length; index += 1) {
                const here = childPath(path, index);
                if (index >= a.length) {
                    record({ kind: 'add', path: here, after: b[index] });
                } else if (index >= b.length) {
                    record({ kind: 'remove', path: here, before: a[index] });
                } else {
                    walk(a[index], b[index], here);
                }
            }
            return;
        }

        pairRuns(alignByLcs(a, b)).forEach((step) => {
            if (step.op === 'same') return;
            if (step.op === 'add') {
                record({ kind: 'add', path: childPath(path, step.right), after: b[step.right] });
            } else if (step.op === 'remove') {
                record({ kind: 'remove', path: childPath(path, step.left), before: a[step.left] });
            } else {
                walk(a[step.left], b[step.right], childPath(path, step.right));
            }
        });
    };

    walk(left, right, '$');

    return {
        changes,
        truncated,
        counts: {
            add: changes.filter((change) => change.kind === 'add').length,
            remove: changes.filter((change) => change.kind === 'remove').length,
            change: changes.filter((change) => change.kind === 'change').length
        }
    };
};

// One-line rendering of a value for a diff row. A whole nested object on a
// change row would push the path out of sight, which is the one thing the row
// exists to show.
export const preview = (value, limit = 80) => {
    if (value === undefined) return '';
    const text = typeof value === 'string' ? JSON.stringify(value) : JSON.stringify(value);
    if (text === undefined) return String(value);
    if (text.length <= limit) return text;
    return `${text.slice(0, limit - 1)}…`;
};

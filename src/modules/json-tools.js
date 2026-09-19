// JSON transforms.
//
// Monaco's own JSON language service already covers validation, folding and
// formatting inside the editor, so this module is only the things it does not
// do: structural outline, conversion, escaping, and the Unicode round-trip that
// Chinese APIs make unavoidable.

import { jsonrepair } from 'jsonrepair';
import { JSONPath } from 'jsonpath-plus';
import { dump as toYamlText } from 'js-yaml';

// ----- parsing -----

export const parse = (text) => {
    if (!text.trim()) {
        return { ok: true, value: null, empty: true };
    }
    try {
        return { ok: true, value: JSON.parse(text) };
    } catch (error) {
        return { ok: false, error };
    }
};

// Best-effort parse: repairs trailing commas, single quotes, unquoted keys,
// missing brackets. Reports whether repair was needed so the caller can say so.
export const parseLoose = (text) => {
    const direct = parse(text);
    if (direct.ok) {
        return { ...direct, repaired: false };
    }
    try {
        const repairedText = jsonrepair(text);
        return { ok: true, value: JSON.parse(repairedText), repairedText, repaired: true };
    } catch (error) {
        return { ok: false, error, repaired: false };
    }
};

export const repair = (text) => jsonrepair(text);

export const format = (text, indent = 2) => JSON.stringify(JSON.parse(text), null, indent);

export const minify = (text) => JSON.stringify(JSON.parse(text));

// Sort object keys recursively — makes two payloads comparable by eye.
export const sortKeys = (value) => {
    if (Array.isArray(value)) {
        return value.map(sortKeys);
    }
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.keys(value)
                .sort((a, b) => a.localeCompare(b))
                .map((key) => [key, sortKeys(value[key])])
        );
    }
    return value;
};

// ----- escaping -----

// Turn a JSON document into the string literal that would embed it — the shape
// it takes when a payload carries JSON inside a JSON field.
export const escape = (text) => JSON.stringify(text).slice(1, -1);

export const unescape = (text) => {
    const trimmed = text.trim();
    const wrapped = trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed : `"${trimmed}"`;
    return JSON.parse(wrapped);
};

// ----- Unicode ↔ 中文 -----
//
// Chinese APIs routinely return 中文 rather than the characters
// themselves. Western JSON tools almost never offer this; local ones all do,
// because without it the payload is unreadable.

export const unicodeToText = (text) =>
    text.replace(/\\u([0-9a-fA-F]{4})/g, (_, code) => String.fromCharCode(parseInt(code, 16)));

export const textToUnicode = (text, { asciiOnly = true } = {}) =>
    Array.from(text)
        .map((char) => {
            const code = char.codePointAt(0);
            if (asciiOnly && code < 128) {
                return char;
            }
            // Characters beyond the BMP need both surrogate halves escaped.
            // `Array.from` splits by code point and would hand back the whole
            // character again, so index the UTF-16 units directly.
            if (code > 0xffff) {
                return char
                    .split('')
                    .map((unit) => `\\u${unit.charCodeAt(0).toString(16).padStart(4, '0')}`)
                    .join('');
            }
            return `\\u${code.toString(16).padStart(4, '0')}`;
        })
        .join('');

// ----- query -----

export const query = (value, path) => {
    if (!path.trim()) {
        return { ok: true, result: undefined, empty: true };
    }
    try {
        return { ok: true, result: JSONPath({ path, json: value, wrap: true }) };
    } catch (error) {
        return { ok: false, error };
    }
};

// ----- conversion -----

export const toYaml = (value) => toYamlText(value, { indent: 2, lineWidth: 100, noRefs: true });

const csvCell = (value) => {
    if (value === null || value === undefined) return '';
    const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

// Rows must be a flat-ish array of objects; anything else has no CSV meaning.
export const toCsv = (value) => {
    const rows = Array.isArray(value) ? value : [value];
    const objects = rows.filter((row) => row && typeof row === 'object' && !Array.isArray(row));
    if (objects.length === 0) {
        return null;
    }
    const columns = [...new Set(objects.flatMap((row) => Object.keys(row)))];
    return [
        columns.join(','),
        ...objects.map((row) => columns.map((column) => csvCell(row[column])).join(','))
    ].join('\n');
};

// JSON → Markdown table. The app renders Markdown next door, so this is the one
// conversion no other JSON tool can follow through on.
const mdCell = (input) => {
    if (input === null || input === undefined) return '';
    const text = typeof input === 'object' ? JSON.stringify(input) : String(input);
    return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
};

export const toMarkdownTable = (value) => {
    // An array of records becomes one row per record. A lone object becomes a
    // key/value table instead — flattening a config object into a single row of
    // stringified blobs is technically a table and useless as one.
    if (!Array.isArray(value)) {
        if (!value || typeof value !== 'object') {
            return null;
        }
        const entries = Object.entries(value);
        if (entries.length === 0) return null;
        return [
            '| 键 | 值 |',
            '| --- | --- |',
            ...entries.map(([key, item]) => `| ${mdCell(key)} | ${mdCell(item)} |`)
        ].join('\n');
    }

    const objects = value.filter((row) => row && typeof row === 'object' && !Array.isArray(row));
    if (objects.length === 0) {
        return null;
    }
    const columns = [...new Set(objects.flatMap((row) => Object.keys(row)))];
    return [
        `| ${columns.join(' | ')} |`,
        `| ${columns.map(() => '---').join(' | ')} |`,
        ...objects.map((row) => `| ${columns.map((column) => mdCell(row[column])).join(' | ')} |`)
    ].join('\n');
};

// ----- type generation -----

// Type names must survive non-Latin keys. A Chinese key has no ASCII form, so
// rather than collapsing every one of them to the same fallback — which made
// every generated interface collide under one name — keep the characters and
// only strip what is illegal in an identifier.
const pascal = (name) => {
    const cleaned = String(name)
        .replace(/[^\p{L}\p{N}]+(.)?/gu, (_, char) => (char ? char.toUpperCase() : ''))
        .replace(/^[a-z]/, (char) => char.toUpperCase())
        .replace(/^[0-9]/, (char) => `N${char}`);
    return cleaned || 'Root';
};

// Types are inferred from every value that occurs at a position, not from the
// first one. Reading only `array[0]` turned `tags: []` in the first record into
// `unknown[]` although every later record held strings, and dropped any field
// the first record happened to lack. A shape accumulates what each position
// has held; a field missing from some records becomes optional.
const blankShape = () => ({ kinds: new Set(), element: null, fields: new Map(), objects: 0 });

const absorb = (shape, value) => {
    if (value === null) {
        shape.kinds.add('null');
    } else if (Array.isArray(value)) {
        shape.kinds.add('array');
        shape.element ??= blankShape();
        value.forEach((item) => absorb(shape.element, item));
    } else if (typeof value === 'object') {
        shape.kinds.add('object');
        shape.objects += 1;
        Object.entries(value).forEach(([key, item]) => {
            let field = shape.fields.get(key);
            if (!field) {
                field = { shape: blankShape(), count: 0 };
                shape.fields.set(key, field);
            }
            field.count += 1;
            absorb(field.shape, item);
        });
    } else if (typeof value === 'number') {
        shape.kinds.add(Number.isInteger(value) ? 'integer' : 'float');
    } else {
        shape.kinds.add(typeof value === 'boolean' ? 'boolean' : 'string');
    }
    return shape;
};

const shapeOf = (value) => absorb(blankShape(), value);

// Two positions with the same key but different contents must not overwrite
// each other's declaration; the second one gets a numbered name.
const declare = (collected, baseName, body) => {
    for (let n = 1; ; n += 1) {
        const name = n === 1 ? baseName : `${baseName}${n}`;
        const existing = collected.get(name);
        if (existing === undefined || existing.body === body) {
            collected.set(name, { body, order: existing?.order ?? collected.size });
            return name;
        }
    }
};

const TS_IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

const tsTypeOf = (shape, name, collected) => {
    const parts = [];
    if (shape.kinds.has('object')) {
        const fields = [...shape.fields].map(([key, field]) => {
            const optional = field.count < shape.objects ? '?' : '';
            const label = TS_IDENTIFIER.test(key) ? key : JSON.stringify(key);
            return `  ${label}${optional}: ${tsTypeOf(field.shape, key, collected)};`;
        });
        const typeName = pascal(name);
        const body = `{\n${fields.join('\n')}\n}`;
        parts.push(declare(collected, typeName, body));
    }
    if (shape.kinds.has('array')) {
        const inner = shape.element && shape.element.kinds.size ? tsTypeOf(shape.element, name, collected) : 'unknown';
        parts.push(inner.includes(' | ') ? `(${inner})[]` : `${inner}[]`);
    }
    if (shape.kinds.has('string')) parts.push('string');
    if (shape.kinds.has('integer') || shape.kinds.has('float')) parts.push('number');
    if (shape.kinds.has('boolean')) parts.push('boolean');
    if (shape.kinds.has('null')) parts.push('null');
    return parts.length ? parts.join(' | ') : 'unknown';
};

// Root first, then each type after the one that uses it — the order people
// read a payload in.
const emit = (collected, render) =>
    [...collected]
        .sort((a, b) => b[1].order - a[1].order)
        .map(([name, { body }]) => render(name, body))
        .join('\n\n');

// An array at the root names its elements after the root, so the alias for
// the root itself stays free.
const rootNameFor = (shape, rootName) => (shape.kinds.has('object') ? rootName : `${rootName}Item`);

export const toTypeScript = (value, rootName = 'Root') => {
    const collected = new Map();
    const shape = shapeOf(value);
    const root = tsTypeOf(shape, rootNameFor(shape, rootName), collected);
    const declarations = emit(collected, (name, body) => `interface ${name} ${body}`);
    if (root === pascal(rootName)) return declarations;
    const alias = `type ${pascal(rootName)} = ${root};`;
    return declarations ? `${declarations}\n\n${alias}` : alias;
};

// Go has no unions: a position that has held more than one kind of value is
// `any`, a nullable one is a pointer, and a field some records lack gets
// `omitempty`.
const goTypeOf = (shape, name, collected) => {
    const kinds = new Set(shape.kinds);
    const nullable = kinds.delete('null');
    if (kinds.has('integer') && kinds.has('float')) kinds.delete('integer');

    if (kinds.size === 0) return 'any';
    if (kinds.size > 1) return 'any';

    const [kind] = kinds;
    let type;
    if (kind === 'object') {
        const fields = [...shape.fields].map(([key, field]) => {
            const tag = field.count < shape.objects ? `${key},omitempty` : key;
            return `\t${pascal(key)} ${goTypeOf(field.shape, key, collected)} \`json:"${tag}"\``;
        });
        type = declare(collected, pascal(name), `struct {\n${fields.join('\n')}\n}`);
    } else if (kind === 'array') {
        const inner = shape.element && shape.element.kinds.size ? goTypeOf(shape.element, name, collected) : 'any';
        return `[]${inner}`;
    } else {
        type = { string: 'string', integer: 'int', float: 'float64', boolean: 'bool' }[kind];
    }
    return nullable ? `*${type}` : type;
};

export const toGo = (value, rootName = 'Root') => {
    const collected = new Map();
    const shape = shapeOf(value);
    const root = goTypeOf(shape, rootNameFor(shape, rootName), collected);
    const declarations = emit(collected, (name, body) => `type ${name} ${body}`);
    if (root === pascal(rootName)) return declarations;
    const alias = `type ${pascal(rootName)} ${root}`;
    return declarations ? `${declarations}\n\n${alias}` : alias;
};

// ----- outline -----
//
// Only containers are listed. Listing every leaf would produce thousands of
// rows for a real payload and bury the structure — the same reason the Markdown
// outline lists headings and not paragraphs.
//
// Scanned straight from the text rather than from the parsed value, for two
// reasons: it yields real line numbers so a click can jump the editor there,
// and a document that does not parse yet still shows the structure typed so
// far instead of going blank while you are mid-edit.

const MAX_ARRAY_CHILDREN = 20;
const MAX_DEPTH = 6;

export const outlineFromText = (text) => {
    const rows = [];
    const stack = [];

    let line = 1;
    let inString = false;
    let escaped = false;
    let buffer = '';
    let lastString = null;
    let pendingKey = null;

    const push = (isArray) => {
        const parent = stack[stack.length - 1];
        const key = parent?.isArray ? `[${parent.commas}]` : pendingKey;

        const frame = {
            isArray,
            // Members are counted as commas + 1 when the container holds
            // anything; counting commas alone is always one short.
            commas: 0,
            hasContent: false,
            line,
            level: stack.length + 1,
            label: stack.length === 0 ? '$' : key ?? '?',
            path:
                stack.length === 0
                    ? '$'
                    : parent.isArray
                      ? `${parent.path}[${parent.commas}]`
                      : `${parent.path}.${key}`,
            // Row index is claimed on open so children land underneath it, and
            // the count is filled in when the container closes.
            index: rows.length
        };

        // Hidden when its parent is: an element past the array cap used to
        // disappear while its own children (every `tags`, every `profile`)
        // still filled the rail, orphaned under the last visible element.
        const visible =
            (!parent || parent.index >= 0) &&
            frame.level <= MAX_DEPTH &&
            !(parent?.isArray && parent.commas >= MAX_ARRAY_CHILDREN);

        if (visible) {
            rows.push({
                // The rail reads `text`; keep `label` too for callers that
                // want the raw key.
                text: frame.label,
                label: frame.label,
                level: frame.level,
                path: frame.path,
                line: frame.line,
                token: isArray ? '[]' : '{}',
                count: 0,
                unit: isArray ? 'items' : 'keys'
            });
        } else {
            frame.index = -1;
        }

        stack.push(frame);
        pendingKey = null;
    };

    const pop = () => {
        const frame = stack.pop();
        if (frame && frame.index >= 0) {
            rows[frame.index].count = frame.hasContent ? frame.commas + 1 : 0;
        }
    };

    const markContent = () => {
        const frame = stack[stack.length - 1];
        if (frame) frame.hasContent = true;
    };

    for (let i = 0; i < text.length; i += 1) {
        const char = text[i];

        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (char === '\\') {
                escaped = true;
            } else if (char === '"') {
                inString = false;
                lastString = buffer;
            } else {
                buffer += char;
                if (char === '\n') line += 1;
            }
            continue;
        }

        if (char === '\n') {
            line += 1;
        } else if (char === '"') {
            markContent();
            inString = true;
            buffer = '';
        } else if (char === ':') {
            pendingKey = lastString;
        } else if (char === '{') {
            markContent();
            push(false);
        } else if (char === '[') {
            markContent();
            push(true);
        } else if (char === '}' || char === ']') {
            pop();
        } else if (char === ',') {
            const frame = stack[stack.length - 1];
            if (frame) frame.commas += 1;
        } else if (!/\s/.test(char)) {
            // Numbers, true/false/null — anything else that is a member.
            markContent();
        }
    }

    // An unclosed container — mid-edit, or a truncated payload — keeps whatever
    // it collected rather than vanishing from the outline.
    while (stack.length > 0) {
        pop();
    }

    return rows;
};

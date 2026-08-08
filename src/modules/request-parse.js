// Normalising a chat-completion request body into something readable.
//
// The mirror of stream-parse.js: that one turns a response back into a message,
// this one turns a request back into a conversation. When an agent misbehaves
// the evidence is in a 200 kB `messages` array — system prompt, twenty turns,
// tool schemas, base64 images and cache markers all flattened into one line —
// and reading it in an editor is the worst part of the job.
//
// Four request shapes are recognised and collapsed onto one structure, so the
// view code never asks which provider it is looking at.

import { jsonrepair } from 'jsonrepair';
import { t } from './strings.js';

// ----- token estimation -----

// Han, kana and hangul: roughly one token per character across current
// tokenisers, where Latin runs about four characters to the token.
const WIDE = /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF]/;

// Deliberately an estimate, and labelled as one in the interface. Claude's
// tokeniser is not published, and the only exact answer is a network round trip
// to count_tokens — which this app does not make. A number that is honest about
// being approximate beats one that looks authoritative and is wrong.
export const estimateTokens = (text) => {
    if (!text) return 0;
    let wide = 0;
    let rest = 0;
    for (const character of text) {
        if (WIDE.test(character)) wide += 1;
        else rest += 1;
    }
    return Math.round(wide + rest / 4);
};

// ----- cURL unwrapping -----

// Copying a request out of the network panel gives a cURL command, not a JSON
// body. Making the reader extract the payload by hand first would defeat the
// point of the tool.
const DATA_FLAG = /(?:--data-raw|--data-binary|--data-ascii|--data|(?<![\w-])-d)\s+/;

// Bash cannot nest a single quote, so shells emit '\'' to embed one; Chrome
// uses $'...' with C escapes when the body contains non-ASCII.
const unquote = (source) => {
    if (source.startsWith("$'")) {
        return source
            .slice(2, -1)
            .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
            .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
            .replace(/\\n/g, '\n')
            .replace(/\\t/g, '\t')
            .replace(/\\'/g, "'")
            .replace(/\\\\/g, '\\');
    }
    if (source.startsWith("'")) {
        return source.slice(1, -1).replace(/'\\''/g, "'");
    }
    if (source.startsWith('"')) {
        return source.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    return source;
};

// Reads one shell word starting at `start`, respecting quoting.
const readWord = (text, start) => {
    const opening = text.startsWith("$'", start) ? "$'" : text[start];

    if (opening !== "'" && opening !== '"' && opening !== "$'") {
        const end = text.slice(start).search(/\s/);
        return text.slice(start, end === -1 ? undefined : start + end);
    }

    const quote = opening === '"' ? '"' : "'";
    let index = start + opening.length;
    while (index < text.length) {
        if (text[index] === '\\') {
            index += 2;
            continue;
        }
        if (text[index] === quote) {
            // '\'' inside a single-quoted word closes and reopens; keep going.
            if (quote === "'" && text.startsWith("'\\''", index)) {
                index += 4;
                continue;
            }
            return text.slice(start, index + 1);
        }
        index += 1;
    }
    return text.slice(start);
};

export const extractCurlBody = (text) => {
    const match = DATA_FLAG.exec(text);
    if (!match) return null;
    const start = match.index + match[0].length;
    return unquote(readWord(text, start));
};

// ----- provider detection -----

const blockTyped = (message) =>
    Array.isArray(message?.content) &&
    message.content.some((block) => typeof block?.type === 'string');

const detect = (body) => {
    if (Array.isArray(body?.contents)) return 'gemini';

    const messages = Array.isArray(body?.messages) ? body.messages : [];

    // The model name settles it whenever it is present, and it usually is. The
    // structural signals below only have to carry requests that omit it.
    const model = String(body?.model ?? '');
    if (/^claude/i.test(model)) return 'anthropic';
    if (/^(gpt|o[134]|chatgpt|text-davinci)/i.test(model)) return 'openai';

    // A system prompt as a message is an OpenAI shape; Anthropic keeps it at
    // the top level, so this rules out the ambiguous max_tokens case below.
    if (messages.some((message) => ['system', 'developer'].includes(message?.role))) {
        return 'openai';
    }

    if (
        body?.anthropic_version ||
        typeof body?.system === 'string' ||
        Array.isArray(body?.system) ||
        messages.some(
            (message) =>
                blockTyped(message) &&
                message.content.some((block) =>
                    ['tool_use', 'tool_result', 'thinking', 'redacted_thinking'].includes(
                        block.type
                    )
                )
        ) ||
        body?.tools?.some?.((tool) => tool?.input_schema)
    ) {
        return 'anthropic';
    }

    if (messages.some((message) => Array.isArray(message?.images))) return 'ollama';

    if (
        messages.some((message) => message?.tool_calls || message?.role === 'tool') ||
        body?.tools?.some?.((tool) => tool?.function) ||
        body?.max_completion_tokens !== undefined
    ) {
        return 'openai';
    }

    // Anthropic's required max_tokens is the last clean signal left.
    if (messages.length && body?.max_tokens !== undefined && body?.temperature === undefined) {
        return 'anthropic';
    }

    return messages.length ? 'openai' : 'unknown';
};

const LABELS = {
    anthropic: 'Anthropic Messages',
    openai: 'OpenAI Chat',
    gemini: 'Gemini generateContent',
    ollama: 'Ollama chat',
    unknown: t.requestUnknownProvider
};

// ----- blocks -----

const textBlock = (text, cached = false) => ({
    kind: 'text',
    text: String(text ?? ''),
    chars: String(text ?? '').length,
    cached
});

// Only inline data is rendered. A remote image URL is shown as a URL on
// purpose: fetching it would put a pasted payload on the network, which is
// exactly what a local-first tool must not do behind your back.
const imageBlock = ({ mediaType, data, url }) => {
    if (url) {
        return { kind: 'image', remote: url, chars: 0, bytes: 0 };
    }
    return {
        kind: 'image',
        mediaType: mediaType || 'image/png',
        dataUrl: `data:${mediaType || 'image/png'};base64,${data}`,
        bytes: Math.floor((data?.length ?? 0) * 0.75),
        chars: 0
    };
};

const jsonChars = (value) => (value === undefined ? 0 : JSON.stringify(value).length);

// ----- per-provider readers -----

const anthropicBlocks = (content) => {
    if (typeof content === 'string') return [textBlock(content)];
    if (!Array.isArray(content)) return [];

    return content.map((block) => {
        const cached = Boolean(block?.cache_control);
        switch (block?.type) {
            case 'text':
                return textBlock(block.text, cached);
            case 'thinking':
                return { kind: 'thinking', text: block.thinking ?? '', chars: (block.thinking ?? '').length, cached };
            case 'redacted_thinking':
                return { kind: 'thinking', text: t.requestRedacted, chars: 0, cached };
            case 'image':
                return {
                    ...imageBlock({
                        mediaType: block.source?.media_type,
                        data: block.source?.data,
                        url: block.source?.type === 'url' ? block.source.url : undefined
                    }),
                    cached
                };
            case 'tool_use':
                return {
                    kind: 'tool_use',
                    id: block.id,
                    name: block.name,
                    input: block.input,
                    chars: jsonChars(block.input),
                    cached
                };
            case 'tool_result': {
                const inner =
                    typeof block.content === 'string'
                        ? block.content
                        : JSON.stringify(block.content ?? '', null, 2);
                return {
                    kind: 'tool_result',
                    id: block.tool_use_id,
                    text: inner,
                    isError: Boolean(block.is_error),
                    chars: inner.length,
                    cached
                };
            }
            case 'document':
                return { kind: 'document', text: block.title ?? '', chars: jsonChars(block.source), cached };
            default:
                return { kind: 'other', text: JSON.stringify(block), chars: jsonChars(block), cached };
        }
    });
};

const openaiBlocks = (message) => {
    const blocks = [];
    const content = message?.content;

    if (typeof content === 'string' && content) {
        blocks.push(textBlock(content));
    } else if (Array.isArray(content)) {
        content.forEach((part) => {
            if (part?.type === 'text') {
                blocks.push(textBlock(part.text));
            } else if (part?.type === 'image_url') {
                const url = part.image_url?.url ?? '';
                if (url.startsWith('data:')) {
                    const [prefix, data] = url.split(',');
                    blocks.push(
                        imageBlock({ mediaType: prefix.slice(5).replace(';base64', ''), data })
                    );
                } else {
                    blocks.push(imageBlock({ url }));
                }
            } else {
                blocks.push({ kind: 'other', text: JSON.stringify(part), chars: jsonChars(part) });
            }
        });
    }

    (message?.tool_calls ?? []).forEach((call) => {
        // OpenAI ships arguments as a JSON string, so it needs a second parse
        // before it can be pretty-printed.
        let input = call.function?.arguments;
        try {
            input = JSON.parse(call.function?.arguments ?? '{}');
        } catch (error) {
            // Leave it as the raw string; the view prints whatever it gets.
        }
        blocks.push({
            kind: 'tool_use',
            id: call.id,
            name: call.function?.name,
            input,
            chars: (call.function?.arguments ?? '').length
        });
    });

    if (message?.role === 'tool') {
        const inner = typeof content === 'string' ? content : JSON.stringify(content ?? '');
        return [{ kind: 'tool_result', id: message.tool_call_id, text: inner, chars: inner.length }];
    }

    return blocks;
};

const geminiBlocks = (parts) =>
    (parts ?? []).map((part) => {
        if (part?.text !== undefined) return textBlock(part.text);
        if (part?.inlineData) {
            return imageBlock({ mediaType: part.inlineData.mimeType, data: part.inlineData.data });
        }
        if (part?.functionCall) {
            return {
                kind: 'tool_use',
                name: part.functionCall.name,
                input: part.functionCall.args,
                chars: jsonChars(part.functionCall.args)
            };
        }
        if (part?.functionResponse) {
            const inner = JSON.stringify(part.functionResponse.response ?? '', null, 2);
            return {
                kind: 'tool_result',
                id: part.functionResponse.name,
                text: inner,
                chars: inner.length
            };
        }
        return { kind: 'other', text: JSON.stringify(part), chars: jsonChars(part) };
    });

const ollamaBlocks = (message) => {
    const blocks = message?.content ? [textBlock(message.content)] : [];
    (message?.images ?? []).forEach((data) => blocks.push(imageBlock({ data })));
    return blocks;
};

// ----- tools -----

// A JSON Schema printed raw is a wall; the readable form is the parameter list,
// which is what you are checking when you open this tab at all.
const schemaParams = (schema) => {
    const properties = schema?.properties;
    if (!properties) return [];
    const required = new Set(schema.required ?? []);
    return Object.entries(properties).map(([name, spec]) => ({
        name,
        type: Array.isArray(spec?.type) ? spec.type.join(' | ') : (spec?.type ?? 'any'),
        required: required.has(name),
        description: spec?.description ?? ''
    }));
};

const readTools = (body, provider) => {
    if (provider === 'gemini') {
        return (body.tools ?? []).flatMap((tool) =>
            (tool.functionDeclarations ?? []).map((declaration) => ({
                name: declaration.name,
                description: declaration.description ?? '',
                schema: declaration.parameters,
                params: schemaParams(declaration.parameters)
            }))
        );
    }

    return (body.tools ?? []).map((tool) => {
        const fn = tool.function ?? tool;
        const schema = tool.input_schema ?? fn.parameters ?? fn.input_schema;
        return {
            name: fn.name ?? tool.name ?? '',
            description: fn.description ?? tool.description ?? '',
            cached: Boolean(tool.cache_control),
            schema,
            params: schemaParams(schema)
        };
    });
};

// ----- parameters -----

const PARAM_KEYS = [
    'max_tokens',
    'max_completion_tokens',
    'max_output_tokens',
    'temperature',
    'top_p',
    'top_k',
    'stream',
    'stop_sequences',
    'stop',
    'presence_penalty',
    'frequency_penalty',
    'seed',
    'response_format',
    'tool_choice',
    'parallel_tool_calls',
    'service_tier'
];

const readParams = (body) => {
    const source = { ...body, ...(body.generationConfig ?? {}), ...(body.options ?? {}) };
    const params = PARAM_KEYS.filter((key) => source[key] !== undefined).map((key) => ({
        key,
        value: typeof source[key] === 'object' ? JSON.stringify(source[key]) : String(source[key])
    }));

    if (body.thinking?.type === 'enabled') {
        params.push({ key: 'thinking', value: `${body.thinking.budget_tokens ?? '?'} tokens` });
    }
    return params;
};

// ----- entry point -----

const EMPTY = {
    provider: 'unknown',
    providerLabel: '',
    model: '',
    params: [],
    system: [],
    turns: [],
    tools: [],
    stats: { chars: 0, tokens: 0, images: 0, imageBytes: 0, cacheBreakpoints: 0 },
    error: null,
    repaired: false,
    fromCurl: false,
    empty: true
};

export const parseRequest = (source) => {
    const raw = (source ?? '').trim();
    if (!raw) return { ...EMPTY };

    const fromCurl = /^\s*curl[\s\\]/.test(raw) || /--data(-raw|-binary|-ascii)?\s/.test(raw);
    const payload = fromCurl ? (extractCurlBody(raw) ?? raw) : raw;

    let body;
    let repaired = false;
    try {
        body = JSON.parse(payload);
    } catch (error) {
        try {
            body = JSON.parse(jsonrepair(payload));
            repaired = true;
        } catch (second) {
            return { ...EMPTY, empty: false, error: error.message, fromCurl };
        }
    }

    if (body === null || typeof body !== 'object') {
        return { ...EMPTY, empty: false, error: t.requestNotAnObject, fromCurl };
    }

    const provider = detect(body);

    const rawTurns =
        provider === 'gemini'
            ? (body.contents ?? []).map((entry) => ({
                  role: entry.role ?? 'user',
                  blocks: geminiBlocks(entry.parts)
              }))
            : (body.messages ?? []).map((message) => ({
                  role: message.role ?? 'user',
                  blocks:
                      provider === 'anthropic'
                          ? anthropicBlocks(message.content)
                          : provider === 'ollama'
                            ? ollamaBlocks(message)
                            : openaiBlocks(message)
              }));

    // OpenAI carries the system prompt as the first message; pulling it out
    // makes the two shapes comparable and the turn numbering meaningful.
    const system = [];
    if (typeof body.system === 'string') {
        system.push(textBlock(body.system));
    } else if (Array.isArray(body.system)) {
        system.push(...anthropicBlocks(body.system));
    } else if (body.systemInstruction) {
        system.push(...geminiBlocks(body.systemInstruction.parts));
    }

    const turns = rawTurns.filter((turn) => {
        if (system.length === 0 && ['system', 'developer'].includes(turn.role)) {
            system.push(...turn.blocks);
            return false;
        }
        return true;
    });

    turns.forEach((turn, index) => {
        turn.index = index + 1;
        turn.chars = turn.blocks.reduce((sum, block) => sum + block.chars, 0);
        turn.tokens = turn.blocks.reduce(
            (sum, block) => sum + estimateTokens(block.text ?? '') + (block.input ? estimateTokens(JSON.stringify(block.input)) : 0),
            0
        );
        turn.cached = turn.blocks.some((block) => block.cached);
    });

    const tools = readTools(body, provider);

    const allBlocks = [...system, ...turns.flatMap((turn) => turn.blocks)];
    const systemChars = system.reduce((sum, block) => sum + block.chars, 0);
    const toolChars = tools.reduce(
        (sum, tool) => sum + tool.name.length + tool.description.length + jsonChars(tool.schema),
        0
    );

    return {
        provider,
        providerLabel: LABELS[provider],
        model: body.model ?? '',
        params: readParams(body),
        system,
        systemChars,
        turns,
        tools,
        toolChars,
        stats: {
            chars: allBlocks.reduce((sum, block) => sum + block.chars, 0) + toolChars,
            tokens:
                estimateTokens(system.map((block) => block.text ?? '').join('')) +
                turns.reduce((sum, turn) => sum + turn.tokens, 0) +
                estimateTokens(tools.map((tool) => tool.description).join('')),
            images: allBlocks.filter((block) => block.kind === 'image').length,
            imageBytes: allBlocks.reduce((sum, block) => sum + (block.bytes ?? 0), 0),
            cacheBreakpoints:
                allBlocks.filter((block) => block.cached).length +
                tools.filter((tool) => tool.cached).length
        },
        error: null,
        repaired,
        fromCurl,
        empty: false
    };
};

// The whole exchange as a Markdown transcript, for handing to the editor.
export const toTranscript = (result) => {
    const lines = [];
    if (result.model) lines.push(`# ${result.model}`, '');

    if (result.system.length) {
        lines.push('## system', '');
        result.system.forEach((block) => lines.push(block.text ?? '', ''));
    }

    result.turns.forEach((turn) => {
        lines.push(`## ${turn.role} · ${t.requestTurn(turn.index)}`, '');
        turn.blocks.forEach((block) => {
            if (block.kind === 'text' || block.kind === 'thinking') {
                lines.push(block.text, '');
            } else if (block.kind === 'tool_use') {
                lines.push(`**${block.name}**`, '', '```json', JSON.stringify(block.input, null, 2), '```', '');
            } else if (block.kind === 'tool_result') {
                lines.push('```', block.text, '```', '');
            } else if (block.kind === 'image') {
                lines.push(`\`[${t.requestImage}]\``, '');
            }
        });
    });

    return lines.join('\n');
};

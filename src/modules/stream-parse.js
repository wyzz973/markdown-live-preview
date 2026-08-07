// Reassemble a captured LLM response stream into the message it produced.
//
// Existing tools show an SSE capture; none of them put it back together. The
// interesting part is that what comes back out is almost always Markdown —
// which this app can already render — so the reassembled text goes straight
// into the preview pane rather than being dumped as an escaped string.
//
// Handles three shapes:
//   - SSE       `event: x\ndata: {...}\n\n`   (Anthropic, OpenAI, most others)
//   - JSONL     one JSON object per line
//   - plain     a single non-streamed response body

import { jsonrepair } from 'jsonrepair';

export const PROVIDERS = {
    anthropic: 'Anthropic',
    openai: 'OpenAI',
    gemini: 'Gemini',
    ollama: 'Ollama',
    unknown: '未识别'
};

const DONE = '[DONE]';

// ----- framing -----

// Split an SSE body into frames. Blank line ends a frame; `event:` and `data:`
// accumulate. Comment lines (`:`) are dropped — they are keep-alives.
const parseSse = (text) => {
    const frames = [];
    let event = null;
    let data = [];

    const flush = () => {
        if (data.length > 0) {
            frames.push({ event, raw: data.join('\n') });
        }
        event = null;
        data = [];
    };

    for (const line of text.split(/\r?\n/)) {
        if (line === '') {
            flush();
            continue;
        }
        if (line.startsWith(':')) {
            continue;
        }
        if (line.startsWith('event:')) {
            event = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
            data.push(line.slice(5).replace(/^ /, ''));
        }
    }
    flush();

    return frames;
};

const parseJsonl = (text) =>
    text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((raw) => ({ event: null, raw }));

const looksLikeSse = (text) => /^\s*(event|data):/m.test(text);

// ----- payload decoding -----

// A frame whose JSON is broken usually means the capture was cut mid-write.
// Repair it so the run can still be shown, and record that it was repaired.
const decode = (raw) => {
    if (raw.trim() === DONE) {
        return { done: true };
    }
    try {
        return { value: JSON.parse(raw) };
    } catch (error) {
        try {
            return { value: JSON.parse(jsonrepair(raw)), repaired: true };
        } catch (innerError) {
            return { error: innerError.message };
        }
    }
};

// ----- provider detection -----

const detect = (payloads) => {
    for (const payload of payloads) {
        const type = payload?.type;
        if (typeof type === 'string' && /^(message_start|content_block|message_delta|message_stop|ping)/.test(type)) {
            return 'anthropic';
        }
        if (Array.isArray(payload?.choices)) {
            return 'openai';
        }
        if (Array.isArray(payload?.candidates)) {
            return 'gemini';
        }
        if (typeof payload?.model === 'string' && ('response' in payload || 'message' in payload)) {
            return 'ollama';
        }
    }
    return 'unknown';
};

// ----- per-provider extraction -----

// Each extractor turns one payload into zero or more events:
//   { kind: 'text' | 'reasoning' | 'tool' | 'usage' | 'stop' | 'other', ... }
const EXTRACTORS = {
    anthropic(payload) {
        const events = [];
        const type = payload?.type;

        if (type === 'content_block_start' && payload.content_block?.type === 'tool_use') {
            events.push({
                kind: 'tool',
                index: payload.index ?? 0,
                id: payload.content_block.id,
                name: payload.content_block.name,
                fragment: ''
            });
        } else if (type === 'content_block_delta') {
            const delta = payload.delta ?? {};
            if (delta.type === 'text_delta') {
                events.push({ kind: 'text', text: delta.text ?? '' });
            } else if (delta.type === 'thinking_delta') {
                events.push({ kind: 'reasoning', text: delta.thinking ?? '' });
            } else if (delta.type === 'input_json_delta') {
                events.push({ kind: 'tool', index: payload.index ?? 0, fragment: delta.partial_json ?? '' });
            }
        } else if (type === 'message_delta') {
            if (payload.usage) {
                events.push({ kind: 'usage', usage: payload.usage });
            }
            if (payload.delta?.stop_reason) {
                events.push({ kind: 'stop', reason: payload.delta.stop_reason });
            }
        } else if (type === 'message_start' && payload.message?.usage) {
            events.push({ kind: 'usage', usage: payload.message.usage });
        }

        return events;
    },

    openai(payload) {
        const events = [];
        const choice = payload?.choices?.[0];
        if (!choice) {
            if (payload?.usage) events.push({ kind: 'usage', usage: payload.usage });
            return events;
        }

        // Streaming sends `delta`; a non-streamed body sends `message`.
        const delta = choice.delta ?? choice.message ?? {};

        if (typeof delta.content === 'string' && delta.content) {
            events.push({ kind: 'text', text: delta.content });
        }
        if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
            events.push({ kind: 'reasoning', text: delta.reasoning_content });
        }

        // Tool call arguments arrive as string fragments spread across deltas —
        // reassembling them by index is the whole trick.
        (delta.tool_calls ?? []).forEach((call) => {
            events.push({
                kind: 'tool',
                index: call.index ?? 0,
                id: call.id,
                name: call.function?.name,
                fragment: call.function?.arguments ?? ''
            });
        });

        if (choice.finish_reason) {
            events.push({ kind: 'stop', reason: choice.finish_reason });
        }
        if (payload.usage) {
            events.push({ kind: 'usage', usage: payload.usage });
        }

        return events;
    },

    gemini(payload) {
        const events = [];
        const parts = payload?.candidates?.[0]?.content?.parts ?? [];
        parts.forEach((part) => {
            if (typeof part.text === 'string' && part.text) {
                events.push({ kind: 'text', text: part.text });
            }
            if (part.functionCall) {
                events.push({
                    kind: 'tool',
                    index: events.length,
                    name: part.functionCall.name,
                    fragment: JSON.stringify(part.functionCall.args ?? {})
                });
            }
        });
        const reason = payload?.candidates?.[0]?.finishReason;
        if (reason) events.push({ kind: 'stop', reason });
        if (payload?.usageMetadata) events.push({ kind: 'usage', usage: payload.usageMetadata });
        return events;
    },

    ollama(payload) {
        const events = [];
        const text = payload?.message?.content ?? payload?.response;
        if (typeof text === 'string' && text) {
            events.push({ kind: 'text', text });
        }
        if (payload?.done) {
            events.push({ kind: 'stop', reason: payload.done_reason ?? 'done' });
            events.push({
                kind: 'usage',
                usage: { prompt_eval_count: payload.prompt_eval_count, eval_count: payload.eval_count }
            });
        }
        return events;
    },

    unknown(payload) {
        // Best effort: hunt for the most common delta shapes so an unrecognised
        // provider still produces something readable.
        const text =
            payload?.delta?.text ??
            payload?.text ??
            payload?.content ??
            payload?.delta?.content;
        return typeof text === 'string' && text ? [{ kind: 'text', text }] : [];
    }
};

// ----- usage normalisation -----

const readUsage = (usage, into) => {
    const input =
        usage.input_tokens ?? usage.prompt_tokens ?? usage.promptTokenCount ?? usage.prompt_eval_count;
    const output =
        usage.output_tokens ?? usage.completion_tokens ?? usage.candidatesTokenCount ?? usage.eval_count;

    // Anthropic reports cumulative counts across message_delta events, so take
    // the largest seen rather than summing.
    if (typeof input === 'number') into.input = Math.max(into.input ?? 0, input);
    if (typeof output === 'number') into.output = Math.max(into.output ?? 0, output);

    const cacheRead = usage.cache_read_input_tokens;
    const cacheWrite = usage.cache_creation_input_tokens;
    if (typeof cacheRead === 'number') into.cacheRead = Math.max(into.cacheRead ?? 0, cacheRead);
    if (typeof cacheWrite === 'number') into.cacheWrite = Math.max(into.cacheWrite ?? 0, cacheWrite);
};

// ----- entry point -----

export const parseStream = (source) => {
    const text = source ?? '';
    if (!text.trim()) {
        return empty();
    }

    const format = looksLikeSse(text) ? 'sse' : 'jsonl';
    const frames = format === 'sse' ? parseSse(text) : parseJsonl(text);

    const decoded = [];
    let repairedCount = 0;
    let brokenCount = 0;
    let sawDone = false;

    frames.forEach((frame) => {
        const result = decode(frame.raw);
        if (result.done) {
            sawDone = true;
            return;
        }
        if (result.error) {
            brokenCount += 1;
            decoded.push({ frame, error: result.error });
            return;
        }
        if (result.repaired) repairedCount += 1;
        decoded.push({ frame, payload: result.value, repaired: result.repaired });
    });

    const provider = detect(decoded.map((d) => d.payload).filter(Boolean));
    const extract = EXTRACTORS[provider];

    const timeline = [];
    const toolCalls = new Map();
    const usage = {};
    let message = '';
    let reasoning = '';
    let stopReason = null;

    decoded.forEach(({ frame, payload, repaired, error }) => {
        if (error) {
            timeline.push({ kind: 'error', event: frame.event, detail: error, raw: frame.raw });
            return;
        }

        const events = extract(payload);
        if (events.length === 0) {
            timeline.push({ kind: 'other', event: frame.event ?? payload?.type ?? '', repaired });
            return;
        }

        events.forEach((item) => {
            if (item.kind === 'text') {
                message += item.text;
            } else if (item.kind === 'reasoning') {
                reasoning += item.text;
            } else if (item.kind === 'tool') {
                const key = String(item.index ?? 0);
                const existing = toolCalls.get(key) ?? { index: item.index ?? 0, id: null, name: null, fragments: '' };
                if (item.id) existing.id = item.id;
                if (item.name) existing.name = item.name;
                existing.fragments += item.fragment ?? '';
                toolCalls.set(key, existing);
            } else if (item.kind === 'usage') {
                readUsage(item.usage, usage);
            } else if (item.kind === 'stop') {
                stopReason = item.reason;
            }
            timeline.push({ ...item, event: frame.event ?? payload?.type ?? '', repaired });
        });
    });

    // Tool arguments were streamed as string fragments; parse the joined result,
    // repairing when the stream was cut before the object closed.
    const tools = [...toolCalls.values()]
        .sort((a, b) => a.index - b.index)
        .map((call) => {
            const raw = call.fragments;
            let args = null;
            let argsRepaired = false;
            if (raw.trim()) {
                try {
                    args = JSON.parse(raw);
                } catch (error) {
                    try {
                        args = JSON.parse(jsonrepair(raw));
                        argsRepaired = true;
                    } catch (innerError) {
                        args = null;
                    }
                }
            }
            return { ...call, raw, args, argsRepaired };
        });

    // A stream with no stop reason and no [DONE] almost certainly got cut off.
    const truncated = frames.length > 0 && !sawDone && stopReason === null;

    return {
        format,
        provider,
        providerLabel: PROVIDERS[provider],
        frameCount: frames.length,
        eventCount: timeline.length,
        message,
        reasoning,
        tools,
        usage,
        stopReason,
        truncated,
        repairedCount,
        brokenCount,
        timeline
    };
};

const empty = () => ({
    format: null,
    provider: 'unknown',
    providerLabel: PROVIDERS.unknown,
    frameCount: 0,
    eventCount: 0,
    message: '',
    reasoning: '',
    tools: [],
    usage: {},
    stopReason: null,
    truncated: false,
    repairedCount: 0,
    brokenCount: 0,
    timeline: []
});

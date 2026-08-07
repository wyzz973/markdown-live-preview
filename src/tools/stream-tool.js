// The stream reassembly tool.
//
// Paste a captured SSE or JSONL response; get the message it produced back,
// rendered as Markdown. The rendering step is the point: LLM output is almost
// always Markdown, and this app already renders it well, so the result reads
// like the answer rather than like an escaped string.

import { parseStream } from '../modules/stream-parse.js';
import * as renderer from '../modules/renderer.js';
import { t } from '../modules/strings.js';

const SAMPLE = [
    'event: message_start',
    'data: {"type":"message_start","message":{"usage":{"input_tokens":24}}}',
    '',
    'event: content_block_delta',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"## 快速排序\\n\\n"}}',
    '',
    'event: content_block_delta',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"快速排序是一种**分治**算法，平均时间复杂度 `O(n log n)`。\\n\\n```python\\n"}}',
    '',
    'event: content_block_delta',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"def quicksort(arr):\\n    if len(arr) <= 1:\\n        return arr\\n"}}',
    '',
    'event: content_block_delta',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"    pivot = arr[len(arr) // 2]\\n    return quicksort([x for x in arr if x < pivot]) + [x for x in arr if x == pivot] + quicksort([x for x in arr if x > pivot])\\n```\\n"}}',
    '',
    'event: content_block_start',
    'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_01","name":"run_python"}}',
    '',
    'event: content_block_delta',
    'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"code\\": \\"print(quick"}}',
    '',
    'event: content_block_delta',
    'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"sort([3,1,2]))\\"}"}}',
    '',
    'event: message_delta',
    'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":312}}',
    ''
].join('\n');

// Each tab reports how much it holds, so the strip itself says what the
// response contained — text only, or text plus two tool calls — before you
// click anything. An empty tab is dimmed rather than hidden, because its
// absence is information too.
const TABS = [
    { id: 'message', label: () => t.streamTabMessage, size: (r) => r.message.length },
    { id: 'reasoning', label: () => t.streamTabReasoning, size: (r) => r.reasoning.length },
    { id: 'tools', label: () => t.streamTabTools, size: (r) => r.tools.length, showCount: true },
    { id: 'events', label: () => t.streamTabEvents, size: (r) => r.timeline.length, showCount: true }
];

export const create = ({ onOpenInMarkdown }) => {
    let result = parseStream('');
    let activeTab = 'message';

    const root = document.createElement('div');
    root.className = 'utility';

    // ----- input -----
    const inputPane = document.createElement('section');
    inputPane.className = 'utility-pane utility-input';

    const inputBar = document.createElement('div');
    inputBar.className = 'utility-bar';
    const inputLabel = document.createElement('span');
    inputLabel.className = 'utility-label';
    inputLabel.textContent = t.input;
    const sampleButton = document.createElement('button');
    sampleButton.type = 'button';
    sampleButton.className = 'ghost';
    sampleButton.textContent = t.streamSample;
    const clearButton = document.createElement('button');
    clearButton.type = 'button';
    clearButton.className = 'ghost';
    clearButton.textContent = t.clear;
    inputBar.append(inputLabel, sampleButton, clearButton);

    const input = document.createElement('textarea');
    input.className = 'utility-textarea';
    input.spellcheck = false;
    input.placeholder = t.streamPlaceholder;
    input.setAttribute('aria-label', t.input);

    inputPane.append(inputBar, input);

    // ----- output -----
    const outputPane = document.createElement('section');
    outputPane.className = 'utility-pane utility-output';

    const tabBar = document.createElement('div');
    tabBar.className = 'utility-bar utility-tabs';
    tabBar.setAttribute('role', 'tablist');

    const tabButtons = TABS.map((tab) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'utility-tab';
        button.dataset.tab = tab.id;
        button.setAttribute('role', 'tab');

        const label = document.createElement('span');
        label.textContent = tab.label();
        const count = document.createElement('span');
        count.className = 'tab-count';
        button.append(label, count);

        button.addEventListener('click', () => {
            activeTab = tab.id;
            paint();
        });
        tabBar.appendChild(button);
        return button;
    });

    const openButton = document.createElement('button');
    openButton.type = 'button';
    openButton.className = 'ghost';
    openButton.textContent = t.streamOpenInMarkdown;
    openButton.addEventListener('click', () => onOpenInMarkdown?.(result.message));
    tabBar.appendChild(openButton);

    const body = document.createElement('div');
    body.className = 'utility-body';

    const status = document.createElement('div');
    status.className = 'utility-status';

    outputPane.append(tabBar, body, status);

    root.append(inputPane, outputPane);

    // ----- painting -----

    const chip = (text, tone) => {
        const span = document.createElement('span');
        span.className = tone ? `chip chip-${tone}` : 'chip';
        span.textContent = text;
        return span;
    };

    const paintStatus = () => {
        status.replaceChildren();
        if (result.frameCount === 0) {
            return;
        }

        status.appendChild(chip(result.providerLabel, result.provider === 'unknown' ? 'warn' : 'strong'));
        status.appendChild(chip(result.format === 'sse' ? 'SSE' : 'JSONL'));
        status.appendChild(chip(t.streamFrames(result.frameCount)));
        status.appendChild(chip(t.streamChars(result.message.length)));

        const { input: inTokens, output: outTokens } = result.usage;
        if (inTokens !== undefined || outTokens !== undefined) {
            status.appendChild(chip(t.streamUsage(inTokens, outTokens)));
        }
        if (result.stopReason) {
            status.appendChild(chip(t.streamStop(result.stopReason)));
        }
        if (result.repairedCount > 0) {
            status.appendChild(chip(t.streamRepaired(result.repairedCount), 'warn'));
        }
        if (result.brokenCount > 0) {
            status.appendChild(chip(t.streamBroken(result.brokenCount), 'bad'));
        }
        if (result.truncated) {
            status.appendChild(chip(t.streamTruncated, 'bad'));
        }
    };

    const emptyNote = (text) => {
        const note = document.createElement('p');
        note.className = 'utility-empty';
        note.textContent = text;
        return note;
    };

    const paintMessage = () => {
        if (result.frameCount === 0) {
            return [emptyNote(t.streamEmpty)];
        }
        if (!result.message.trim()) {
            return [emptyNote(t.streamNothing)];
        }
        const article = document.createElement('article');
        article.className = 'markdown-body utility-markdown';
        article.innerHTML = renderer.render(result.message);
        return [article];
    };

    const paintReasoning = () => {
        if (!result.reasoning.trim()) {
            return [emptyNote(t.streamNoReasoning)];
        }
        const article = document.createElement('article');
        article.className = 'markdown-body utility-markdown';
        article.innerHTML = renderer.render(result.reasoning);
        return [article];
    };

    const paintTools = () => {
        if (result.tools.length === 0) {
            return [emptyNote(t.streamNoTools)];
        }
        return result.tools.map((call) => {
            const box = document.createElement('div');
            box.className = 'tool-call';

            const head = document.createElement('div');
            head.className = 'tool-call-head';
            const name = document.createElement('span');
            name.className = 'tool-call-name';
            name.textContent = call.name || `#${call.index}`;
            head.appendChild(name);
            if (call.id) {
                const id = document.createElement('span');
                id.className = 'tool-call-id';
                id.textContent = call.id;
                head.appendChild(id);
            }
            if (call.argsRepaired) {
                head.appendChild(chip(t.streamToolArgsBroken, 'warn'));
            }

            const pre = document.createElement('pre');
            pre.textContent = call.args
                ? JSON.stringify(call.args, null, 2)
                : call.raw || '';

            box.append(head, pre);
            return box;
        });
    };

    const paintEvents = () => {
        if (result.timeline.length === 0) {
            return [emptyNote(t.streamEmpty)];
        }
        const list = document.createElement('div');
        list.className = 'event-list';

        result.timeline.forEach((item, index) => {
            const row = document.createElement('div');
            row.className = `event-row event-${item.kind}`;

            const n = document.createElement('span');
            n.className = 'event-index';
            n.textContent = String(index + 1);

            const kind = document.createElement('span');
            kind.className = 'event-kind';
            kind.textContent = item.kind;

            const detail = document.createElement('span');
            detail.className = 'event-detail';
            if (item.kind === 'text' || item.kind === 'reasoning') {
                detail.textContent = JSON.stringify(item.text);
            } else if (item.kind === 'tool') {
                detail.textContent = item.name ? `${item.name} ${item.fragment ?? ''}` : item.fragment ?? '';
            } else if (item.kind === 'usage') {
                detail.textContent = JSON.stringify(item.usage);
            } else if (item.kind === 'stop') {
                detail.textContent = item.reason;
            } else if (item.kind === 'error') {
                detail.textContent = item.detail;
            } else {
                detail.textContent = item.event || '';
            }

            row.append(n, kind, detail);
            list.appendChild(row);
        });

        return [list];
    };

    const paint = () => {
        // A tab whose content vanished must not stay selected.
        const activeSize = TABS.find((tab) => tab.id === activeTab)?.size(result) ?? 0;
        if (activeSize === 0 && activeTab !== 'message') {
            activeTab = 'message';
        }

        tabButtons.forEach((button, index) => {
            const tab = TABS[index];
            const size = tab.size(result);
            const selected = tab.id === activeTab;

            button.classList.toggle('active', selected);
            button.setAttribute('aria-selected', String(selected));
            button.disabled = size === 0 && tab.id !== 'message';
            button.querySelector('.tab-count').textContent =
                tab.showCount && size > 0 ? String(size) : '';
        });

        openButton.hidden = !(activeTab === 'message' && result.message.trim());

        const painters = {
            message: paintMessage,
            reasoning: paintReasoning,
            tools: paintTools,
            events: paintEvents
        };
        body.replaceChildren(...painters[activeTab]());
        body.scrollTop = 0;
        paintStatus();
    };

    const run = () => {
        result = parseStream(input.value);
        paint();
    };

    input.addEventListener('input', run);
    sampleButton.addEventListener('click', () => {
        input.value = SAMPLE;
        run();
        input.focus();
    });
    clearButton.addEventListener('click', () => {
        input.value = '';
        run();
        input.focus();
    });

    paint();

    return { root, focus: () => input.focus() };
};

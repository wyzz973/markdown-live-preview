// The request inspector.
//
// Paste what you were about to send — or the cURL command the network panel
// gave you — and read it as a conversation instead of as one very long line.
//
// The overview table is the reason this tool exists. When a context window
// fills up, the question is never "how big is the request", it is "which turn
// is eating it", and that is a per-turn share, which nothing else shows you.

import { parseRequest, toTranscript, estimateTokens } from '../modules/request-parse.js';
import * as renderer from '../modules/renderer.js';
import { t } from '../modules/strings.js';

const SAMPLE = JSON.stringify(
    {
        model: 'claude-opus-4-6',
        max_tokens: 4096,
        temperature: 1,
        stream: true,
        system: [
            {
                type: 'text',
                text: '你是一个中文技术写作助手。回答尽量短，代码要能直接跑。',
                cache_control: { type: 'ephemeral' }
            }
        ],
        tools: [
            {
                name: 'run_python',
                description: '在沙箱里执行一段 Python，返回标准输出。',
                input_schema: {
                    type: 'object',
                    properties: {
                        code: { type: 'string', description: '要执行的源码' },
                        timeout: { type: 'integer', description: '超时秒数，默认 10' }
                    },
                    required: ['code']
                }
            }
        ],
        messages: [
            { role: 'user', content: '帮我写一个快速排序，并跑一下 [3,1,2]。' },
            {
                role: 'assistant',
                content: [
                    { type: 'text', text: '先写出来再执行。' },
                    {
                        type: 'tool_use',
                        id: 'toolu_01',
                        name: 'run_python',
                        input: { code: 'print(sorted([3,1,2]))' }
                    }
                ]
            },
            {
                role: 'user',
                content: [{ type: 'tool_result', tool_use_id: 'toolu_01', content: '[1, 2, 3]\n' }]
            }
        ]
    },
    null,
    2
);

const TABS = [
    { id: 'overview', label: () => t.requestTabOverview, size: (r) => r.turns.length },
    { id: 'conversation', label: () => t.requestTabConversation, size: (r) => r.turns.length, showCount: true },
    { id: 'tools', label: () => t.requestTabTools, size: (r) => r.tools.length, showCount: true },
    { id: 'system', label: () => t.requestTabSystem, size: (r) => r.system.length }
];

const ROLE_LABELS = { user: 'user', assistant: 'assistant', model: 'assistant', tool: 'tool' };

export const create = ({ onOpenInMarkdown }) => {
    let result = parseRequest('');
    let activeTab = 'overview';
    let asMarkdown = false;

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

    const ghost = (label, onClick) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'ghost';
        button.textContent = label;
        button.addEventListener('click', onClick);
        return button;
    };

    const input = document.createElement('textarea');
    input.className = 'utility-textarea';
    input.spellcheck = false;
    input.placeholder = t.requestPlaceholder;
    input.setAttribute('aria-label', t.input);

    const sampleButton = ghost(t.requestSample, () => {
        input.value = SAMPLE;
        run();
        input.focus();
    });
    const clearButton = ghost(t.clear, () => {
        input.value = '';
        run();
        input.focus();
    });

    inputBar.append(inputLabel, sampleButton, clearButton);
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

    const markdownToggle = document.createElement('label');
    markdownToggle.className = 'utility-switch';
    const markdownInput = document.createElement('input');
    markdownInput.type = 'checkbox';
    const markdownText = document.createElement('span');
    markdownText.textContent = t.requestRenderMarkdown;
    markdownToggle.append(markdownInput, markdownText);
    markdownInput.addEventListener('change', () => {
        asMarkdown = markdownInput.checked;
        paint();
    });

    const openButton = ghost(t.requestOpenTranscript, () =>
        onOpenInMarkdown?.(toTranscript(result))
    );

    // An explicit spacer rather than an auto margin on the first control: the
    // handoff button hides itself when there is no conversation, and an auto
    // margin would have gone with it, dragging the toggle back to the tabs.
    const spacer = document.createElement('span');
    spacer.className = 'bar-spacer';

    tabBar.append(spacer, openButton, markdownToggle);

    const body = document.createElement('div');
    body.className = 'utility-body';

    const status = document.createElement('div');
    status.className = 'utility-status';

    outputPane.append(tabBar, body, status);
    root.append(inputPane, outputPane);

    // ----- pieces -----

    const chip = (text, tone, title) => {
        const span = document.createElement('span');
        span.className = tone ? `chip chip-${tone}` : 'chip';
        span.textContent = text;
        if (title) span.title = title;
        return span;
    };

    const emptyNote = (text) => {
        const note = document.createElement('p');
        note.className = 'utility-empty';
        note.textContent = text;
        return note;
    };

    const textBody = (text) => {
        if (asMarkdown) {
            const article = document.createElement('article');
            article.className = 'markdown-body utility-markdown';
            article.innerHTML = renderer.render(text);
            return article;
        }
        const pre = document.createElement('pre');
        pre.className = 'req-text';
        pre.textContent = text;
        return pre;
    };

    // ----- overview -----

    // Share is drawn as well as printed: a column of percentages all reads the
    // same at a glance, a column of bars does not.
    const overviewRow = ({ label, role, detail, chars, total, cached }) => {
        const row = document.createElement('div');
        row.className = 'req-row';

        const name = document.createElement('span');
        name.className = 'req-cell req-turn';
        name.textContent = label;

        const roleCell = document.createElement('span');
        roleCell.className = 'req-cell req-role';
        roleCell.textContent = role;

        const detailCell = document.createElement('span');
        detailCell.className = 'req-cell req-blocks';
        detailCell.textContent = detail;

        const charCell = document.createElement('span');
        charCell.className = 'req-cell req-chars';
        charCell.textContent = chars.toLocaleString('zh-CN');

        const share = total > 0 ? chars / total : 0;
        const shareCell = document.createElement('span');
        shareCell.className = 'req-cell req-share';
        const bar = document.createElement('span');
        bar.className = 'req-bar';
        bar.style.setProperty('--share', `${(share * 100).toFixed(1)}%`);
        const percent = document.createElement('span');
        percent.className = 'req-percent';
        percent.textContent = `${(share * 100).toFixed(share < 0.1 ? 1 : 0)}%`;
        shareCell.append(bar, percent);

        row.append(name, roleCell, detailCell, charCell, shareCell);
        if (cached) row.classList.add('req-cached');
        return row;
    };

    const blockSummary = (blocks) => {
        const counts = new Map();
        blocks.forEach((block) => counts.set(block.kind, (counts.get(block.kind) ?? 0) + 1));
        return [...counts]
            .map(([kind, count]) => (count > 1 ? `${kind}×${count}` : kind))
            .join(' ');
    };

    const paintOverview = () => {
        if (result.empty) return [emptyNote(t.requestEmpty)];
        if (result.error) return [emptyNote(t.requestBad(result.error))];
        if (result.isResponse) return [emptyNote(t.requestIsResponse)];

        const nodes = [];

        if (result.params.length || result.model) {
            const params = document.createElement('div');
            params.className = 'req-params';
            if (result.model) params.appendChild(chip(result.model, 'strong'));
            result.params.forEach((param) => {
                const text = `${param.key} ${param.value}`;
                // The chip clips; the tooltip carries the rest.
                params.appendChild(chip(text, undefined, text));
            });
            nodes.push(params);
        }

        const table = document.createElement('div');
        table.className = 'req-table';

        const head = document.createElement('div');
        head.className = 'req-row req-head';
        [
            t.requestColTurn,
            t.requestColRole,
            t.requestColBlocks,
            t.requestColChars,
            t.requestColShare
        ].forEach((label, index) => {
            const cell = document.createElement('span');
            cell.className = `req-cell ${['req-turn', 'req-role', 'req-blocks', 'req-chars', 'req-share'][index]}`;
            cell.textContent = label;
            head.appendChild(cell);
        });
        table.appendChild(head);

        const total = result.stats.chars;

        if (result.system.length) {
            table.appendChild(
                overviewRow({
                    label: '—',
                    role: t.requestRowSystem,
                    detail: blockSummary(result.system),
                    chars: result.systemChars,
                    total,
                    cached: result.system.some((block) => block.cached)
                })
            );
        }

        if (result.tools.length) {
            table.appendChild(
                overviewRow({
                    label: '—',
                    role: t.requestRowTools,
                    detail: t.requestToolCount(result.tools.length),
                    chars: result.toolChars,
                    total,
                    cached: result.tools.some((tool) => tool.cached)
                })
            );
        }

        result.turns.forEach((turn) => {
            table.appendChild(
                overviewRow({
                    label: String(turn.index),
                    role: ROLE_LABELS[turn.role] ?? turn.role,
                    detail: blockSummary(turn.blocks),
                    chars: turn.chars,
                    total,
                    cached: turn.cached
                })
            );
        });

        nodes.push(table);

        if (result.turns.length === 0 && result.system.length === 0) {
            nodes.push(emptyNote(t.requestNoTurns));
        }

        return nodes;
    };

    // ----- conversation -----

    const paintBlock = (block) => {
        switch (block.kind) {
            case 'text':
                return textBody(block.text);
            case 'thinking': {
                const box = document.createElement('div');
                box.className = 'req-thinking';
                box.append(textBody(block.text));
                return box;
            }
            case 'image': {
                const figure = document.createElement('figure');
                figure.className = 'req-image';
                if (block.remote) {
                    // Left unloaded on purpose: fetching it would put a pasted
                    // payload on the network.
                    const note = document.createElement('span');
                    note.className = 'req-image-note';
                    note.textContent = `${t.requestRemoteImage} · ${block.remote}`;
                    figure.appendChild(note);
                } else {
                    const image = document.createElement('img');
                    image.src = block.dataUrl;
                    image.alt = t.requestImage;
                    const caption = document.createElement('figcaption');
                    caption.textContent = `${block.mediaType} · ${(block.bytes / 1024).toFixed(0)} kB`;
                    figure.append(image, caption);
                }
                return figure;
            }
            case 'tool_use': {
                const box = document.createElement('div');
                box.className = 'tool-call';
                const head = document.createElement('div');
                head.className = 'tool-call-head';
                const name = document.createElement('span');
                name.className = 'tool-call-name';
                name.textContent = block.name ?? '';
                head.appendChild(name);
                if (block.id) {
                    const id = document.createElement('span');
                    id.className = 'tool-call-id';
                    id.textContent = block.id;
                    head.appendChild(id);
                }
                const pre = document.createElement('pre');
                pre.textContent =
                    typeof block.input === 'string'
                        ? block.input
                        : JSON.stringify(block.input, null, 2);
                box.append(head, pre);
                return box;
            }
            case 'tool_result': {
                const box = document.createElement('div');
                box.className = 'tool-call';
                const head = document.createElement('div');
                head.className = 'tool-call-head';
                const id = document.createElement('span');
                id.className = 'tool-call-id';
                id.textContent = block.id ?? '';
                head.appendChild(id);
                if (block.isError) head.appendChild(chip(t.requestToolError, 'bad'));
                const pre = document.createElement('pre');
                pre.textContent = block.text;
                box.append(head, pre);
                return box;
            }
            default: {
                const pre = document.createElement('pre');
                pre.className = 'req-text';
                pre.textContent = block.text ?? '';
                return pre;
            }
        }
    };

    const paintConversation = () => {
        if (result.empty) return [emptyNote(t.requestEmpty)];
        if (result.error) return [emptyNote(t.requestBad(result.error))];
        if (result.isResponse) return [emptyNote(t.requestIsResponse)];
        if (result.turns.length === 0) return [emptyNote(t.requestNoTurns)];

        return result.turns.map((turn) => {
            const section = document.createElement('section');
            section.className = 'req-turn-box';

            const head = document.createElement('div');
            head.className = 'req-turn-head';

            const index = document.createElement('span');
            index.className = 'req-turn-index';
            index.textContent = String(turn.index);

            const role = document.createElement('span');
            role.className = 'req-turn-role';
            role.textContent = ROLE_LABELS[turn.role] ?? turn.role;

            const size = document.createElement('span');
            size.className = 'req-turn-size';
            size.textContent = t.requestChars(turn.chars);

            head.append(index, role, size);
            if (turn.cached) head.appendChild(chip(t.requestCached, 'strong'));

            section.appendChild(head);
            turn.blocks.forEach((block) => section.appendChild(paintBlock(block)));
            return section;
        });
    };

    // ----- tools -----

    const paintTools = () => {
        if (result.tools.length === 0) return [emptyNote(t.requestNoTools)];

        return result.tools.map((tool) => {
            const box = document.createElement('div');
            box.className = 'tool-call';

            const head = document.createElement('div');
            head.className = 'tool-call-head';
            const name = document.createElement('span');
            name.className = 'tool-call-name';
            name.textContent = tool.name;
            head.appendChild(name);
            if (tool.cached) head.appendChild(chip(t.requestCached, 'strong'));
            box.appendChild(head);

            if (tool.description) {
                const description = document.createElement('p');
                description.className = 'req-tool-desc';
                description.textContent = tool.description;
                box.appendChild(description);
            }

            // The parameter list rather than the raw schema: a JSON Schema
            // printed whole is a wall, and the question here is what the
            // arguments are called and which are required.
            if (tool.params.length) {
                const list = document.createElement('div');
                list.className = 'req-params-list';
                tool.params.forEach((param) => {
                    const row = document.createElement('div');
                    row.className = 'req-param';

                    const paramName = document.createElement('span');
                    paramName.className = 'req-param-name';
                    paramName.textContent = param.name;

                    const type = document.createElement('span');
                    type.className = 'req-param-type';
                    type.textContent = param.type;

                    row.append(paramName, type);
                    if (param.required) {
                        const required = document.createElement('span');
                        required.className = 'req-param-required';
                        required.textContent = t.requestRequired;
                        row.appendChild(required);
                    }
                    if (param.description) {
                        const description = document.createElement('span');
                        description.className = 'req-param-desc';
                        description.textContent = param.description;
                        row.appendChild(description);
                    }
                    list.appendChild(row);
                });
                box.appendChild(list);
            }

            return box;
        });
    };

    // ----- system -----

    const paintSystem = () => {
        if (result.system.length === 0) return [emptyNote(t.requestNoSystem)];
        return result.system.map((block) => {
            const section = document.createElement('section');
            section.className = 'req-turn-box';
            if (block.cached) {
                const head = document.createElement('div');
                head.className = 'req-turn-head';
                head.appendChild(chip(t.requestCached, 'strong'));
                section.appendChild(head);
            }
            section.appendChild(paintBlock(block));
            return section;
        });
    };

    // ----- status -----

    const paintStatus = () => {
        status.replaceChildren();
        if (result.empty) return;

        if (result.error) {
            status.appendChild(chip(t.requestBad(result.error), 'bad'));
            return;
        }

        if (result.isResponse) {
            status.appendChild(chip(t.requestIsResponse, 'warn'));
            return;
        }

        status.appendChild(
            chip(result.providerLabel, result.provider === 'unknown' ? 'warn' : 'strong')
        );
        if (result.fromCurl) status.appendChild(chip(t.requestFromCurl));
        if (result.repaired) status.appendChild(chip(t.requestRepaired, 'warn'));
        status.appendChild(chip(t.requestTurns(result.turns.length)));
        status.appendChild(chip(t.requestChars(result.stats.chars)));
        status.appendChild(chip(t.requestTokens(result.stats.tokens), undefined, t.requestTokenNote));
        if (result.stats.images) status.appendChild(chip(t.requestImages(result.stats.images)));
        if (result.stats.cacheBreakpoints) {
            status.appendChild(chip(t.requestCacheMarks(result.stats.cacheBreakpoints)));
        }
    };

    const paint = () => {
        const activeSize = TABS.find((tab) => tab.id === activeTab)?.size(result) ?? 0;
        if (activeSize === 0 && activeTab !== 'overview') {
            activeTab = 'overview';
        }

        tabButtons.forEach((button, index) => {
            const tab = TABS[index];
            const size = tab.size(result);
            const selected = tab.id === activeTab;
            button.classList.toggle('active', selected);
            button.setAttribute('aria-selected', String(selected));
            button.disabled = size === 0 && tab.id !== 'overview';
            button.querySelector('.tab-count').textContent =
                tab.showCount && size > 0 ? String(size) : '';
        });

        // Only the panes that show prose can render it.
        markdownToggle.hidden = !['conversation', 'system'].includes(activeTab);
        openButton.hidden = result.turns.length === 0;

        const painters = {
            overview: paintOverview,
            conversation: paintConversation,
            tools: paintTools,
            system: paintSystem
        };
        body.replaceChildren(...painters[activeTab]());
        body.scrollTop = 0;
        paintStatus();
    };

    const run = () => {
        result = parseRequest(input.value);
        paint();
    };

    input.addEventListener('input', run);

    paint();

    return { root, focus: () => input.focus() };
};

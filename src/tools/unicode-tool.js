// Unicode ↔ 中文.
//
// Chinese APIs return 中文 rather than the characters themselves often
// enough that every local JSON tool puts this on the front page; Western ones
// almost never have it. Small tool, real daily use.

import { unicodeToText, textToUnicode } from '../modules/json-tools.js';
import { t } from '../modules/strings.js';

export const create = () => {
    let asciiOnly = true;

    const root = document.createElement('div');
    root.className = 'utility';

    const inputPane = document.createElement('section');
    inputPane.className = 'utility-pane utility-input';

    const inputBar = document.createElement('div');
    inputBar.className = 'utility-bar';
    const inputLabel = document.createElement('span');
    inputLabel.className = 'utility-label';
    inputLabel.textContent = t.input;

    const toChinese = document.createElement('button');
    toChinese.type = 'button';
    toChinese.className = 'ghost';
    toChinese.textContent = t.unicodeToChinese;

    const toEscape = document.createElement('button');
    toEscape.type = 'button';
    toEscape.className = 'ghost';
    toEscape.textContent = t.unicodeToEscape;

    const asciiToggle = document.createElement('label');
    asciiToggle.className = 'utility-switch';
    const asciiInput = document.createElement('input');
    asciiInput.type = 'checkbox';
    asciiInput.checked = asciiOnly;
    const asciiText = document.createElement('span');
    asciiText.textContent = t.unicodeAsciiOnly;
    asciiToggle.append(asciiInput, asciiText);

    inputBar.append(inputLabel, toChinese, toEscape, asciiToggle);

    const input = document.createElement('textarea');
    input.className = 'utility-textarea';
    input.spellcheck = false;
    input.placeholder = '{"name": "\\u4e2d\\u6587"}';
    input.setAttribute('aria-label', t.input);

    inputPane.append(inputBar, input);

    const outputPane = document.createElement('section');
    outputPane.className = 'utility-pane utility-output';

    const outputBar = document.createElement('div');
    outputBar.className = 'utility-bar';
    const outputLabel = document.createElement('span');
    outputLabel.className = 'utility-label';
    outputLabel.textContent = t.output;
    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.className = 'ghost';
    copyButton.textContent = t.copyOutput;
    const swapButton = document.createElement('button');
    swapButton.type = 'button';
    swapButton.className = 'ghost';
    swapButton.textContent = t.swap;
    outputBar.append(outputLabel, swapButton, copyButton);

    const output = document.createElement('textarea');
    output.className = 'utility-textarea';
    output.spellcheck = false;
    output.readOnly = true;
    output.setAttribute('aria-label', t.output);

    outputPane.append(outputBar, output);
    root.append(inputPane, outputPane);

    // Direction is remembered so typing keeps converting the same way.
    let direction = 'decode';

    const run = () => {
        const value = input.value;
        output.value =
            direction === 'decode' ? unicodeToText(value) : textToUnicode(value, { asciiOnly });
        [toChinese, toEscape].forEach((button, index) => {
            button.classList.toggle('active', (index === 0) === (direction === 'decode'));
        });
    };

    toChinese.addEventListener('click', () => {
        direction = 'decode';
        run();
    });
    toEscape.addEventListener('click', () => {
        direction = 'encode';
        run();
    });
    asciiInput.addEventListener('change', () => {
        asciiOnly = asciiInput.checked;
        run();
    });
    input.addEventListener('input', run);
    swapButton.addEventListener('click', () => {
        input.value = output.value;
        direction = direction === 'decode' ? 'encode' : 'decode';
        run();
        input.focus();
    });
    copyButton.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(output.value);
            copyButton.textContent = t.copied;
        } catch (error) {
            copyButton.textContent = t.copyFailed;
        }
        setTimeout(() => {
            copyButton.textContent = t.copyOutput;
        }, 1200);
    });

    run();

    return { root, focus: () => input.focus() };
};

// Light/dark theme for the whole app.
//
// The preview stylesheets used to live in public/ and be swapped by rewriting a
// <link href> that carried a hand-maintained `?v=` cache buster. index.html and
// main.js drifted to different version strings, so every load fetched the
// stylesheet twice and every theme switch fetched a third copy while the
// preview flashed unstyled. Both stylesheets are now bundled as strings and
// swapped in a single <style> tag: one parse, no network, no flash.

import lightMarkdownCss from '../styles/github-markdown-light.css?inline';
import darkMarkdownCss from '../styles/github-markdown-dark_dimmed.css?inline';
import lightCodeCss from 'highlight.js/styles/github.css?inline';
import darkCodeCss from 'highlight.js/styles/github-dark-dimmed.css?inline';

import { read, write, KEYS } from './storage.js';

const STYLE_ELEMENT_ID = 'preview-theme';

export const LIGHT_PREVIEW_CSS = `${lightMarkdownCss}\n${lightCodeCss}`;
const DARK_PREVIEW_CSS = `${darkMarkdownCss}\n${darkCodeCss}`;

const listeners = new Set();

let current = 'light';

const applyPreviewCss = (theme) => {
    let style = document.getElementById(STYLE_ELEMENT_ID);
    if (!style) {
        style = document.createElement('style');
        style.id = STYLE_ELEMENT_ID;
        document.head.appendChild(style);
    }

    const css = theme === 'dark' ? DARK_PREVIEW_CSS : LIGHT_PREVIEW_CSS;
    if (style.textContent !== css) {
        style.textContent = css;
    }
};

export const get = () => current;

export const isDark = () => current === 'dark';

// Mermaid's own theme names, not ours.
export const mermaidTheme = () => (current === 'dark' ? 'dark' : 'default');

export const set = (theme, { persist = true } = {}) => {
    current = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', current);
    applyPreviewCss(current);

    if (persist) {
        write(KEYS.theme, current);
    }

    listeners.forEach((listener) => listener(current));
};

export const onChange = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};

export const init = () => {
    const stored = read(KEYS.theme);
    const preferred =
        stored === 'dark' || stored === 'light'
            ? stored
            : window.matchMedia?.('(prefers-color-scheme: dark)').matches
              ? 'dark'
              : 'light';

    // Don't persist the initial value when it came from the OS preference —
    // that would freeze the app to whatever the OS said on first visit.
    set(preferred, { persist: stored === 'dark' || stored === 'light' });
    return current;
};

export const toggle = () => set(current === 'dark' ? 'light' : 'dark');

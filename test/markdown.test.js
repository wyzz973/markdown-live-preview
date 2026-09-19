import { describe, it, expect } from 'vitest';
import { toHtml } from '../src/modules/markdown.js';

const inline = (markdown) =>
    toHtml(markdown)
        .replace(/<p[^>]*>/, '')
        .replace(/<\/p>\s*$/, '')
        .trim();

describe('emphasis next to Chinese punctuation', () => {
    it('bolds a quoted phrase that sits between Chinese characters', () => {
        expect(inline('这是**“引号里的加粗”**后面的字')).toBe(
            '这是<strong>“引号里的加粗”</strong>后面的字'
        );
    });

    it('closes after a full stop that is followed by more Chinese', () => {
        expect(inline('测试：**加粗。**后面还有')).toBe('测试：<strong>加粗。</strong>后面还有');
    });

    it('handles emphasis wedged between Chinese characters', () => {
        expect(inline('中**文**中')).toBe('中<strong>文</strong>中');
        expect(inline('中文*斜体*中文')).toBe('中文<em>斜体</em>中文');
    });

    it('still bolds English between Chinese', () => {
        expect(inline('中文**English**中文')).toBe('中文<strong>English</strong>中文');
    });

    it('leaves the English cases CommonMark defines unchanged', () => {
        expect(inline('**bold** text')).toBe('<strong>bold</strong> text');
        expect(inline('a*b*c')).toBe('a<em>b</em>c');
        expect(inline('snake_case_word')).toBe('snake_case_word');
        expect(inline('2 * 3 * 4')).toBe('2 * 3 * 4');
        expect(inline('***both***')).toBe('<em><strong>both</strong></em>');
    });

    it('keeps underscores inside Chinese words literal, as before', () => {
        expect(inline('中_文_中')).toBe('中_文_中');
    });
});

describe('soft line breaks', () => {
    it('drops the break between two Chinese characters', () => {
        expect(inline('第一行\n第二行')).toBe('第一行第二行');
        expect(inline('一句话。\n下一句。')).toBe('一句话。下一句。');
    });

    it('keeps the break between English words', () => {
        expect(inline('first line\nsecond line')).toBe('first line\nsecond line');
    });

    it('keeps the break at a Chinese-English boundary', () => {
        expect(inline('中文\nEnglish')).toBe('中文\nEnglish');
    });
});

describe('source lines', () => {
    it('tags each top-level block with the line it starts on', () => {
        const html = toHtml('# 标题\n\n段落一\n段落继续\n\n## 第二节\n\n- 列表\n- 项\n');
        expect(html).toContain('<h1 data-line="1" id="标题">');
        expect(html).toContain('<p data-line="3">');
        expect(html).toContain('<h2 data-line="6" id="第二节">');
        expect(html).toContain('<ul data-line="8">');
    });

    it('counts lines through fenced code', () => {
        const html = toHtml('```js\na\nb\n```\n\n# 之后\n');
        expect(html).toContain('<h1 data-line="6"');
    });

    it('keeps counting through link reference definitions', () => {
        const html = toHtml('[a]: http://a\n[b]: http://b\n\n# 之后\n\n见 [a]\n');
        expect(html).toContain('<h1 data-line="4"');
        expect(html).toContain('<p data-line="6">');
    });

    it('counts Windows line endings as one line each', () => {
        expect(toHtml('段落\r\n\r\n# 标题\r\n')).toContain('<h1 data-line="3"');
    });

    it('tags mermaid blocks too', () => {
        expect(toHtml('\n```mermaid\ngraph LR\n```\n')).toContain('<pre data-line="2" class="mermaid">');
    });
});

describe('front matter', () => {
    it('shows YAML front matter as YAML instead of a rule and a heading', () => {
        const html = toHtml('---\ntitle: 笔记\ntags: [a]\n---\n\n# 正文\n');
        expect(html).toContain('class="front-matter"');
        expect(html).not.toContain('<hr');
        expect(html).not.toContain('<h2');
        expect(html).toContain('<h1 data-line="6" id="正文">');
    });

    it('leaves a leading rule alone when it is not front matter', () => {
        expect(toHtml('---\n\n正文')).toContain('<hr');
    });
});

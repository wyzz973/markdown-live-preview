import { describe, it, expect } from 'vitest';
import { toTypeScript, toGo } from '../src/modules/json-tools.js';

const payload = {
    data: [
        { id: 1, name: '用户1', tags: [], profile: { city: '北京', score: 0 } },
        { id: 2, name: '用户2', tags: ['a'], profile: { city: '上海', score: 7.5 }, vip: true },
        { id: 3, name: null, tags: ['a', 'b'], profile: { city: '深圳', score: 3 } }
    ],
    total: 3
};

describe('TypeScript', () => {
    const ts = toTypeScript(payload);

    it('infers element types from every record, not just the first', () => {
        expect(ts).toContain('tags: string[];');
        expect(ts).not.toContain('unknown[]');
    });

    it('marks a field optional when some records lack it', () => {
        expect(ts).toContain('vip?: boolean;');
        expect(ts).toContain('id: number;');
    });

    it('widens a field that is sometimes null', () => {
        expect(ts).toContain('name: string | null;');
    });

    it('puts the root first', () => {
        expect(ts.indexOf('interface Root')).toBe(0);
        expect(ts.indexOf('interface Data')).toBeLessThan(ts.indexOf('interface Profile'));
    });

    it('names a root array element and aliases the root', () => {
        const out = toTypeScript([{ a: 1 }, { a: 2, b: 'x' }]);
        expect(out).toContain('interface RootItem {');
        expect(out).toContain('b?: string;');
        expect(out).toContain('type Root = RootItem[];');
    });

    it('keeps an empty array unknown when nothing says otherwise', () => {
        expect(toTypeScript({ list: [] })).toContain('list: unknown[];');
    });

    it('does not let two same-named positions overwrite each other', () => {
        const out = toTypeScript({ a: { item: { x: 1 } }, b: { item: { y: 'z' } } });
        expect(out).toContain('interface Item {');
        expect(out).toContain('interface Item2 {');
    });
});

describe('Go', () => {
    const go = toGo(payload);

    it('uses float64 when any record holds a fraction', () => {
        expect(go).toContain('Score float64 `json:"score"`');
    });

    it('uses a pointer for a sometimes-null field and omitempty for a sometimes-missing one', () => {
        expect(go).toContain('Name *string `json:"name"`');
        expect(go).toContain('Vip bool `json:"vip,omitempty"`');
    });

    it('infers slice element types from every record', () => {
        expect(go).toContain('Tags []string `json:"tags"`');
    });
});

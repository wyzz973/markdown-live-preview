import { describe, it, expect } from 'vitest';
import { match, rank } from '../src/modules/fuzzy.js';

const paths = [
    'README.md',
    'notes/README.md',
    'notes/周报.md',
    'notes/设计/方案.md',
    'config/package.json',
    'config/data.json',
    'reports/deep/misc.md'
];

const top = (query) => rank(query, paths).map((hit) => hit.item);

describe('fuzzy match', () => {
    it('matches a subsequence and rejects anything else', () => {
        expect(match('rdm', 'README.md')).not.toBe(null);
        expect(match('xyz', 'README.md')).toBe(null);
    });

    it('does not miss a match by jumping ahead to a word start', () => {
        expect(match('abx', 'a-zb x-b')).not.toBe(null);
    });

    it('matches Chinese file names', () => {
        expect(top('周报')[0]).toBe('notes/周报.md');
        expect(top('方案')[0]).toBe('notes/设计/方案.md');
    });

    it('prefers the file name over its folders', () => {
        expect(top('readme')[0]).toBe('README.md');
        expect(top('data')[0]).toBe('config/data.json');
    });

    it('uses the folder to tell same-named files apart', () => {
        expect(top('notes readme')[0]).toBe('notes/README.md');
    });

    it('returns positions for highlighting', () => {
        expect(match('pkg', 'config/package.json').positions).toHaveLength(3);
    });

    it('matches everything on an empty query', () => {
        expect(match('', 'x')).toEqual({ score: 0, positions: [] });
    });
});

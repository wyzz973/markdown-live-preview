import { describe, it, expect } from 'vitest';
import { outlineFromText } from '../src/modules/json-tools.js';

describe('JSON outline', () => {
    it('hides the children of array elements past the cap along with the elements', () => {
        const data = { data: Array.from({ length: 30 }, (_, i) => ({ id: i, tags: [], profile: { a: 1 } })) };
        const rows = outlineFromText(JSON.stringify(data, null, 2));
        const elements = rows.filter((row) => /^\[\d+\]$/.test(row.label));
        expect(elements).toHaveLength(20);
        // Each visible element brings its two containers; nothing else does.
        expect(rows.filter((row) => row.label === 'profile')).toHaveLength(20);
        expect(rows.filter((row) => row.label === 'tags')).toHaveLength(20);
    });

    it('still counts every member of a capped array', () => {
        const rows = outlineFromText(JSON.stringify({ list: Array.from({ length: 30 }, () => ({})) }));
        expect(rows.find((row) => row.label === 'list').count).toBe(30);
    });
});

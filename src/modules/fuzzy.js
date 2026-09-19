// Fuzzy matching for quick open: type a few characters of a path, in order,
// and get the files that contain them.
//
// A match is a subsequence of the target. Where it lands decides the score:
// characters that follow one another, that start a word or a path segment, or
// that fall in the file name rather than its folders all count for more, so
// `rdm` ranks README.md above a folder that merely contains an r, a d and an m.

const BOUNDARY = /[/\\\-_. ]/;

const isBoundary = (text, at) => at === 0 || BOUNDARY.test(text[at - 1]);

// Can `chars` still be found, in order, starting at `from`?
const canFinish = (haystack, chars, from) => {
    let at = from;
    for (const char of chars) {
        at = haystack.indexOf(char, at);
        if (at === -1) return false;
        at += char.length;
    }
    return true;
};

const nextBoundary = (haystack, target, char, from) => {
    for (let at = haystack.indexOf(char, from); at !== -1; at = haystack.indexOf(char, at + 1)) {
        if (isBoundary(target, at)) return at;
    }
    return -1;
};

// Returns { score, positions } or null. Higher scores are better; positions
// are indexes into `target` for highlighting.
export const match = (query, target) => {
    const chars = [...query.trim().toLowerCase().replace(/\s+/g, '')];
    if (chars.length === 0) return { score: 0, positions: [] };

    const haystack = target.toLowerCase();
    const nameStart = target.lastIndexOf('/') + 1;

    const positions = [];
    let from = 0;
    for (let i = 0; i < chars.length; i += 1) {
        const char = chars[i];
        let at = haystack.indexOf(char, from);
        if (at === -1) return null;

        // When this character would not continue a run anyway, prefer an
        // occurrence that starts a word — but only if the rest of the query
        // can still be matched after it.
        const continues = positions.length > 0 && positions.at(-1) === at - 1;
        if (!continues && !isBoundary(target, at)) {
            const boundary = nextBoundary(haystack, target, char, at + 1);
            if (boundary !== -1 && canFinish(haystack, chars.slice(i + 1), boundary + char.length)) {
                at = boundary;
            }
        }

        positions.push(at);
        from = at + char.length;
    }

    let score = 0;
    positions.forEach((at, index) => {
        score += 1;
        if (index > 0 && positions[index - 1] === at - 1) score += 5;
        if (isBoundary(target, at)) score += 8;
        if (at >= nameStart) score += 3;
    });
    // Shorter targets, and matches that start early, read as more relevant.
    score -= target.length * 0.05;
    score -= positions[0] * 0.1;

    const name = haystack.slice(nameStart);
    const needle = chars.join('');
    if (name.startsWith(needle)) score += 20;
    if (name === needle || haystack === needle) score += 40;

    return { score, positions };
};

// Rank a list of items by one of their string fields.
export const rank = (query, items, key = (item) => item, limit = 30) =>
    items
        .map((item) => ({ item, result: match(query, key(item)) }))
        .filter(({ result }) => result)
        .sort((a, b) => b.result.score - a.result.score)
        .slice(0, limit)
        .map(({ item, result }) => ({ item, ...result }));

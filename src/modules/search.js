// Full-text search across the open folder.
//
// File contents are read once into an in-memory index rather than re-read per
// keystroke: a folder of a few hundred notes is a couple of megabytes, and
// searching strings beats hitting the disk on every character.

const MAX_HITS = 60;
const CONTEXT = 46;

export const createIndex = () => {
    const documents = new Map(); // path -> { entry, lines }

    const put = (entry, text) => {
        documents.set(entry.path, { entry, lines: text.split('\n') });
    };

    const remove = (path) => documents.delete(path);

    const clear = () => documents.clear();

    const search = (query) => {
        const needle = query.trim().toLowerCase();
        if (!needle) {
            return [];
        }

        const hits = [];
        for (const { entry, lines } of documents.values()) {
            for (let i = 0; i < lines.length; i += 1) {
                const line = lines[i];
                const at = line.toLowerCase().indexOf(needle);
                if (at === -1) {
                    continue;
                }

                // Trim long lines around the match so the result row shows the
                // hit rather than the start of a paragraph.
                const from = Math.max(0, at - CONTEXT);
                const snippet = (from > 0 ? '…' : '') + line.slice(from, at + needle.length + CONTEXT).trim();
                const offset = at - from + (from > 0 ? 1 : 0) - (line.slice(from).length - line.slice(from).trimStart().length);

                hits.push({
                    entry,
                    line: i + 1,
                    snippet,
                    matchStart: Math.max(0, offset),
                    matchLength: needle.length
                });

                if (hits.length >= MAX_HITS) {
                    return hits;
                }
                // One hit per line is enough; move on.
            }
        }

        return hits;
    };

    return { put, remove, clear, search, size: () => documents.size };
};

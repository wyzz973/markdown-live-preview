// Two CommonMark rules that misfire on Chinese, and the fixes for both.
//
// 1. Emphasis next to CJK punctuation. CommonMark decides whether `**` can
//    open or close emphasis by looking at the characters on either side, and
//    treats a letter-then-punctuation pairing as "not flanking". Chinese puts
//    full-width punctuation directly against letters all the time, so
//    `这是**“引号”**后面` renders its asterisks literally and `**加粗。**后面`
//    bolds the wrong span. The fix follows the markdown-cjk-friendly proposal:
//    for flanking purposes a CJK character counts the way punctuation does, so
//    it may sit against a delimiter from either side. Only `*` is widened; `_`
//    keeps CommonMark's rules, which already refuse it inside words.
//
// 2. Soft line breaks. A newline inside a paragraph renders as a space, which
//    is right between English words and wrong between two Chinese characters —
//    hard-wrapped Chinese source came out with stray gaps mid-sentence.

const CJK = '\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}\\p{Script=Bopomofo}';

// The GFM variants of marked's own classes (GFM lets `~` sit inside emphasis
// for strikethrough), with CJK added wherever punctuation is.
const punct = `(?!~)[\\p{P}\\p{S}${CJK}]`;
const punctSpace = `(?!~)[\\s\\p{P}\\p{S}${CJK}]`;
const notPunctSpace = `(?:[^\\s\\p{P}\\p{S}${CJK}]|~)`;

const LEFT_DELIM = new RegExp(`^(?:\\*+(?:((?!\\*)${punct})|[^\\s*]))|^_+(?:((?!_)${punct})|([^\\s_]))`, 'u');

// Same alternatives, in the same order, as marked's emStrongRDelimAst; the
// numbered groups mean what the comments in marked say they mean.
const RIGHT_DELIM = new RegExp(
    [
        '^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)', // skip an orphan * inside __strong__
        '[^*]+(?=[^*])', // consume up to the next delimiter
        `(?!\\*)${punct}(\\*+)(?=[\\s]|$)`, // (1) right only
        `${notPunctSpace}(\\*+)(?!\\*)(?=${punctSpace}|$)`, // (2) right only
        `(?!\\*)${punctSpace}(\\*+)(?=${notPunctSpace})`, // (3) left only
        `[\\s](\\*+)(?!\\*)(?=${punct})`, // (4) left only
        `(?!\\*)${punct}(\\*+)(?!\\*)(?=${punct})`, // (5) either
        `${notPunctSpace}(\\*+)(?=${notPunctSpace})` // (6) either
    ].join('|'),
    'gu'
);

const PUNCTUATION = new RegExp(`^((?![*_])${punctSpace})`, 'u');

// marked's Tokenizer.emStrong with the widened classes. Returning false hands
// the source back to marked's own tokenizer, which is what `_` gets.
function emStrong(src, maskedSrc, prevChar = '') {
    if (src[0] !== '*') return false;

    let match = LEFT_DELIM.exec(src);
    if (!match) return false;

    const nextChar = match[1] || match[2] || '';
    if (nextChar && prevChar && !PUNCTUATION.exec(prevChar)) return false;

    const lLength = [...match[0]].length - 1;
    let rDelim;
    let rLength;
    let delimTotal = lLength;
    let midDelimTotal = 0;

    RIGHT_DELIM.lastIndex = 0;
    const masked = maskedSrc.slice(-1 * src.length + lLength);

    while ((match = RIGHT_DELIM.exec(masked)) != null) {
        rDelim = match[1] || match[2] || match[3] || match[4] || match[5] || match[6];
        if (!rDelim) continue;

        rLength = [...rDelim].length;

        if (match[3] || match[4]) {
            delimTotal += rLength;
            continue;
        } else if (match[5] || match[6]) {
            if (lLength % 3 && !((lLength + rLength) % 3)) {
                midDelimTotal += rLength;
                continue;
            }
        }

        delimTotal -= rLength;
        if (delimTotal > 0) continue;

        rLength = Math.min(rLength, rLength + delimTotal + midDelimTotal);
        const lastCharLength = [...match[0]][0].length;
        const raw = src.slice(0, lLength + match.index + lastCharLength + rLength);

        if (Math.min(lLength, rLength) % 2) {
            const text = raw.slice(1, -1);
            return { type: 'em', raw, text, tokens: this.lexer.inlineTokens(text) };
        }

        const text = raw.slice(2, -2);
        return { type: 'strong', raw, text, tokens: this.lexer.inlineTokens(text) };
    }

    return false;
}

export const cjkEmphasis = { tokenizer: { emStrong } };

const CJK_CHAR = `[${CJK}\\u3000-\\u303F\\uFF00-\\uFFEF]`;
const CJK_BREAK = new RegExp(`(?<=${CJK_CHAR})\\n(?=${CJK_CHAR})`, 'gu');

// For marked's walkTokens: drop a soft line break that sits between two CJK
// characters. Only plain text tokens carry soft breaks, so code spans, hard
// breaks and everything else are left alone.
export const joinCjkBreaks = (token) => {
    if (token.type === 'text' && typeof token.text === 'string' && token.text.includes('\n')) {
        token.text = token.text.replace(CJK_BREAK, '');
    }
};

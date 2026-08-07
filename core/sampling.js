/**
 * sampling.js — Agreement at the instrument.
 *
 * The retina pools across photoreceptors and across saccades BEFORE anything
 * reaches cortex. Reliability is computed in the sense organ; what ships upward
 * is a measurement that already carries its own confidence.
 *
 * Doing this downstream would cost an LLM call per sample and hand the mind
 * several answers to reconcile — which is precisely the operation it does
 * badly. So: sample N times, normalise, vote, and ship one value plus how
 * strongly the instrument agreed with itself.
 *
 * THE CRUX IS NORMALISATION. moondream returns "\n 4", " 4", "four", and
 * "The person is holding up 4 fingers" — all the same measurement. Voting on
 * raw strings would report total disagreement on an answer the instrument was
 * certain about, making multi-sampling actively worse than one look.
 */

const NUMBER_WORD = {
    zero:0, one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8,
    nine:9, ten:10, eleven:11, twelve:12, none:0, single:1, a:1, an:1, no:0
};

/** What kind of answer is this query asking for? Drives normalisation. */
function queryType(query) {
    const q = String(query || '').toLowerCase();
    if (/\bhow many\b|\bcount\b|\bnumber of\b|\bhow much\b/.test(q)) return 'count';
    if (/\bcolou?r\b/.test(q)) return 'colour';
    if (/\bread\b|\bwhat does it say\b|\btext\b|\blabel\b/.test(q)) return 'text';
    return 'identity';
}

const ARTICLES = /^(?:a|an|the|some|his|her|their|its|my|your)\s+/i;

// Size and quality adjectives are not part of the identity. "small remote
// control" and "remote control" are the same measurement, and treating them as
// different would report disagreement the instrument did not have.
const HEDGE_ADJ = /^(?:small|large|big|little|tiny|huge|thin|thick|long|short|old|new|modern|typical|standard|ordinary|simple|plain)\s+/i;
const FILLER = /^(?:it (?:is|appears to be|looks like)|the (?:object|item|person) (?:is|appears to be)|i (?:see|observe)|there (?:is|are))\s+/i;

/**
 * Reduce an answer to its measured content, so that equivalent answers compare
 * equal. Returns null when nothing measurable is present — which is itself
 * information: the instrument was queried and did not answer.
 */
function normalise(raw, type) {
    let s = String(raw ?? '').trim().replace(/\s+/g, ' ');
    if (!s) return null;

    if (type === 'count') {
        // A count is a number wherever it appears in the sentence.
        const digit = s.match(/-?\d+/);
        if (digit) return String(parseInt(digit[0], 10));
        const word = s.toLowerCase().match(
            /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|none)\b/);
        if (word) return String(NUMBER_WORD[word[1]]);
        return null;   // asked to count, produced no number
    }

    s = s.toLowerCase().replace(/[.!?]+$/, '');
    s = s.replace(FILLER, '').replace(ARTICLES, '').trim();

    if (type === 'colour') {
        const c = s.match(/\b(red|orange|yellow|green|blue|purple|violet|pink|brown|black|white|grey|gray|silver|gold|golden|beige|tan|cream)\b/);
        return c ? c[1].replace('gray', 'grey') : null;
    }

    if (type === 'identity') {
        // Compare on the head of the phrase. "a small remote control with
        // buttons for various functions" and "remote control" are the same
        // measurement; "urn" is not.
        let head = s.split(/\s+(?:with|that|which|and|on|in|for|held|being)\b/)[0];
        // strip leading hedges repeatedly: "a small old remote" -> "remote"
        let prev;
        do { prev = head; head = head.replace(ARTICLES, '').replace(HEDGE_ADJ, ''); }
        while (head !== prev);
        return head.split(/\s+/).slice(0, 3).join(' ').trim() || null;
    }

    return s.slice(0, 80) || null;
}

/**
 * Vote across samples.
 *
 * The no-majority case is the important one. Three samples giving "1", "4" and
 * "urn" is not a value to choose between — it is a FAILED measurement, and it
 * must report as one. Disagreement produces insufficiency, never a guess.
 */
function vote(rawSamples, query, { minAgreement = 0.5 } = {}) {
    const type = queryType(query);
    const normalised = rawSamples.map(r => normalise(r, type));
    const answered = normalised.filter(v => v !== null);

    const tally = new Map();
    for (const v of answered) tally.set(v, (tally.get(v) || 0) + 1);

    let best = null, bestCount = 0;
    for (const [v, c] of tally) if (c > bestCount) { best = v; bestCount = c; }

    const n = rawSamples.length;
    const ratio = n ? bestCount / n : 0;
    // A tie is not a majority. Two answers each appearing twice out of four
    // means the instrument does not know.
    const tied = [...tally.values()].filter(c => c === bestCount).length > 1;
    const reliable = best !== null && ratio >= minAgreement && !tied;

    return {
        type,
        value: reliable ? best : null,
        agreement: bestCount,
        samples: n,
        answered: answered.length,
        ratio: +ratio.toFixed(2),
        reliable,
        distinct: [...tally.keys()],
        // The raw text of a winning sample, for the record. The normalised form
        // is what was compared; the raw form is what the instrument said.
        raw: reliable
            ? rawSamples[normalised.indexOf(best)]
            : null,
        reason: reliable ? 'agreed'
              : answered.length === 0 ? 'no-answer'
              : tied ? 'tied'
              : 'no-majority'
    };
}

module.exports = { vote, normalise, queryType };

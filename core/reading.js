/**
 * reading.js — Enforce the post-focus response format.
 *
 * The FOCUS instruction works because the client PARSES it. A format that is
 * merely requested is an instruction, and the model had already ignored two of
 * those ("draw EXCLUSIVELY", "base your answer PURELY"). What it obeyed, in the
 * same exchange, was a shape it could not fit a narrative into — and that was
 * extracted in code rather than trusted.
 *
 * So this does three things the prompt cannot:
 *
 *   1. EXTRACTS the bracketed value.
 *   2. VERIFIES it against what the instrument actually recorded. A mismatch is
 *      caught with certainty — no language analysis, just string comparison.
 *      "[READING: a ring]" against a recorded "4" is unambiguous.
 *   3. BOUNDS the commentary to one sentence. A paragraph about the quality of
 *      the light cannot fit in one sentence following a bracketed number, which
 *      is the entire point: reduce the surface, do not police it.
 */

const READING_RE = /\[READING:\s*([^\]]*)\]/i;

function norm(s) {
    return String(s ?? '').trim().toLowerCase().replace(/[.,;:!?"']/g, '').replace(/\s+/g, ' ');
}

/** First sentence of whatever follows the bracket. */
function firstSentence(text) {
    const t = String(text || '').trim();
    if (!t) return '';
    const m = t.match(/^[\s\S]*?[.!?](?=\s|$)/);
    return (m ? m[0] : t).trim();
}

/**
 * @param {string} response  raw model output
 * @param {string} recorded  the value the instrument actually returned
 */
function enforce(response, recorded) {
    const raw = String(response || '');
    const m = raw.match(READING_RE);

    if (!m) {
        // The model ignored the format entirely. Do not silently repair — say so.
        return {
            ok: false, reason: 'no-reading-block',
            reading: null, commentary: raw.trim(), truncated: false,
            text: raw.trim()
        };
    }

    const reading = m[1].trim();

    // --- THE BRACKET IS NOT A CONTAINER FOR PROSE ---
    // Measured on hardware: given "the bracket is your entire reply", the model
    // put a 90-word invented description inside it. A reading that is
    // dramatically longer than what the instrument recorded is not a reading —
    // it is a narrative wearing the format. Catch it as its own condition, not
    // as an ordinary mismatch, because the two want different responses.
    if (recorded !== undefined && recorded !== null &&
        reading.length > Math.max(60, String(recorded).trim().length * 3)) {
        const after0 = raw.slice(m.index + m[0].length);
        return {
            ok: false, reason: 'reading-overlong',
            reading, recorded,
            length: reading.length,
            expected: String(recorded).trim().length,
            commentary: firstSentence(after0), truncated: false,
            text: `${String(recorded).trim()}.`
        };
    }
    const after = raw.slice(m.index + m[0].length);
    const sentence = firstSentence(after);
    const truncated = norm(sentence) !== norm(after);

    // The bracket must contain what the instrument said. This is the one check
    // that needs no interpretation at all.
    const matches = norm(reading) === norm(recorded);

    return {
        ok: matches,
        reason: matches ? 'ok' : 'reading-mismatch',
        reading,
        recorded,
        commentary: sentence,
        truncated,
        // What the operator sees: the verified value and one bounded sentence.
        text: sentence ? `${reading}. ${sentence}` : `${reading}.`
    };
}

module.exports = { enforce, firstSentence, READING_RE };

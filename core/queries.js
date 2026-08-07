/**
 * queries.js — Fixed foveal queries, selected rather than composed.
 *
 * Four sessions of evidence:
 *
 *   PERIPHERAL   fixed prompt, composed by nobody      worked every time
 *   FOVEAL       composed fresh by the 8B each turn    failed about half
 *
 * Every foveal failure was a COMPOSITION failure — wrong subject carried over
 * from an earlier turn, question form ("What object is...?" returns empty),
 * analytic verb ("Determine the location..." returns empty), or florid
 * phrasing ("with high magnification and scrutiny").
 *
 * Each fix was more instruction, and each time a new way to compose it badly
 * appeared. Step 13 told the entity to write questions; step 15 told it not to;
 * step 16 told it which verbs work. That is the same losing pattern this whole
 * project keeps demonstrating: instructions get ignored, gates hold.
 *
 * So stop composing. The entity chooses a SUBJECT; the query is a constant.
 *
 * COST, stated plainly: "describe the third sticker from the left" is no
 * longer expressible. The fovea can ask five questions well instead of any
 * question badly.
 */

// Verbs measured to work on moondream: DESCRIBE, EXAMINE, COUNT, READ.
// Verbs measured to return EMPTY: DETERMINE, IDENTIFY, and any question form.
const QUERIES = {
    count:  "Count the fingers being held up.",
    object: "Describe the object the person is holding.",
    text:   "Read any text visible in the image.",
    colour: "Describe the colours of the object the person is holding.",
    hands:  "Describe where the person's hands are and what they are doing.",
    face:   "Describe the person's face and expression.",
    wall:   "Describe the stickers and posters on the wall.",
    screen: "Describe what is visible on the computer screen.",
    scene:  "Briefly describe: who is present, what is happening, the setting, and any notable objects."
};

// --- THERE IS NO CLASSIFIER HERE, DELIBERATELY ---
//
// An earlier version exported selectQuery(), which mapped a free-text question
// to a subject. It existed for exactly one purpose: to let the foveal gate
// decide whether an existing measurement still answered the current question,
// so the measurement could be reused.
//
// That reuse was not a cache. A measurement taken at one moment, held, and
// presented later as though it described the present IS A MEMORY — and the
// ring is already the memory, with its own reality filter. Two systems holding
// past perceptions under different rules disagreed, and the disagreement
// produced a fabricated smartphone from a finger count.
//
// The reuse is gone, so the classifier is gone with it. What remains is a
// dictionary: the entity chooses a subject word, this file says what the
// camera is told. No inference, no ordering, nothing to round-trip and nothing
// to drift.
//
// If a subject is missing, add an entry. Never add a branch.

// --- ALIASES ---
// Observed: the entity emitted [FOCUS: hand]; the list says `hands`. It fell
// through to the literal path with NO warning, and moondream happened to answer
// the bare word "hand" correctly. A near-miss subject must not silently become
// a literal query.
//
// Aliases resolve to existing subjects. They are NOT new subjects, so the
// prompt's word list stays nine items — the contract does not grow.
const ALIASES = {
    hand: 'hands', finger: 'count', fingers: 'count', number: 'count',
    thing: 'object', item: 'object', held: 'object', holding: 'object',
    colours: 'colour', colors: 'colour', color: 'colour',
    words: 'text', writing: 'text', label: 'text', sign: 'text', read: 'text',
    sticker: 'wall', stickers: 'wall', poster: 'wall', posters: 'wall',
    monitor: 'screen', display: 'screen',
    expression: 'face', room: 'scene', general: 'scene'
};

/** Resolve a subject word to a query, following aliases. Null if unknown. */
function resolve(word) {
    const w = String(word || '').trim().toLowerCase();
    if (QUERIES[w]) return { subject: w, query: QUERIES[w], aliased: false };
    if (ALIASES[w] && QUERIES[ALIASES[w]])
        return { subject: ALIASES[w], query: QUERIES[ALIASES[w]], aliased: true };
    return null;
}

module.exports = { QUERIES, ALIASES, resolve };

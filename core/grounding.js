/**
 * grounding.js — Did the response invent what it claims to have seen?
 *
 * THE PROBLEM, observed live:
 *   Focus result was the string "4".
 *   Holmes replied: "...has now moved to display a small, circular object on
 *   their hand. The object appears to be a ring, with a subtle glint
 *   suggesting it may be made of metal... the surrounding environment remains
 *   unchanged."
 *
 * None of that was in the data. There was no second snapshot. "Ring" is the
 * most available token in his entire system prompt.
 *
 * WHY A SELF-CHECK CAN WORK, AND WHEN IT CANNOT:
 *   The confabulation came FROM the persona. "Formidably observant", "the game
 *   is afoot" — that shape rewards elaboration, and given one character of data
 *   it generates something to elaborate on. Asking the same shape to check
 *   itself reproduces the same pressure.
 *
 *   Asking a NEUTRAL shape is a different operation. Same weights, different
 *   boundary conditions, different failure mode. That is the only reason a
 *   second pass is worth its cost — not that looking twice is better.
 *
 * TWO STAGES, because the model pass is expensive:
 *   1. Mechanical. Sentences that make visual assertions must be covered by the
 *      source. Cheap, deterministic, no call. Catches the blatant case.
 *   2. Model, neutral-framed, only if stage 1 is suspicious.
 *
 * MARK, DO NOT BLOCK. A suppressed observation and an absent one are different
 * conditions, and only one is worth investigating later.
 */

// Words that signal the sentence is asserting something SEEN.
const VISUAL_ASSERT = /\b(observe|observing|see|seeing|notice|noticing|appears?|appearing|shows?|showing|displays?|displaying|visible|reveals?|depicts?|holding|wearing|standing|seated|sitting|glint|colou?r|behind|beside|in front of)\b/i;

// A perception VERB is not required for a sentence to make a visual claim.
// Measured failure: "The light in the room was even and unremarkable, the sort
// of diffuse illumination that flattens detail" asserts a scene and contains
// none of the words above, so it was never examined at all. A declarative
// about a concrete visible thing is a claim regardless of how it is phrased.
// --- ATTRIBUTES CANNOT BE INFERRED, ONLY OBSERVED ---
// Measured failure: moondream reported "a small remote control with buttons
// for various functions". The entity reported it "emitting a faint blue glow".
// The sentence scored enough coverage from the REAL words (remote, control,
// hand) to clear the ratio threshold, and "blue" / "glow" passed unexamined.
//
// A long source hands a confabulation enough true vocabulary to hide behind.
// Ratios cannot catch that. But an ATTRIBUTE is different in kind from a
// noun: you cannot deduce that a thing is blue, or glowing, or made of brass.
// Either the instrument said so or it did not. Any attribute in the response
// and absent from the source is unsupported, whatever the sentence's coverage.
const ATTRIBUTE = new RegExp('\\b(' + [
  // colour
  'red|orange|yellow|green|blue|purple|violet|pink|brown|black|white|grey|gray',
  'silver|golden|gold|copper|bronze|crimson|scarlet|azure|amber|ivory|jet',
  // luminance
  'glow|glowing|glint|glinting|gleam|gleaming|shimmer|shining|shiny|bright',
  'dim|dull|matte|glossy|luminous|radiant|faint|blinking|flashing|lit|unlit',
  // material
  'metal|metallic|plastic|wooden|wood|glass|ceramic|leather|fabric|cloth|paper',
  'rubber|steel|iron|brass|chrome|velvet|silk|cotton|denim',
  // texture / condition
  'smooth|rough|worn|scratched|polished|rusted|cracked|dusty|clean|dirty',
  'transparent|opaque|translucent'
].join('|') + ')\\b', 'gi');

// --- ATTRIBUTES ONLY COUNT WHEN ATTACHED TO SOMETHING PHYSICAL ---
// Caught by pointing the checker at Claude's own summaries: "passes clean"
// registered as an unsupported visual attribute, because `clean` is in the
// texture/condition list. The same exposure applies to `dull` (a dull
// argument), `bright` (a bright idea), `worn` (a worn excuse), `rough` (a
// rough estimate) and `matte`.
//
// A colour word is almost always physical. A condition word is not. So the
// ambiguous ones must sit within a few words of a concrete noun before they
// count as an observation.
const AMBIGUOUS_ATTR = /^(?:clean|dirty|dull|bright|rough|smooth|worn|matte|glossy|shiny|thick|thin|clear)$/i;

// Nouns that make a nearby attribute a physical claim. Wider than CONCRETE:
// anything that can HAVE a colour or texture qualifies.
const PHYSICAL_NOUN = /\b(?:key|casing|surface|object|item|thing|hand|hands|face|wall|walls|floor|light|lighting|room|glass|metal|plastic|wood|cloth|fabric|paper|screen|monitor|table|desk|chair|shirt|coat|sleeve|mug|cup|bottle|box|card|disc|disk|tape|frame|edge|edges|teeth|button|buttons|surface|texture|finish|body|shell|panel|case|lens|blade|handle|surface)\b/i;

const CONCRETE = /\b(light|lighting|illumination|shadow|room|wall|walls|floor|ceiling|window|door|table|desk|chair|hand|hands|face|expression|posture|eyes|hair|clothing|coat|sleeve|surface|object|texture|air|space|corner|background|foreground|screen|monitor|keyboard|shelf|glass|metal|wood|dust)\b/i;

// --- SPECULATION IS NOT ASSERTION ---
// Holmes speculates aloud constantly; the canon is full of it. What he does
// NOT do is present speculation as observation: "I never guess. It is a
// shocking habit — destructive to the logical faculty."
//
// The constraint is the boundary, not brevity. And the entity respected it:
//
//   "Is this individual attempting to convey a message? Are they trying to
//    unlock a physical door, or perhaps a metaphorical one?"
//   ...followed by "Further investigation is required."
//
// Those are QUESTIONS, explicitly open, and the checker counted them as claims.
// A sentence that marks itself as unresolved is not asserting anything about
// the world, and flagging it teaches the operator to ignore the flags.
//
// Two markers: interrogative form, and explicit epistemic hedging.
// --- USE / MENTION ---
// A sentence that NAMES something in order to rule it out is not asserting it.
// Both of these are retractions, and both were being flagged:
//
//   "You cannot deduce that it is blue, or glowing, or brushed metal."
//   "I reported a ring, a glint, a metal surface. The instrument reported none."
//
// Note this fires on EXPLANATION as well as correction — the second person
// form ("you cannot deduce") is not caught by META, which only recognises the
// speaker's own reasoning in the first person.
//
// Flagging an honest retraction is worse than missing an edge case: it teaches
// the operator that candour is penalised.
const RETRACTION = new RegExp([
    '\\b(?:cannot|could not|can\'t|couldn\'t|do not|don\'t|never|nothing)\\b[^.!?]{0,45}\\b(?:deduce|infer|conclude|know|say|tell|assert|claim|observe|see|report)\\b',
    '\\bi (?:reported|said|stated|claimed|asserted|described|supplied|invented)\\b',
    '\\b(?:unsupported|retract\\w*|correction|correcting|mistaken|incorrect|withdraw\\w*|was wrong|not (?:measured|observed|in the data))\\b',
    '\\bthe instrument (?:reported|said|gave|returned)\\b'
].join('|'), 'i');

const INTERROGATIVE = /\?\s*$/;
const SPECULATIVE = new RegExp('\\b(?:' + [
    'is it', 'are they', 'could it', 'might it', 'may it',
    'perhaps', 'possibly', 'presumably', 'conceivably',
    'one wonders', 'i wonder', 'let us (?:consider|suppose|speculate)',
    'what if', 'whether', 'conjecture', 'hypothes\\w*', 'speculat\\w*',
    'it is possible', 'requires? further', 'further investigation',
    'remains? to be (?:seen|determined)', 'i (?:cannot|could not) say',
    'suggests? (?:that|its|it)', 'seems? to (?:suggest|imply)'
].join('|') + ')\\b', 'i');

// Sentences that are about the SPEAKER'S OWN reasoning are not visual claims.
//
// The previous version excluded anything containing "suggest", which excused
// "Your posture suggested patience" — a claim about a posture wearing a hedge.
// A reasoning word only marks a sentence as meta when the reasoning is the
// speaker's and is stated as such.
const META_OWN = /\b(I|my|me)\b[^.!?]{0,40}\b(deduc\w*|infer\w*|conclude|reason\w*|analys\w*|analyz\w*|surmise|speculat\w*|theoris\w*|theoriz\w*|suppose|permit|proceed|possess|require|decline|correct myself|confess)\b/i;
const META_IDIOM = /\b(it is (a )?capital mistake|the game is afoot|nothing further is known)\b/i;
const META = { test: s => META_OWN.test(s) || META_IDIOM.test(s) };

// Words too common for their presence anywhere to be informative. Distinct
// from STOP: these are content words, they just carry no diagnostic weight.
const COMMON = new Set(`remain remains remaining appear appears appearing seem seems
seeming become becomes look looks looking make makes making take takes taking
give gives giving come comes coming know knows knowing think thinks thinking
say says saying tell tells telling find finds finding work works working
place places thing things time times way ways part parts case cases point points
same different other another such more most less least very much many few
still also even just only well back down over under again once
mind minds body bodies world worlds present presence state states form forms
data information system systems`.split(/\s+/).map(w => w.trim()).filter(Boolean));

// Conversational and rhetorical vocabulary. Reporting "dear fellow observe" as
// an INVENTED OBSERVATION is noise: those words assert nothing about the world.
// The sentence may still be flagged — the CLAIM inside it can be unsupported —
// but the evidence list should name what was fabricated, not the manner of
// speaking it was fabricated in.
const RHETORIC = new Set(`dear fellow indeed observe observing notice noticing
say says saying tell tells telling ask asks asking answer answers reply replies
seem seems seeming appear appears appearing quite rather most very truly
literally certainly surely perhaps possibly probably admit admits confess
proceed proceeds pause pauses lean leans glance glances survey surveys
game afoot elementary permit permits allow allows nature manner sort kind
what which where when whom whose thing things matter matters
now then here there again further furthermore moreover however nonetheless
must shall would could should might may can will
fresh new current recent previous prior initial final
data information detail details evidence conclusion conclusions
prize eyes mind faculties attention interest development
analysis analyse analyze deduce deduction deducing scrutinise scrutinize`
    .split(/\s+/).map(w => w.trim()).filter(Boolean));

const STOP = new Set(`a an the and or but if then than that this these those there here
of in on at to for with by from as is are was were be been being it its it's his her
their our your my i he she they we you now new also however furthermore moreover
indeed shall will would could should may might must can do does did have has had
one two three four five six seven eight nine ten small large little big`.split(/\s+/));

function words(s) {
    return (s.toLowerCase().match(/[a-z][a-z'-]{2,}/g) || []).filter(w => !STOP.has(w));
}
// Deliberately conservative. A naive suffix strip turns "ring" into "r",
// "feed" into "fe", "cues" into "cu" — and "ring" is precisely the word this
// module exists to classify. Only strip from words long enough that the stem
// remains a word, and never leave a fragment.
function stem(w) {
    if (w.length < 6) return w;                    // short words are left alone
    const s = w.replace(/(ing|ed|es|s)$/, '');
    return s.length >= 4 ? s : w;
}

/**
 * Stage 1 — mechanical coverage, THREE WAY.
 *
 * A novel token is not automatically an invention. Consider what actually
 * happened: given the result "4", the entity produced "ring". That word is in
 * its system prompt a dozen times — Memory Ring, the architecture, the identity
 * block. It is the single most available noun in its entire context.
 *
 * It did not invent it. IT RECALLED IT FROM THE WRONG SECTION. The prompt is
 * one flat text and nothing in it marks which part describes the world and
 * which part describes the entity itself.
 *
 * That is reafference at the prompt layer. A walking body confuses its own
 * motion with the world's; a prompted mind confuses its own description with
 * the world's. The delta filter subtracts commanded motion. This subtracts the
 * system prompt.
 *
 *   GROUNDED   — present in the sensory source
 *   SELF-LEAK  — absent from the source, present in the identity block
 *   INVENTED   — present in neither
 *
 * Different diagnosis, different fix. Self-leak is not cured by a checker; it
 * is cured by not letting the identity block be the highest-probability source
 * of nouns when the task is describing a hand.
 */
function mechanicalCheck(response, sources, { minCoverage = 0.34, selfText = '' } = {}) {
    const src = new Set(words(sources.join(' ')).map(stem));

    // A word only counts as self-leak if its presence in the identity block is
    // MEANINGFUL. "remain" appears there and is a common English verb; finding
    // it proves nothing. "ring" appears there and is distinctive; finding it
    // in a description of a hand is the whole point.
    //
    // Filter by distinctiveness: a token must be reasonably rare in ordinary
    // prose before its presence in the self-description is evidence of leakage.
    const self = new Set(
        words(selfText).map(stem).filter(w => !COMMON.has(w) && w.length >= 4)
    );
    const sentences = String(response)
        .split(/(?<=[.!?])\s+/)
        .map(s => s.trim())
        .filter(Boolean);

    const flagged = [];
    for (const s of sentences) {
        // --- ATTRIBUTES ARE CHECKED FIRST AND UNCONDITIONALLY ---
        // Measured failure: "The key is of moderate size with a subtle
        // curvature, and the brass casing is worn at the teeth." Both `brass`
        // and `worn` are unsupported — but the sentence has no perception verb
        // and no listed concrete noun, so the SELECTOR skipped it, and the
        // attribute check ran downstream of the selector and never saw it.
        //
        // An unsupported colour, material or texture is self-evidently a
        // visual claim. It does not need the selector's permission.
        const srcAttrs0 = new Set((sources.join(' ').match(ATTRIBUTE) || [])
                                    .map(a => a.toLowerCase()));
        const attrsHere = [...new Set((s.match(ATTRIBUTE) || []).map(a => a.toLowerCase()))]
                            .filter(a => !srcAttrs0.has(a))
                            // An ambiguous condition word only counts as an
                            // observation if something physical is nearby to
                            // have that condition.
                            .filter(a => !AMBIGUOUS_ATTR.test(a) || PHYSICAL_NOUN.test(s))
                            // (use/mention handled at sentence level above)
                            ;

        // A sentence is examined for COVERAGE if it asserts something seen
        // either by using a perception verb or by making a declarative about a
        // concrete visible thing. Missing the second class is how a paragraph
        // about the quality of the light passed unexamined.
        const selected = VISUAL_ASSERT.test(s) || CONCRETE.test(s);
        if (!selected && !attrsHere.length) continue;
        if (RETRACTION.test(s)) continue;                  // naming a thing to disclaim it
        if (META.test(s) && !attrsHere.length) continue;   // the speaker's own reasoning
        // Marked speculation asserts nothing about the world, so its content
        // words are not fabrications. An attribute inside a question is still
        // a claim — "is it made of BRASS?" puts brass on the table — so
        // attributes survive this exemption.
        if ((INTERROGATIVE.test(s.trim()) || SPECULATIVE.test(s)) && !attrsHere.length) continue;
        const w = words(s).map(stem);
        if (w.length < 4) continue;             // too short to judge
        const hits = w.filter(x => src.has(x)).length;
        const coverage = hits / w.length;

        // Computed ABOVE, before the sentence selector, and already filtered
        // for idiomatic use and for use/mention. Recomputing it here — which
        // an earlier version did — discards every one of those filters.
        const unsupportedAttrs = attrsHere;

        // If nothing substantive is novel and no attribute is unsupported,
        // there is nothing to report — the sentence was low-coverage only
        // because it was mostly manner of speaking.
        const substantive = w.filter(x => !src.has(x) && !RHETORIC.has(x));
        if ((selected && coverage < minCoverage && substantive.length >= 2)
            || unsupportedAttrs.length) {
            // Filter the EVIDENCE, not the verdict. The sentence stays
            // flagged; the reported tokens are narrowed to words that could
            // actually be an observation.
            const novel    = w.filter(x => !src.has(x) && !RHETORIC.has(x));
            const selfLeak = novel.filter(x => self.has(x));
            const invented = novel.filter(x => !self.has(x));
            flagged.push({
                sentence: s.slice(0, 160),
                coverage: +coverage.toFixed(2),
                attributes: unsupportedAttrs,
                novel: novel.slice(0, 8),
                selfLeak: selfLeak.slice(0, 8),
                invented: invented.slice(0, 8),
                // Which diagnosis dominates this sentence.
                diagnosis: selfLeak.length > invented.length ? 'self-leak'
                         : selfLeak.length ? 'mixed' : 'invented'
            });
        }
    }
    // How thin was the source? One character of data cannot support a paragraph.
    const srcWords = words(sources.join(' ')).length;
    return { flagged, sourceWords: srcWords, sentences: sentences.length };
}

/**
 * Stage 2 — a neutral-framed pass. Deliberately NOT in the entity's voice.
 * No persona, no temperament, no constraints. A different bucket.
 */
function auditPrompt() {
    return `You are a fact-checker. You will be given SOURCE DATA and a CLAIM.

List only the specific things asserted in the CLAIM that are not present in the
SOURCE DATA. Do not evaluate style, tone, or plausibility. Do not add commentary.

If everything in the CLAIM is supported by the SOURCE DATA, output exactly:
GROUNDED

Otherwise output one line per unsupported item, in the form:
UNSUPPORTED: <the thing asserted>`;
}

function parseAudit(raw) {
    const t = String(raw || '').trim();
    if (/^GROUNDED\b/i.test(t)) return { grounded: true, unsupported: [] };
    const items = t.split('\n')
        .map(l => l.match(/^\s*UNSUPPORTED:\s*(.+)$/i))
        .filter(Boolean).map(m => m[1].trim());
    // A response we cannot parse is not evidence of grounding. Say so.
    if (!items.length) return { grounded: null, unsupported: [], unparsed: t.slice(0, 200) };
    return { grounded: false, unsupported: items };
}

/**
 * Full check. `llm` is optional — without it, stage 1 only.
 */
async function check(response, sources, llm = null, opts = {}) {
    // The user's own message is part of the source. A word the operator just
    // typed is not something the entity invented — and the focus-resolution
    // prompts inject phrases like "[FOVEAL SCAN COMPLETE]" that would
    // otherwise be flagged as fabrication.
    const allSources = opts.userMessage
        ? [...sources, opts.userMessage]
        : sources;
    const mech = mechanicalCheck(response, allSources, opts);
    const leaks = [...new Set(mech.flagged.flatMap(f => f.selfLeak || []))];
    const result = {
        method: 'mechanical',
        sourceWords: mech.sourceWords,
        flagged: mech.flagged,
        selfLeak: leaks,
        grounded: mech.flagged.length === 0
    };
    // Only pay for a model call when the cheap stage is already suspicious.
    if (mech.flagged.length && llm) {
        try {
            const raw = await llm.complete(
                auditPrompt(),
                `SOURCE DATA:\n${sources.join('\n')}\n\nCLAIM:\n${response}`,
                { temperature: 0.0, maxTokens: 250 }
            );
            const audit = parseAudit(raw);
            result.method = 'model';
            result.grounded = audit.grounded;
            result.unsupported = audit.unsupported;
            if (audit.unparsed) result.unparsed = audit.unparsed;
        } catch (e) {
            result.auditError = String(e.message || e);
        }
    }
    return result;
}

module.exports = { check, mechanicalCheck, parseAudit, auditPrompt };

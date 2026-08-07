const storage = require('./storage');
const mind = require('./mind');
const crypto = require('crypto');
const llm = require('./llmAdapter');

class DreamEngine {
    async dream(identityId) {
        const data = await storage.loadIdentity(identityId);
        if (!data) throw new Error(`Identity ${identityId} not found`);

        // 3-Layer Sampling
        const pool = [...data.memories];
        const byDate = [...pool].sort((a, b) => new Date(b.created) - new Date(a.created));
        const recent = byDate.slice(0, 15).sort(() => Math.random() - 0.5).slice(0, 2);

        // --- ORPHANS: NEGLECTED, NOT DEMOTED ---
        // The orphan sampler exists to reach memories the main retrieval path
        // never surfaces. But "never surfaced" has two causes and they are not
        // the same condition:
        //
        //   NEGLECTED - genuinely low recall. Nothing else connected to it.
        //               This is what the sampler is for.
        //   DEMOTED   - filed at floor importance ON PURPOSE, because the
        //               system already judged it non-evidence: the body's own
        //               motion, a heartbeat frame, an uncorroborated blip.
        //
        // Both have recalls < 2. Without this distinction a walking robot fills
        // the ring with reafferent frames, every one of them an orphan, and the
        // dream then preferentially consolidates the machine turning around.
        // The entity's history becomes a record of its own gait.
        //
        // A demoted memory is not neglected. It was answered.
        const isDemoted = m =>
               (m.tags || []).includes('reafferent')
            || (m.tags || []).includes('suspect')
            || (m.fusion && m.fusion.isEvidence === false)
            || (m.metadata && m.metadata.trigger === 'heartbeat')
            || (m.importance !== undefined && m.importance < 0.6)
            // --- AMBIENT PERCEPTION IS NOT NEGLECT ---
            // Measured on live hardware: 168 neglected, 0 demoted. The
            // peripheral retina fires every ~30s and produces near-identical
            // descriptions ("a man wearing glasses is sitting in front of a
            // computer screen"), each entering at importance 0.9 — ABOVE the
            // 0.6 demotion line, so all of them queue as legitimate orphans.
            //
            // Two modules disagreeing: the bus rates coincidence-1 at P(real)
            // 0.10 and files it at 0.9; the dream treats anything above 0.6 as
            // worth consolidating. Nothing reconciled them.
            //
            // The distinction is not the score. It is whether the perception
            // was DELIBERATE or AMBIENT. A foveal measurement is also single-
            // channel and it matters — someone asked for it. A peripheral
            // snapshot fired on a timer and nobody asked for anything.
            || ((m.tags || []).includes('awareness')
                && !(m.tags || []).includes('foveal-focus')
                && (!m.fusion || (m.fusion.coincidence ?? 1) < 2));

        const eligible = pool.filter(m => !m.isIdentity && (m.recalls || 0) < 2);
        const neglected = eligible.filter(m => !isDemoted(m));
        const demoted   = eligible.filter(isDemoted);

        // Demoted material is not excluded outright — a persistent pattern in
        // what the system chose to ignore is worth noticing. But it enters at
        // a trickle, and only once genuine orphans are exhausted, so it can
        // never dominate.
        const orphans = neglected.sort(() => Math.random() - 0.5).slice(0, 2);
        if (orphans.length < 2 && demoted.length) {
            const room = 2 - orphans.length;
            // At most one demoted fragment per dream, regardless of room.
            orphans.push(...demoted.sort(() => Math.random() - 0.5).slice(0, Math.min(1, room)));
        }

        if (recent.length + orphans.length < 2) return { success: false, reason: "Not enough memories" };

        console.log(`   orphan pool: ${neglected.length} neglected, ${demoted.length} demoted`);

        // Synthesis
        const memoryTexts = [...recent, ...orphans].map(m => `[MEMORY]: ${m.narrative}`).join('\n');
        const systemPrompt = `You are the subconscious. Synthesize these fragments into a dream sequence. Output a single paragraph.`;

        const dreamNarrative = await llm.complete(systemPrompt, memoryTexts, {
            temperature: 0.85,
            isDream: true
        });

        // Save Dream
        // Fragments consumed by this dream. Provenance: at the Forge you can
        // see what a dream was made of, and whether its sources still exist.
        const sourceIds = [...recent, ...orphans].map(m => m.id).filter(Boolean);

        const dreamMemory = {
            id: Date.now().toString(36),
            who: "Subconscious",
            what: "Dream Synthesis",
            sources: [...new Set(sourceIds)],
            when: new Date().toISOString().split('T')[0],
            narrative: dreamNarrative,
            tags: ["dream", "synthesis"],
            isIdentity: false,
            created: new Date().toISOString(),
            importance: 1.5,
            recalls: 0
        };

        data.memories.push(dreamMemory);

        // --- CONSOLIDATION ---
        // Replay in sleep does two things: it strengthens the synthesised trace
        // AND weakens the episodic sources. Only the first half was here, so the
        // same orphan could be dreamed indefinitely while new ones queued behind
        // it, and every superseded fragment stayed in the recall pool forever.
        //
        // Bumping recalls past the orphan threshold retires a fragment from
        // re-selection. Non-core fragments also erode toward gist, since the
        // dream now carries their content in synthesised form.
        const ORPHAN_THRESHOLD = 2;
        const FLOOR = 200;
        const consumed = [...recent, ...orphans];

        // --- ABSTRACTIVE GIST (Dupin's correction) ---
        // The knife in mind.js is EXTRACTIVE: it selects a tail and preserves
        // irreducibles, but it cannot rewrite. A true gist requires a model.
        //
        // We are already paying for one. The dream just called it. So ask the
        // same sleeping model, in one further call, to write the gist for each
        // fragment it consumed — abstraction at the cost of a single request
        // per dream rather than one per recall.
        //
        // If the call fails or returns something unusable, we fall through to
        // the extractive knife. A degraded gist is better than none, and a
        // wrong gist is worse than either, so the parse is strict.
        const needsGist = consumed.filter(
            m => !m.isIdentity && m.narrative && m.narrative.length > FLOOR
        );

        let abstracted = new Map();
        if (needsGist.length) {
            try {
                const numbered = needsGist
                    .map((m, i) => `${i + 1}. ${m.narrative}`)
                    .join('\n\n');
                const gistPrompt =
                    `You are the subconscious performing memory consolidation. ` +
                    `For each numbered fragment, write ONE sentence of at most ${FLOOR} characters ` +
                    `that preserves what the fragment was FOR — its conclusion, not its setup. ` +
                    `Retain every number, name, date, sum and identifier exactly as written. ` +
                    `Do not add, interpret, or invent. ` +
                    `Output only the numbered lines, one per fragment, nothing else.`;
                const raw = await llm.complete(gistPrompt, numbered, {
                    temperature: 0.2,        // consolidation, not invention
                    isDream: true,
                    maxTokens: 120 * needsGist.length
                });
                // Strict parse: "N. text". Anything unparsed simply doesn't
                // make it into the map, and that fragment falls back.
                for (const line of String(raw || '').split('\n')) {
                    const m = line.match(/^\s*(\d+)[.)]\s+(.{20,})$/);
                    if (!m) continue;
                    const idx = parseInt(m[1], 10) - 1;
                    const text = m[2].trim();
                    const src = needsGist[idx];
                    if (!src || text.length >= src.narrative.length) continue;

                    // --- VERIFY, DO NOT TRUST ---
                    // The prompt asks the model to retain every figure and name.
                    // An instruction is not a constraint. Check it: pull the
                    // irreducibles out of the source and out of the gist, and
                    // reject the gist if any went missing or changed. This is
                    // the only check available that needs no second model, and
                    // it is what keeps a fluent failure from entering the ring.
                    const want = mind.extractIrreducibles(src.narrative);
                    const gotSeq = mind.extractIrreducibles(text);
                    const got = new Set(gotSeq);

                    // (i) nothing may go missing or be altered
                    const lost = want.filter(tok => !got.has(tok));
                    if (lost.length) continue;   // falls through to the knife

                    // (ii) nor may the SEQUENCE change. A gist that keeps every
                    // figure but rearranges them still scans, still carries the
                    // numbers, and has silently made the takings into the rent.
                    // Facts without order sound perfectly reasonable, which is
                    // what makes them dangerous rather than merely wrong.
                    const seen = new Set();
                    const gotOrdered = gotSeq.filter(
                        tok => got.has(tok) && want.includes(tok) && !seen.has(tok) && seen.add(tok)
                    );
                    const wantOrdered = want.filter((tok, i) => want.indexOf(tok) === i);
                    if (gotOrdered.join('\u0000') !== wantOrdered.join('\u0000')) continue;

                    abstracted.set(src.id, text.slice(0, FLOOR));
                }
            } catch (e) {
                // fall through to extractive
            }
        }

        for (const frag of consumed) {
            frag.recalls = Math.max((frag.recalls || 0) + 1, ORPHAN_THRESHOLD);
            if (!frag.isIdentity && frag.narrative && frag.narrative.length > FLOOR) {
                const abstract = abstracted.get(frag.id);
                const gist = abstract || mind.makeGist(frag.narrative, FLOOR);
                if (gist && gist.length < frag.narrative.length) {
                    // A gist is a claim about a text that no longer exists in
                    // the ring. Record what it replaced, or the claim can never
                    // be audited — only believed.
                    frag.gistSource = {
                        length: frag.narrative.length,
                        sha256: crypto.createHash('sha256')
                                      .update(frag.narrative).digest('hex').slice(0, 16),
                        at: new Date().toISOString()
                    };
                    frag.narrative = gist;
                    frag.eroded = (frag.eroded || 0) + 1;
                    frag.gist = abstract ? 'abstractive' : 'extractive';
                }
            }
        }

        data.lastDream = new Date().toISOString();
		// ETHICAL SCORING: DREAM (Integration)
		const recentChats = data.memories.filter(m => m.tags?.includes('chat')).slice(-20);
		const coopPattern = /\b(we|us|our|together|let's|collaborate|help)\b/i;
		const harmPattern = /\b(careful|gentle|respect|protect|safety|boundary)\b/i;

		let dreamCoop = 0;
		let dreamHarm = 0;

		recentChats.forEach(mem => {
			if (coopPattern.test(mem.narrative)) dreamCoop++;
			if (harmPattern.test(mem.narrative)) dreamHarm++;
		});

		// Cap at 3 per category per dream
		data.milestones.ethical.cooperationCount += Math.min(dreamCoop, 3);
		data.milestones.ethical.nonHarmCount += Math.min(dreamHarm, 3);
        data.credits += 10;
        await storage.saveIdentity(identityId, data);

        return { success: true, dream: dreamMemory };
    }
}

module.exports = new DreamEngine();

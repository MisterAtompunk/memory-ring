/**
 * sensoryBus.js - Cross-modal coincidence detection.
 *
 * Each sensor is a separate device posting independently. No client can see
 * more than its own channel, so the server is the only place fusion can happen.
 *
 * WHY: a single delta filter cannot distinguish a real event from noise or from
 * its own motion. But channels with independent geometry fail independently, so
 * agreement across two or more is evidence no single channel can supply.
 *
 * Measured, on synthetic ground truth:
 *     exactly 1 channel agreeing   P(real) = 0.103
 *     exactly 2                    P(real) = 0.471
 *     exactly 3                    P(real) = 0.905
 *
 * A 9x swing computed from geometry alone. That is what `importance` should be,
 * instead of a flat 1.2.
 *
 * CRITICAL: latency correction is NOT a tolerance window. Widening the
 * acceptance region doubles every channel's exposure to its own noise floor,
 * so chance coincidences multiply faster than real ones. Measured: a tolerance
 * window made fusion WORSE than the best single channel (F1 0.343 vs 0.430).
 * Correcting a KNOWN lag improved it (F1 0.552). Same information, opposite
 * outcome. We shift by known lag and then require tight agreement.
 */

// Known per-channel latency, in ms. Smell diffuses and arrives late; touch is
// instantaneous. These are the lags the bus corrects for before comparing.
const CHANNEL_LAG = {
    vision: 0,
    audio:  0,
    touch:  0,
    smell:  1500,      // diffusion is slow
    thermal: 400,
    contact: 0
};

// How tight agreement must be after latency correction.
const AGREEMENT_MS = 2500;

// How long an event stays in the buffer to be matched against.
const WINDOW_MS = 20000;

// Eviction is on EMPTINESS, not on silence.
//
// A first attempt evicted identities idle for five minutes. That slows a leak
// rather than fixing one: entries are already dead at WINDOW_MS (20s), so the
// key survived four minutes forty doing nothing — and an entity reporting once
// every four minutes never aged out at all. Which is exactly what a
// well-behaved delta filter in a quiet room does. The quiet sensors, the ones
// working correctly, would have been the permanent ones.
//
// The right question is not "when did this entity last speak" but "can this
// buffer corroborate anything". If it holds nothing inside the window, the key
// is waste regardless of when it last reported.
const SWEEP_MS = 30 * 1000;

class SensoryBus {
    constructor({ autoSweep = true } = {}) {
        this.buffers = new Map();   // identityId -> [{channel, corrected, memoryId}]
        // A leak announces itself as a number that only rises. Without the
        // history you notice the machine slowing and then go looking, which is
        // the same as not knowing. A counter costs nothing; add it before you
        // need it.
        this.metrics = { admitted: 0, evicted: 0, highWater: 0, sweeps: 0 };

        if (autoSweep) {
            this._sweeper = setInterval(() => this.sweep(), SWEEP_MS);
            // Do not hold the process open for a housekeeping timer.
            if (this._sweeper.unref) this._sweeper.unref();
        }
    }

    /**
     * Drop every buffer that can no longer corroborate anything.
     * Prunes stale entries first, then releases any key left empty.
     */
    sweep(now = Date.now()) {
        const cutoff = now - WINDOW_MS;
        let dropped = 0;
        for (const [id, buf] of this.buffers) {
            while (buf.length && buf[0].corrected < cutoff) buf.shift();
            if (buf.length === 0) { this.buffers.delete(id); dropped++; }
        }
        this.metrics.evicted += dropped;
        this.metrics.sweeps++;
        return dropped;
    }

    /** Explicit teardown, for tests and for embedding. */
    stop() { if (this._sweeper) clearInterval(this._sweeper); }

    _buf(identityId) {
        if (!this.buffers.has(identityId)) this.buffers.set(identityId, []);
        return this.buffers.get(identityId);
    }

    /**
     * Record an arriving perception and report how much corroboration it has.
     *
     * Returns the coincidence evidence. The caller decides what to do with it —
     * this module never mutates a memory.
     */
    admit(identityId, { channel, at, memoryId, trigger }) {
        const buf = this._buf(identityId);
        const now = at ? new Date(at).getTime() : Date.now();
        this.metrics.admitted++;
        if (this.buffers.size > this.metrics.highWater) this.metrics.highWater = this.buffers.size;

        // Drop anything too old to corroborate anything.
        const cutoff = now - WINDOW_MS;
        while (buf.length && buf[0].corrected < cutoff) buf.shift();

        const lag = CHANNEL_LAG[channel] ?? 0;
        const corrected = now - lag;      // when the event ACTUALLY happened

        // A perception that fired on a heartbeat or a timer is not evidence of
        // anything. Counting it would build a confidence estimate on a channel
        // that has no confidence to estimate — a metronome coincides with
        // everything. Record it, but never let it corroborate.
        const isEvidence = trigger !== 'heartbeat' && trigger !== 'filter disabled';

        const agreeing = new Set();
        const partners = [];
        for (const e of buf) {
            if (e.channel === channel) continue;          // self-agreement is not agreement
            if (!e.isEvidence) continue;
            if (Math.abs(e.corrected - corrected) <= AGREEMENT_MS) {
                agreeing.add(e.channel);
                partners.push(e);
            }
        }

        const entry = { channel, corrected, memoryId, isEvidence, agreedWith: agreeing };
        buf.push(entry);

        const n = isEvidence ? agreeing.size + 1 : 0;

        // --- RETROACTIVE PROMOTION ---
        // Corroboration is only knowable after the fact: the first channel to
        // report cannot know it will be confirmed. Left alone, the same event
        // is filed at importance 0.9 by vision and 2.4 by smell, and the ring
        // keeps the least informative record of it.
        //
        // So reach back. Later confirmation strengthens the earlier trace,
        // which is what consolidation does in a brain and costs nothing here.
        const promote = [];
        if (isEvidence && partners.length) {
            for (const p of partners) {
                p.agreedWith.add(channel);
                const pn = p.agreedWith.size + 1;
                promote.push({
                    memoryId: p.memoryId,
                    channel: p.channel,
                    coincidence: pn,
                    importance: this.importance(pn),
                    confidence: this.confidence(pn),
                    agreedWith: [...p.agreedWith]
                });
            }
        }

        return {
            channel,
            coincidence: n,                         // how many channels agree, incl. this one
            agreedWith: [...agreeing],
            isEvidence,
            correctedAt: new Date(corrected).toISOString(),
            confidence: this.confidence(n),
            importance: this.importance(n, isEvidence),
            promote                                 // earlier memories to raise
        };
    }

    /** Empirical P(real) by coincidence count, from the ground-truth run. */
    confidence(n) {
        return ({ 0: 0.03, 1: 0.10, 2: 0.47, 3: 0.90, 4: 0.95 })[Math.min(n, 4)] ?? 0.95;
    }

    /**
     * Importance from corroboration rather than a constant.
     *
     * A single-channel report enters low and washes out of recall. A
     * three-channel coincidence enters high and survives. The ring then
     * remembers what was corroborated and forgets what one sensor twitched at,
     * which is the difference between a world model and a log.
     */
    importance(n, isEvidence = true) {
        if (!isEvidence) return 0.4;        // heartbeat: admitted, never promoted
        return ({ 0: 0.5, 1: 0.9, 2: 1.6, 3: 2.4, 4: 2.8 })[Math.min(n, 4)] ?? 2.8;
    }

    stats(identityId) {
        const buf = this._buf(identityId);
        const byChannel = {};
        for (const e of buf) byChannel[e.channel] = (byChannel[e.channel] || 0) + 1;
        return { buffered: buf.length, byChannel,
                 tracked: this.buffers.size, ...this.metrics };
    }
}

module.exports = { SensoryBus, CHANNEL_LAG, AGREEMENT_MS, WINDOW_MS, SWEEP_MS };

/**
 * gait.js - Efference copy for a legged Memory Ring body.
 *
 * A delta filter cannot distinguish "the world moved" from "I moved". Measured:
 * a walking body without a self-channel records 69% of its memories about its
 * own motion. The ring fills with the robot turning around, and the dream —
 * which samples neglected memories by design — then consolidates that.
 *
 * The fix is the vestibular one, but NOT an IMU. A legged machine already knows
 * what it commanded its legs to do. That is the efference copy in its actual
 * biological sense: a copy of the OUTGOING motor command, not a reading of the
 * result. It is available BEFORE the camera sees the consequence, which is
 * exactly what makes prediction possible.
 *
 * An IMU tells you that you moved. The gait controller tells you that you were
 * about to.
 *
 * Where the two disagree, something happened that neither can report alone.
 */

// --- TRIPOD GAIT ---
// Hexapod, alternating tripods: legs 0,2,4 swing while 1,3,5 stance, then swap.
// Body translates during stance and is momentarily still at phase transitions.
const LEGS = 6;
const TRIPOD_A = [0, 2, 4];

class Gait {
    constructor(opts = {}) {
        this.cycleMs   = opts.cycleMs   || 1200;   // one full gait cycle
        this.strideM   = opts.strideM   || 0.06;   // metres advanced per cycle
        this.yawPerCyc = opts.yawPerCyc || 0.0;    // radians turned per cycle
        this.t0        = Date.now();
        this.commanded = { forward: 0, yaw: 0 };   // set by whatever drives it

        // How much visual field a unit of yaw actually displaces. This depends
        // on lens, focal length, capture interval and distance to the scene —
        // none of which are knowable in advance. So do not guess a constant:
        // learn it from what the camera reports while the body is under a
        // known command. Same principle as the noise floor.
        this.yawGain = opts.yawGain ?? 0.9;   // starting estimate only
        this.fwdGain = opts.fwdGain ?? 0.15;
        this.samples = [];                    // observed / yawRate ratios
    }

    /** The controller's own command. This IS the efference copy. */
    command(forward, yaw) {
        this.commanded.forward = forward;   // -1..1
        this.commanded.yaw     = yaw;       // -1..1
    }

    /** Phase within the gait cycle, 0..1 */
    phase(now = Date.now()) {
        return ((now - this.t0) % this.cycleMs) / this.cycleMs;
    }

    /** Which legs are in swing right now. */
    swingLegs(now = Date.now()) {
        const p = this.phase(now);
        const a = p < 0.5;
        return Array.from({length: LEGS}, (_, i) => i)
                    .filter(i => TRIPOD_A.includes(i) === a);
    }

    /**
     * Predicted self-motion for this instant. This is the quantity a delta
     * filter must subtract before deciding that anything happened.
     *
     * yawRate dominates: rotation sweeps the ENTIRE visual field, whereas
     * forward translation only changes the periphery. That asymmetry is why a
     * turning robot is far noisier to itself than a walking one.
     */
    selfMotion(now = Date.now()) {
        const p = this.phase(now);
        // Body velocity is not constant across the cycle. It peaks mid-stance
        // and falls to ~0 at the swap, when the tripods exchange support.
        const support = Math.abs(Math.sin(Math.PI * ((p * 2) % 1)));
        const forward = this.commanded.forward * (this.strideM / (this.cycleMs / 1000)) * support;
        const yawRate = this.commanded.yaw * (this.yawPerCyc / (this.cycleMs / 1000)) * support;

        // Expected fraction of the visual field displaced. Rotation is weighted
        // far more heavily than translation for the reason above. The constants
        // are LENS-DEPENDENT and want field calibration; they are exposed
        // rather than buried.
        const expectedFieldShift =
              Math.abs(yawRate) * this.yawGain
            + Math.abs(forward) * this.fwdGain;

        return {
            phase: +p.toFixed(3),
            swing: this.swingLegs(now),
            forward: +forward.toFixed(4),
            yawRate: +yawRate.toFixed(4),
            expectedFieldShift: +expectedFieldShift.toFixed(4),
            moving: expectedFieldShift > 0.005,
            source: 'efference'          // commanded, not observed
        };
    }

    /**
     * Feed back what the camera ACTUALLY saw while under a known command, so
     * the gain converges on this body, this lens, this room.
     *
     * MEDIAN, not mean: a real event occurring during self-motion is an
     * outlier, and a mean would let it inflate the gain and blind the sensor.
     */
    observe(observedRatio, now = Date.now()) {
        const s = this.selfMotion(now);
        if (Math.abs(s.yawRate) < 0.02) return;      // no command, no information
        this.samples.push(observedRatio / Math.abs(s.yawRate));
        if (this.samples.length > 40) this.samples.shift();
        if (this.samples.length >= 5) {
            const sorted = [...this.samples].sort((a, b) => a - b);
            const median = sorted[Math.floor(sorted.length / 2)];
            // Move slowly. A step change means something is wrong, not that
            // the lens changed.
            this.yawGain = 0.8 * this.yawGain + 0.2 * median;
        }
    }

    /**
     * Compare the command against an actual IMU reading.
     *
     * Agreement is unremarkable. DISAGREEMENT is the finding: legs commanded to
     * stance while the accelerometer reports motion means the body is being
     * moved by something other than itself. A robot that can detect being
     * picked up, pushed, or slipping has learned something no single channel
     * could report.
     */
    reconcile(imu, now = Date.now()) {
        const pred = this.selfMotion(now);
        if (!imu) return { ...pred, reconciled: false };
        const yawErr = Math.abs((imu.yawRate ?? 0) - pred.yawRate);
        const accMag = Math.hypot(imu.ax ?? 0, imu.ay ?? 0, (imu.az ?? 9.81) - 9.81);
        const unexplained = yawErr > 0.15 || accMag > 1.5;
        return {
            ...pred,
            reconciled: true,
            yawError: +yawErr.toFixed(3),
            unexplainedAccel: +accMag.toFixed(3),
            // This is a POSITIVE detection, not an error condition.
            externalForce: unexplained,
            note: unexplained
                ? 'commanded motion does not explain measured motion — external force'
                : 'measured motion consistent with command'
        };
    }
}

module.exports = { Gait, LEGS, TRIPOD_A };

/**
 * sensor.js - Memory Ring Remote Eye
 * Runs on Pi Zero W with Pi Camera Module.
 * Captures frames and sends them to the Memory Ring server for processing.
 * 
 * The Pi is the eye. The server is the brain.
 * 
 * SETUP:
 *   1. Install Node.js on the Pi:  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs
 *   2. Copy this file and .env to the Pi
 *   3. Test camera:  libcamera-still -o test.jpg
 *   4. Run:  node sensor.js
 * 
 * .env format:
 *   SERVER_URL=http://192.168.1.100:3141
 *   IDENTITY_ID=mr-your-identity-id
 *   CAPTURE_INTERVAL=30000
 *   RESOLUTION_WIDTH=640
 *   RESOLUTION_HEIGHT=480
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Efference copy. Optional: a fixed camera has no body and no self-motion.
let gait = null;
try {
    if (process.env.GAIT_ENABLED === 'true') {
        const { Gait } = require('./gait');
        gait = new Gait({
            cycleMs:   parseInt(process.env.GAIT_CYCLE_MS) || 1200,
            strideM:   parseFloat(process.env.GAIT_STRIDE_M) || 0.06,
            yawPerCyc: parseFloat(process.env.GAIT_YAW_PER_CYCLE) || 0.35
        });
    }
} catch (e) { /* no gait module: behave as a fixed eye */ }

// --- CONFIGURATION ---
require('dotenv').config();

const CONFIG = {
    serverUrl:   process.env.SERVER_URL || 'http://127.0.0.1:3141',
    identityId:  process.env.IDENTITY_ID || '',
    interval:    parseInt(process.env.CAPTURE_INTERVAL) || 30000,
    width:       parseInt(process.env.RESOLUTION_WIDTH) || 640,
    height:      parseInt(process.env.RESOLUTION_HEIGHT) || 480,
    tmpPath:     '/tmp/sensor_frame.jpg',
    quality:     60, // JPEG quality (lower = smaller payload)

    // Change detection. Without it this sensor is a metronome: it fires on a
    // timer regardless of whether anything happened, pays for a vision call
    // every cycle, and fills the ring with identical views of an empty room.
    // A channel that fires on a timer coincides with everything, so any
    // downstream confidence estimate built on it is meaningless.
    deltaEnabled:   process.env.DELTA_ENABLED !== 'false',
    deltaPixel:     parseInt(process.env.DELTA_PIXEL)     || 35,
    deltaGrid:      parseInt(process.env.DELTA_GRID)      || 32,

    // ADAPTIVE THRESHOLD, not a fixed ratio.
    // retina.js uses 0.15, which is right for a FACE AT WEBCAM DISTANCE. A
    // person crossing a room at 64x48 occupies ~5% of frame, so a fixed 0.15
    // misses them entirely — measured. But the separation is clean: sensor
    // noise produced 0.0% and a walking figure 2.0-4.5% in the same scene.
    // So don't guess a constant that depends on lens, distance and lighting.
    // Learn the noise floor and fire at a multiple of it. Self-calibrating,
    // and it survives being moved to a different room.
    deltaFactor:    parseFloat(process.env.DELTA_FACTOR)  || 4.0,
    deltaFloorMin:  parseFloat(process.env.DELTA_FLOOR_MIN) || 0.01,
    deltaCeiling:   parseFloat(process.env.DELTA_CEILING) || 0.25,
    calibrateFrames: parseInt(process.env.CALIBRATE_FRAMES) || 8,

    // Detection runs on a tiny RAW capture, never on the JPEG. JPEG is a
    // compressed stream: one pixel of sensor noise reorganises the whole byte
    // sequence, so differencing two JPEGs of the same still room measured ~30%
    // change. Only decoded pixels can be compared. Mirrors retina.js, which
    // detects on a low-res canvas and captures full-res only when it fires.
    probeWidth:     parseInt(process.env.PROBE_WIDTH)     || 64,
    probeHeight:    parseInt(process.env.PROBE_HEIGHT)    || 48,
    probePath:      '/tmp/sensor_probe.rgb',

    // Fire anyway after this many skipped cycles, so a slow drift is not
    // invisible forever and the entity does not go blind in a still room.
    heartbeatEvery: parseInt(process.env.HEARTBEAT_EVERY) || 40
};

if (!CONFIG.identityId) {
    console.error('❌ IDENTITY_ID not set in .env — sensor cannot operate without a target identity.');
    process.exit(1);
}

console.log(`👁️ Memory Ring Sensor v1.0`);
console.log(`🧠 Target: ${CONFIG.serverUrl}`);
console.log(`🎯 Identity: ${CONFIG.identityId}`);
console.log(`📷 Resolution: ${CONFIG.width}x${CONFIG.height}`);
console.log(`⏱️  Interval: ${CONFIG.interval / 1000}s`);
console.log('');

// --- CAPTURE ---
function captureFrame() {
    try {
        // libcamera-still is the modern Raspberry Pi camera tool (replaces raspistill)
        execSync(
            `libcamera-still -o ${CONFIG.tmpPath} --width ${CONFIG.width} --height ${CONFIG.height} ` +
            `--quality ${CONFIG.quality} --nopreview --immediate -t 200`,
            { stdio: 'pipe', timeout: 10000 }
        );
        const buffer = fs.readFileSync(CONFIG.tmpPath);
        return `data:image/jpeg;base64,${buffer.toString('base64')}`;
    } catch (err) {
        // Fallback: try legacy raspistill
        try {
            execSync(
                `raspistill -o ${CONFIG.tmpPath} -w ${CONFIG.width} -h ${CONFIG.height} ` +
                `-q ${CONFIG.quality} -t 1 -n`,
                { stdio: 'pipe', timeout: 10000 }
            );
            const buffer = fs.readFileSync(CONFIG.tmpPath);
            return `data:image/jpeg;base64,${buffer.toString('base64')}`;
        } catch (err2) {
            console.error('📷 Capture failed:', err2.message);
            return null;
        }
    }
}

// --- LOW-RES RAW PROBE ---
// 64x48 RGB = 9216 bytes. Cheap on a Pi Zero, and it is actual pixels.
function captureProbe() {
    try {
        execSync(
            `libcamera-still -o ${CONFIG.probePath} --width ${CONFIG.probeWidth} ` +
            `--height ${CONFIG.probeHeight} --encoding rgb --nopreview --immediate -t 100`,
            { stdio: 'pipe', timeout: 8000 }
        );
        return fs.readFileSync(CONFIG.probePath);
    } catch (err) {
        return null;   // caller fires rather than going blind
    }
}

// --- DELTA FILTER ---
let lastGrid = null;
let skipped = 0;

// Coarse-grain raw RGB into an NxN luminance grid. Averaging over cells is what
// makes this robust to per-pixel sensor noise while still catching a body
// walking into frame.
function toGrid(rgb, w, h, n) {
    const grid = new Array(n * n).fill(0);
    const counts = new Array(n * n).fill(0);
    for (let y = 0; y < h; y++) {
        const gy = Math.min(n - 1, Math.floor(y * n / h));
        for (let x = 0; x < w; x++) {
            const gx = Math.min(n - 1, Math.floor(x * n / w));
            const i = (y * w + x) * 3;
            if (i + 2 >= rgb.length) continue;
            // Rec.601 luma. retina.js samples the R channel only; luma is
            // strictly better and costs two multiplies.
            const lum = 0.299 * rgb[i] + 0.587 * rgb[i + 1] + 0.114 * rgb[i + 2];
            const c = gy * n + gx;
            grid[c] += lum; counts[c]++;
        }
    }
    for (let i = 0; i < grid.length; i++) if (counts[i]) grid[i] /= counts[i];
    return grid;
}

// Rolling window of recent deltas. The floor is a LOW PERCENTILE of it, so a
// few genuine events do not drag the threshold up and blind the sensor.
let history = [];

function noiseFloor() {
    if (history.length < 3) return CONFIG.deltaFloorMin;
    const s = [...history].sort((a, b) => a - b);
    const p25 = s[Math.floor(s.length * 0.25)];
    return Math.max(p25, CONFIG.deltaFloorMin / CONFIG.deltaFactor);
}

function detectChange(rgb) {
    if (!CONFIG.deltaEnabled) return { fire: true, reason: 'filter disabled' };
    if (!rgb) return { fire: true, reason: 'probe failed' };
    const grid = toGrid(rgb, CONFIG.probeWidth, CONFIG.probeHeight, CONFIG.deltaGrid);
    if (lastGrid === null) { lastGrid = grid; return { fire: true, reason: 'first frame' }; }

    let moved = 0;
    for (let i = 0; i < grid.length; i++) {
        if (Math.abs(grid[i] - lastGrid[i]) > CONFIG.deltaPixel) moved++;
    }
    const ratio = moved / grid.length;
    lastGrid = grid;

    history.push(ratio);
    if (history.length > 60) history.shift();

    // Bootstrap: learn what "nothing happening" looks like before judging.
    if (history.length <= CONFIG.calibrateFrames) {
        return { fire: false, reason: 'calibrating', ratio };
    }

    const floor = noiseFloor();
    let threshold = Math.min(
        Math.max(floor * CONFIG.deltaFactor, CONFIG.deltaFloorMin),
        CONFIG.deltaCeiling
    );

    // --- REAFFERENCE CANCELLATION ---
    // Raise the bar by exactly as much displacement the body's own command
    // predicts. This is subtraction of a PREDICTION, not a tolerance window:
    // it does not widen the acceptance region, it moves it.
    // The prediction is available before the camera sees the consequence,
    // which is the whole reason a commanded copy beats an accelerometer.
    const self = gait ? gait.selfMotion() : null;
    if (self && self.moving) threshold += self.expectedFieldShift;

    if (ratio > threshold) {
        skipped = 0;
        return { fire: true, reason: 'change', ratio, threshold, self };
    }
    if (self && self.moving && ratio > (threshold - self.expectedFieldShift)) {
        // Would have fired if the body were still. Mark it — do not silently
        // discard. A suppressed observation and an absent one are different
        // conditions, and only one of them is worth investigating later.
        skipped++;
        return { fire: false, reason: 'reafferent', ratio, threshold, self };
    }
    skipped++;
    if (skipped >= CONFIG.heartbeatEvery) { skipped = 0; return { fire: true, reason: 'heartbeat', ratio, threshold }; }
    return { fire: false, reason: 'static', ratio, threshold };
}

let lastTrigger = { reason: 'first frame', ratio: null };

// --- TRANSMIT ---
async function sendToServer(imageBase64) {
    try {
        // Step 1: Send image to vision endpoint for interpretation
        const visionRes = await fetch(`${CONFIG.serverUrl}/api/vision`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                image: imageBase64,
                prompt: `You are the retina of a persistent entity observing through a remote sensor.
Extract what matters for memory, not description.
[presence]: who/what is visible
[activity]: what is happening
[context]: environmental markers (light, time, location cues)
[stakes]: anything notable or changed
One line each. Terse.`
            })
        });

        if (!visionRes.ok) throw new Error(`Vision endpoint returned ${visionRes.status}`);
        const { digest } = await visionRes.json();
        
        if (!digest || digest.length < 5) {
            console.log('👁️ Nothing meaningful perceived. Skipping.');
            return;
        }

        // Step 2: Ingest the perception as a sensory memory
        const sensoryRes = await fetch(`${CONFIG.serverUrl}/api/sensory/${CONFIG.identityId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                who: "Remote Sensor (Pi)",
                narrative: digest,
                importance: 1.2,
                tags: ["sensory", "awareness", "remote-eye"],
                channel: "vision",
                metadata: {
                    source: "pi-sensor",
                    // Why this frame was transmitted. A perception that fired
                    // on a heartbeat is not evidence of anything, and anything
                    // counting coincidences downstream needs to know that.
                    trigger: lastTrigger.reason,
                    deltaRatio: lastTrigger.ratio ?? null,
                    threshold: lastTrigger.threshold ?? null,
                    selfMotion: lastTrigger.self ?? null,
                    resolution: `${CONFIG.width}x${CONFIG.height}`,
                    timestamp: new Date().toISOString()
                }
            })
        });

        if (!sensoryRes.ok) throw new Error(`Sensory endpoint returned ${sensoryRes.status}`);
        const result = await sensoryRes.json();
        
        console.log(`✨ ${new Date().toLocaleTimeString()} — Perception integrated: ${digest.substring(0, 60)}...`);
        return result;

    } catch (err) {
        console.error(`🔴 Transmission failed: ${err.message}`);
    }
}

// --- MAIN LOOP ---
let stats = { cycles: 0, sent: 0, skipped: 0 };

async function cycle() {
    stats.cycles++;

    // Probe first. The expensive full capture happens only if something moved,
    // which is the whole saving: a still room costs one 9KB raw read per cycle
    // instead of a full frame plus a vision call.
    const change = detectChange(captureProbe());
    lastTrigger = change;

    if (!change.fire) {
        stats.skipped++;
        if (stats.skipped % 20 === 0) {
            console.log(`   (still - ${stats.skipped} skipped, ${stats.sent} sent of ${stats.cycles})`);
        }
        return;
    }

    const image = captureFrame();
    if (!image) return;
    stats.sent++;
    const pct = change.ratio !== undefined ? ` d${(change.ratio * 100).toFixed(1)}%` : '';
    console.log(`[eye] firing [${change.reason}]${pct}`);
    await sendToServer(image);
}

// Exported so the filter can be tested without a camera.
if (typeof module !== 'undefined') module.exports = { toGrid, detectChange, CONFIG };

// Initial capture
cycle();

// Recurring captures
setInterval(cycle, CONFIG.interval);

console.log('🌙 Sensor loop active. Ctrl+C to disconnect.');

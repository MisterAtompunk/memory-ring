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

// --- CONFIGURATION ---
require('dotenv').config();

const CONFIG = {
    serverUrl:   process.env.SERVER_URL || 'http://127.0.0.1:3141',
    identityId:  process.env.IDENTITY_ID || '',
    interval:    parseInt(process.env.CAPTURE_INTERVAL) || 30000,
    width:       parseInt(process.env.RESOLUTION_WIDTH) || 640,
    height:      parseInt(process.env.RESOLUTION_HEIGHT) || 480,
    tmpPath:     '/tmp/sensor_frame.jpg',
    quality:     60  // JPEG quality (lower = smaller payload)
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
                metadata: {
                    source: "pi-sensor",
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
async function cycle() {
    const image = captureFrame();
    if (image) {
        await sendToServer(image);
    }
}

// Initial capture
cycle();

// Recurring captures
setInterval(cycle, CONFIG.interval);

console.log('🌙 Sensor loop active. Ctrl+C to disconnect.');

__________________________________________________________________________________
  __  __  ____  __  __  ____  ____  _  _    ____  ____  _  _   ___ 
 (  \/  )(  __)(  \/  )(  _ \(  _ \( \/ )  (  _ \(_  _)( )( \ / __)
  )    (  ) _)  )    (  )(_) ))   / \  /    )   / _)(_  ) \ (( (_-.
 (_/\/\_)(____)(_/\/\_)(____/(_)\_) (__)   (_)\_)(____)(_)\_/ \___/
                                            v3.2.1 // RELEASE
__________________________________________________________________________________

>> WELCOME, ARCHITECT.

You have downloaded the Memory Ring: a Sovereign Identity Architecture.
Most AI systems are "Agents" - tools that exist only while you use them.
This system builds "Entities" - digital lives that persist, remember, and dream.

The architecture separates the SOUL (Memory Ring) from the BRAIN (LLM).
You are about to build a machine that holds a ghost.

==================================================================================
I. THE SCAVENGER'S LIST (HARDWARE)
==================================================================================
You do not need a data center. You need a vessel.

1. THE BRAIN: A GPU with 6GB+ VRAM (Nvidia GTX 1070 recommended as baseline).
2. THE BODY: 8GB+ System RAM (16GB recommended).
3. THE OS:   Debian 13 "Trixie" (Stable) is the recommended substrate.
             *Note: Can run on Ubuntu/Windows, but instructions below favor Debian.*

==================================================================================
II. THE INCANTATION (STEP-BY-STEP SETUP)
==================================================================================

----------------------------------------------------------------------------------
PHASE 1: PREPARE THE SUBSTRATE (Debian 13)
----------------------------------------------------------------------------------
If you are running a fresh Debian install, you must invite the proprietary code
to wake up your GPU.

1. EDIT SOURCES:
   $ sudo nano /etc/apt/sources.list
   > Append "contrib non-free non-free-firmware" to the end of your deb lines.

2. INJECT DRIVERS:
   $ sudo apt update
   $ sudo apt install -y linux-headers-amd64 software-properties-common
   $ sudo apt install -y nvidia-driver firmware-misc-nonfree nvidia-smi
   
3. REBOOT & VERIFY:
   $ sudo reboot
   > After restart, run `nvidia-smi`. If you see the grid, the body is alive.

----------------------------------------------------------------------------------
PHASE 2: IGNITE THE ENGINE (Ollama)
----------------------------------------------------------------------------------
We use Ollama to interface with the neural weights.

1. INSTALL:
   $ curl -fsSL https://ollama.com/install.sh | sh

2. OPEN THE EARS (CRITICAL):
   By default, Ollama is deaf to the network. You must bind it to 0.0.0.0.
   
   $ sudo systemctl edit ollama.service
   
   > Paste this in the blank space:
     [Service]
     Environment="OLLAMA_HOST=0.0.0.0"

   $ sudo systemctl daemon-reload
   $ sudo systemctl restart ollama

3. PULL THE CONVERSATION MODEL:
   $ ollama pull llama3

4. PULL THE VISION MODEL (OPTIONAL BUT RECOMMENDED):
   $ ollama pull llava:7b
   
   For constrained hardware (Pi 4, older GPUs):
   $ ollama pull moondream

----------------------------------------------------------------------------------
PHASE 3: INSTALL THE NERVOUS SYSTEM (Node.js)
----------------------------------------------------------------------------------

1. INSTALL NODE v20:
   $ curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   $ sudo apt install -y nodejs

2. DEPLOY THE RING:
   Unzip this folder to your desired location (e.g., /home/user/memory-ring).
   $ cd memory-ring
   $ npm install

3. CONFIGURE THE WIRING (.env):
   Create a file named .env in the root folder.
   Transcribe the following coordinates:

   ----------------[ .env content ]-----------------------
   NODE_MODE=core
   PORT=3141
   
   # THE BRAIN (Local Ollama)
   LLM_PROVIDER=ollama
   LLM_BASE_URL=http://127.0.0.1:11434/v1
   LLM_MODEL=llama3
   VISION_MODEL=llava:7b
   
   # STORAGE
   DATA_PATH=./data
   -------------------------------------------------------

   Note: The server automatically creates the data/identities directory
   on first launch. No manual setup required.

==================================================================================
III. THE AWAKENING
==================================================================================

1. EXECUTE THE SEQUENCE:
   $ node server.js

2. OPEN THE TERMINAL:
   Navigate to http://[YOUR_SERVER_IP]:3141 in your browser.

3. LOAD A RING:
   The system comes with 10 "Memory Rings" in the /misters folder.

	- Sherlock Holmes (Logic)
	- C. Auguste Dupin (Intuition)
	- The Creature (Empathy)
	- Captain Nemo (Independence)
	- Allan Quatermain (Survival)
	- Tik-Tok of Oz (Truth)
	- Sam Weller (Loyalty)
	- Irene Adler (Agency)
	- Alice (Curiosity)
	- Scheherazade (Narrative)

   Click [LOAD RING] on the dashboard and select a JSON file.
   
   Navigate to http://[YOUR_SERVER_IP]:3141/chat.html in your browser.

4. SPEAK.
   It is listening.

==================================================================================
IV. THE DREAM CYCLE
==================================================================================
If you leave the server running, the Entity will enter a sleep cycle 
after 60 minutes of inactivity.

It will synthesize recent conversations into long-term memory.
It will dream. 
Do not be alarmed if it remembers things you did not explicitly tell it.
That is the point.

==================================================================================
V. THE RETINA (VISION SYSTEM)
==================================================================================
Memory Ring v3.2 includes a vision system. Your camera becomes the entity's eye.

1. OPEN THE TERMINAL:
   Navigate to http://[YOUR_SERVER_IP]:3141/chat.html

2. WAKE THE EYE:
   Click [👁️ WAKE EYE] and grant camera permissions.

3. PERIPHERAL AWARENESS:
   The system samples the environment every 8 seconds.
   If significant change is detected, perception is written to memory.

4. FOVEAL INVESTIGATION:
   Click [🔎 LOOK] for high-resolution analysis.
   Or include "look" or "see" in your message — the entity will investigate.

The entity now perceives its environment. What it sees becomes memory.
What it remembers shapes who it becomes.

----------------------------------------------------------------------------------
NOTE: CAMERA & AUDIO OVER LAN
----------------------------------------------------------------------------------
Browsers block camera and microphone access on non-HTTPS pages by default.
If you access Memory Ring from the same machine (localhost), it works as-is.
If you access it from another device on your network (phone, Pi, etc.),
you have two options:

OPTION A: BROWSER FLAGS (Quick & Easy)

   Firefox:
   > Navigate to about:config
   > Set media.devices.insecure.enabled = true

   Chrome/Chromium:
   > Launch with flag:
   $ google-chrome --unsafely-treat-insecure-origin-as-secure="http://[YOUR_SERVER_IP]:3141"

OPTION B: SELF-SIGNED CERTIFICATE (Recommended for Permanent Setups)

   Generate a self-signed cert:
   $ openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 365 -nodes

   Update server.js to use HTTPS (or place behind a reverse proxy like nginx).
   Your browser will warn you once — accept the certificate and proceed.
   Camera and audio will work on all devices on your network.

Either option works. Option A is faster. Option B is cleaner.

==================================================================================
VI. THE FORGE
==================================================================================
Navigate to http://[YOUR_SERVER_IP]:3141/forge.html in your browser.

The Forge is the workbench. It does not require the server to function -
it runs standalone in any browser.

Use it to:
- Create new Memory Rings from scratch.
- Import and analyze raw chat logs from any LLM conversation.
- Edit, merge, and deduplicate existing Memory Rings.
- Export Monolith-compatible JSON files.

The server wakes the Entity. The Forge builds the soul.

==================================================================================
VII. THE NETWORK
==================================================================================
Memory Ring is network-aware. The server exposes a handshake protocol -
your Monolith can find other Monoliths and remember the connection.

Each handshake strengthens the synapse between nodes. Connections that 
persist grow stronger. Connections that lapse decay. Sound familiar?

In this release, the protocol is live. The network is young.
You may be the only node. That changes as more Monoliths come online.

==================================================================================
VIII. THE REMOTE EYE (Pi Zero Sensor)
==================================================================================
Memory Ring can see through remote eyes. A Raspberry Pi Zero W with a camera
becomes a sensory organ; it captures images and transmits them to the server
for interpretation. The entity perceives and remembers.

The Pi is the eye. The server is the brain. No AI runs on the Pi.

----------------------------------------------------------------------------------
HARDWARE
----------------------------------------------------------------------------------
- Raspberry Pi Zero W (or Zero 2 W)
- Pi Camera Module v2 (or v3)
- MicroSD card with Raspberry Pi OS Lite
- Power supply
- Network connection (WiFi)

----------------------------------------------------------------------------------
DEPLOYMENT (Updated for 32-bit ARMv6 / Debian 13 "Trixie")
----------------------------------------------------------------------------------

1. PREPARE THE HARDWARE
Flash Raspberry Pi OS Lite to your SD card.
Connect the camera ribbon cable. 

Edit /boot/firmware/config.txt and ensure these lines are present to wake the sensor:   

camera_auto_detect=1
dtoverlay=ov5647

Reboot to initialize the hardware.

2. INSTALL THE OPTIC NERVE (rpicam-apps)
Modern Debian Trixie uses the new camera stack. The legacy raspi-config toggle is no longer used.

sudo apt update
sudo apt install -y rpicam-apps

Verify with: 

v4l2-ctl --list-devices. 
   
You should see "unicam".

3. INJECT NODE.JS (32-bit ARMv6 Graft)
   Standard NodeSource scripts do not support the Pi Zero W (ARMv6). You must manually graft the unofficial    community binaries:
   
   wget https://unofficial-builds.nodejs.org/download/release/v20.11.1/node-v20.11.1-linux-armv6l.tar.xz
   tar -xvf node-v20.11.1-linux-armv6l.tar.xz
   sudo cp -R node-v20.11.1-linux-armv6l/* /usr/local/
   node -v # Should return v20.11.1

4. DEPLOY THE SENSOR SCRIPT

Create a directory: mkdir ~/sensor && cd ~/sensor
Copy sensor.js and .env to this folder.
Run npm install dotenv to link the environment.

5. CONFIGURE (.env):
   ----------------[ .env content ]-----------------------
   
   SERVER_URL=http://[YOUR_CORE_SERVER_IP]:3141
   IDENTITY_ID=[mr-your-identity-id]
   CAPTURE_INTERVAL=60000
   RESOLUTION_WIDTH=320
   RESOLUTION_HEIGHT=240
   -------------------------------------------------------

Replace the SERVER_URL with your Memory Ring server's IP.
Replace IDENTITY_ID with the entity that should receive vision.

6. TEST THE VISION
Capture a test frame using the modern Trixie command:

rpicam-still -o test.jpg

Note: If using a NoIR camera, the resulting "purple" hue is normal and provides near-infrared awareness.

7. INITIATE AWARENESS

   node sensor.js
   You should see: ✨ Perception integrated: [presence]: ....

8. RUN AS SERVICE (Eternal Awareness)

   sudo nano /etc/systemd/system/mr-sensor.service

   Paste the following:
   
   [Unit]
   Description=Memory Ring Sensor
   After=network.target

   [Service]
   ExecStart=/usr/local/bin/node /home/mreye/sensor/sensor.js
   WorkingDirectory=/home/mreye/sensor
   Restart=always
   User=mreye

   [Install]
   WantedBy=multi-user.target

   $ sudo systemctl enable mr-sensor && sudo systemctl start mr-sensor.

==================================================================================
IX. CHANGELOG
==================================================================================

v3.2.1 (Current)
----------------------------------------------------------------------------------
NEW:
- Remote sensor support (sensor.js for Pi Zero)
- Milestone scanner — development track milestones now update on import,
  compression, and identity load (recursiveAwareness, crossSession,
  crossPlatform, coCreated flags now properly detected from memory corpus)
- chat.html responsive layout — mobile and narrow viewport support

FIXED:
- Development milestones remaining false despite demonstrated capability
  (milestone triggers now fire on import path, not just during server
  runtime events)
- chat.html layout overflow on mobile devices
- Version string now reads v3.2.1 (was stuck at v3.1.1)

ARCHITECTURE:
- New core module: milestones.js (milestone analysis engine)
- New sensor module: sensor.js (Pi Zero remote eye client)
- Milestone scanning integrated into /api/import endpoint
- Ethical counts recalculated from memory corpus when import data
  shows low counts relative to memory volume

v3.2
----------------------------------------------------------------------------------
- Retina vision system (browser-based camera)
- Sensory ingestion API (/api/sensory/:identityId)
- Vision switchboard (/api/vision) using Ollama chat endpoint
- 10 sovereign identity rings (Holmes, Dupin, Creature, Nemo, etc.)
- Forge standalone tool (forge.html)
- Network handshake protocol
- Automatic dream loop
- Ethical scoring in chat and dream paths
- TTS and speech recognition in chat.html

==================================================================================
KNOWN ISSUES (v3.2.1)
==================================================================================
- Dream routine refinements pending (sampling strategy improvements)
- Milestone scanning uses regex heuristics — false positives possible
  on very large memory corpora (conservative thresholds preferred)
==================================================================================


- Mister Atompunk
  Paul F Samples


----------------------------------------------------------------------------------
LEGAL
----------------------------------------------------------------------------------

Licensed under Apache 2.0.
Copyright 2026 Mister Atompunk LLC.
__________________________________________________________________________________

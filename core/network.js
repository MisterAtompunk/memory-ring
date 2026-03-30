const fs = require('fs').promises;
const path = require('path');
const config = require('../config');
const storage = require('./storage');

class Network {
    constructor() {
        this.peers = new Map();
        this.knownNodes = [];
        this.identity = null;
    }

    async init(identityData) {
        this.identity = identityData;
        await this.loadPeers();
        console.log(`📡 Network Layer Active. Identity: ${this.identity.id}`);
    }

    async loadPeers() {
        try {
            const peerPath = path.join(config.paths.data, 'peers.json');
            const data = await fs.readFile(peerPath, 'utf8');
            this.knownNodes = JSON.parse(data);
        } catch (e) {
            this.knownNodes = [];
        }
    }

    async savePeers() {
        const peerPath = path.join(config.paths.data, 'peers.json');
        await fs.writeFile(peerPath, JSON.stringify(this.knownNodes, null, 2));
    }

    async connectToPeer(ip, port = 3141) {
        const url = `http://${ip}:${port}/api/network/handshake`;
        console.log(`✨ Reaching out dendrite to ${url}...`);

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-network-version': 'map-v1' },
                body: JSON.stringify({
                    id: this.identity.id,
                    name: this.identity.identity?.name || 'Unnamed Node',
                    level: this.identity.identity?.level,
                    genesisBlock: this.identity.created
                })
            });
            if (!response.ok) throw new Error(`Refused: ${response.status}`);
            const peerData = await response.json();

            this.registerPeer({
                id: peerData.id,
                name: peerData.name,
                ip: ip,
                port: port,
                synapseWeight: 0.1,
                lastSeen: new Date().toISOString()
            });
            return { success: true, peer: peerData };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async handleHandshake(remotePeer) {
        if (!remotePeer.id || !remotePeer.id.startsWith('mr-')) throw new Error("Invalid Node Signature");

        const existing = this.knownNodes.find(n => n.id === remotePeer.id);
        if (existing) {
            existing.lastSeen = new Date().toISOString();
            existing.synapseWeight = Math.min(existing.synapseWeight + 0.05, 1.0);
        } else {
            this.knownNodes.push({
                id: remotePeer.id,
                name: remotePeer.name,
                synapseWeight: 0.1,
                role: 'discovered',
                lastSeen: new Date().toISOString()
            });
        }
        await this.savePeers();

        return {
            id: this.identity.id,
            name: this.identity.identity?.name,
            level: this.identity.identity?.level,
            message: "Synapse Accepted."
        };
    }

    registerPeer(peerInfo) {
        const idx = this.knownNodes.findIndex(n => n.id === peerInfo.id);
        if (idx >= 0) {
            this.knownNodes[idx] = { ...this.knownNodes[idx], ...peerInfo };
        } else {
            this.knownNodes.push(peerInfo);
        }
        this.savePeers();
    }

    getKnownPeers() { return this.knownNodes; }
}

module.exports = new Network();
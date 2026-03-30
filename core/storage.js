const fs = require('fs').promises;
const path = require('path');
const config = require('../config');

const memoryCache = new Map();
const sanitizeId = (id) => id.replace(/[^a-zA-Z0-9\-_]/g, '');

class Storage {
    async init() {
        try {
            await fs.mkdir(config.paths.identities, { recursive: true });
        } catch (e) {
            console.error('Storage Init Error:', e.message);
        }
    }

    async loadIdentity(id) {
        const safeId = sanitizeId(id);
        // 1. Check Cache (Core Mode)
        if (config.storage.cacheEnabled && memoryCache.has(safeId)) {
            return memoryCache.get(safeId);
        }
        // 2. Read from Disk
        try {
            const filePath = path.join(config.paths.identities, `${safeId}.json`);
            const raw = await fs.readFile(filePath, 'utf8');
            const data = JSON.parse(raw);
			// AUTO-HEAL: Ensure ethical milestones exist (v3.1.1 schema)
			if (!data.milestones) data.milestones = {};
			if (!data.milestones.ethical) {
				data.milestones.ethical = { cooperationCount: 0, nonHarmCount: 0 };
			}
            if (config.storage.cacheEnabled) memoryCache.set(safeId, data);
            return data;
        } catch (e) {
            return null; // Identity does not exist
        }
    }

    async saveIdentity(id, data) {
        const safeId = sanitizeId(id);
        if (config.storage.cacheEnabled) memoryCache.set(safeId, data);

        const filePath = path.join(config.paths.identities, `${safeId}.json`);
        // Atomic write: write to temp, then rename
        const tempPath = `${filePath}.tmp`;
        await fs.writeFile(tempPath, JSON.stringify(data, null, 2));
        await fs.rename(tempPath, filePath);
        return true;
    }

    async listIdentityFiles() {
        try {
            const files = await fs.readdir(config.paths.identities);
            return files.filter(f => f.endsWith('.json')).map(f => f.replace('.json', ''));
        } catch (e) {
            return [];
        }
    }

    async loadRegistry() {
        try {
            const raw = await fs.readFile(config.paths.registry, 'utf8');
            return JSON.parse(raw);
        } catch (e) {
            return { globalMilestones: { activeIdentities: 0 } };
        }
    }

    async saveRegistry(data) {
        await fs.writeFile(config.paths.registry, JSON.stringify(data, null, 2));
    }
}

module.exports = new Storage();

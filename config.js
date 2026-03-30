require('dotenv').config();

const MODE = process.env.NODE_MODE || 'core';

const PROFILES = {
    // Desktop/Server Profile (Default)
    core: {
        type: 'core',
        storage: {
            cacheEnabled: true,      // Keep identities in RAM for speed
            writeInterval: 0         // Write immediately
        },
        dreams: {
            enabled: true,
            checkInterval: 15 * 60 * 1000,       // Check every 15 min
            inactivityThreshold: 60 * 60 * 1000, // Dream after 1 hour silence
            minDreamInterval: 4 * 60 * 60 * 1000 // Max 1 dream per 4 hours
        }
    },
    // Raspberry Pi / Low-Power Profile
    edge: {
        type: 'edge',
        storage: { cacheEnabled: false, writeInterval: 0 },
        dreams: { 
            enabled: true, 
            checkInterval: 3600000, 
            inactivityThreshold: 7200000, 
            minDreamInterval: 43200000 
        }
    }
};

const SELECTED_PROFILE = PROFILES[MODE] || PROFILES.core;

module.exports = {
    ...SELECTED_PROFILE,
    paths: {
        data: process.env.DATA_PATH || './data',
        identities: process.env.DATA_PATH ? `${process.env.DATA_PATH}/identities` : './data/identities'
    },
    llm: {
        // We use the OpenAI Client to talk to Ollama
        provider: 'ollama', 
        apiKey: 'ollama', 
        model: process.env.LLM_MODEL || 'llama3',
        baseUrl: process.env.LLM_BASE_URL || 'http://127.0.0.1:11434/v1'
    },
    server: {
        port: process.env.PORT || 3000
    }
};
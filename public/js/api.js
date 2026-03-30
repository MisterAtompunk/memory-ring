// Memory Ring Client Bridge
const CONFIG = {
    baseUrl: window.location.origin + '/api',
    apiKey: localStorage.getItem('mr_api_key') || 'dev-key'
};

const api = {
    setKey: (key) => {
        CONFIG.apiKey = key;
        localStorage.setItem('mr_api_key', key);
    },

    request: async (endpoint, method = 'GET', body = null) => {
        const headers = { 'Content-Type': 'application/json', 'x-api-key': CONFIG.apiKey };
        const options = { method, headers };
        if (body) options.body = JSON.stringify(body);
        try {
            const res = await fetch(`${CONFIG.baseUrl}${endpoint}`, options);
            if (res.status === 401) { alert('API Key Rejected.'); return null; }
            return await res.json();
        } catch (e) {
            console.error('API Error:', e);
            return { error: e.message };
        }
    },

    // --- METHODS ---
    listIdentities: () => api.request('/identities'),
    getIdentity: (id) => api.request('/identity', 'POST', { identityId: id }),
    chat: (id, msg, sessionId) => api.request('/chat', 'POST', { identityId: id, message: msg, sessionId }),
    writeMemory: (id, fields, tags, isIdentity) =>
        api.request('/writeMemory', 'POST', { identityId: id, fields, tags, isIdentity }),
    getDreamStatus: (id) => api.request(`/dream/status/${id}`),
    triggerDream: (id) => api.request(`/dream/trigger/${id}`, 'POST'),
    
    // NEW IMPORT METHOD
    importIdentity: (data) => api.request('/import', 'POST', { identityData: data }),

    // --- NETWORK ---
    connectToPeer: (ip) => api.request('/network/connect', 'POST', { ip }),
    getPeers: () => api.request('/network/peers')
};
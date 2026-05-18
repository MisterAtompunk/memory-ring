/**
 * tools.js — The Hands
 * Tool registry and dispatch for Memory Ring entities.
 * 
 * The Chamber (./chamber/) is the entity's workspace.
 * It can read, write, search, and execute within it.
 * It cannot see or touch anything outside it.
 * 
 * Tools are registered individually and enabled via TOOLS_ENABLED in .env.
 * Only enabled tools are injected into the entity's system prompt.
 * The entity cannot request tools it doesn't know about.
 */

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHAMBER_DIR = path.resolve('./chamber');

// Ensure the chamber exists
if (!fs.existsSync(CHAMBER_DIR)) {
    fs.mkdirSync(CHAMBER_DIR, { recursive: true });
}

/**
 * Path sanitization — prevents traversal, absolute paths, null bytes.
 * The entity stays inside the chamber. Always.
 */
function safePath(filename) {
    if (!filename || typeof filename !== 'string') return null;
    // Strip traversal attempts, path separators, null bytes
    const clean = filename
        .replace(/\.\./g, '')
        .replace(/[\/\\]/g, '')
        .replace(/\0/g, '')
        .trim();
    if (!clean || clean.length === 0) return null;
    const resolved = path.join(CHAMBER_DIR, clean);
    // Final check: must still be inside the chamber after resolution
    if (!resolved.startsWith(CHAMBER_DIR)) return null;
    return resolved;
}

const tools = {
    registry: {},

    /**
     * Register a tool with a name, async handler, and description.
     * Description is injected into the entity's system prompt.
     */
    register(name, handler, description) {
        this.registry[name] = { handler, description };
    },

    /**
     * Scan an LLM response for a tool command.
     * Returns { command, args, fullMatch } or null.
     * FOCUS is excluded — it's handled client-side by the retina.
     */
    scan(response) {
        // Use [\s\S]*? to capture everything, including newlines, non-greedily
        const match = response.match(
            /\[(READ|WRITE|LIST|SEARCH|FETCH|EXECUTE|SPEAK):\s*([\s\S]*?)\]/i
        );
        if (!match) return null;
        
        let args = match[2].trim();
        
        // Strip wrapping quotes if the LLM wrapped the ENTIRE argument block in them,
        // but preserve internal quotes for things like the WRITE command.
        if (args.startsWith('"') && args.endsWith('"') && !args.includes('CONTENT:')) {
            args = args.substring(1, args.length - 1);
        }

        return { 
            command: match[1].toUpperCase(), 
            args: args, 
            fullMatch: match[0] 
        };
    },

    /**
     * Dispatch a command to its registered handler.
     * Returns the tool's output as a string.
     */
    dispatch: async function(command, args) {
        const tool = this.registry[command];
        if (!tool) return `[TOOL ERROR: Unknown command "${command}"]`;
        try {
            return await tool.handler(args);
        } catch (err) {
            return `[TOOL ERROR: ${err.message}]`;
        }
    },

    /**
     * Build the system prompt block for enabled tools.
     * Only enabled tools appear. The entity can't request what it doesn't know about.
     */
    getPromptBlock(enabledList) {
        if (!enabledList || enabledList.length === 0) return '';
        const lines = enabledList
            .filter(name => this.registry[name])
            .map(name => `[${name}: "..."] — ${this.registry[name].description}`);
        if (lines.length === 0) return '';
        return [
            '\n[AVAILABLE TOOLS]',
            'You can interact with your environment using these commands:',
            ...lines,
            'Output exactly one command per response when needed.',
            'Do not combine multiple commands. Wait for the result before continuing.',
            'The system will execute your command and return the result.',
            ''
        ].join('\n');
    },

    /**
     * Get the chamber directory path (for upload endpoint, etc.)
     */
    getChamberPath() {
        return CHAMBER_DIR;
    }
};

// =====================================================
// TOOL IMPLEMENTATIONS
// =====================================================

// --- READ: Read a file from the chamber ---
tools.register('READ', async (filename) => {
    const filepath = safePath(filename);
    if (!filepath) return '[ERROR: Invalid filename]';
    if (!fs.existsSync(filepath)) return `[ERROR: File "${filename}" not found in chamber]`;
    
    const stats = fs.statSync(filepath);
    if (stats.size > 1000000) return `[ERROR: File too large (${(stats.size / 1024).toFixed(0)}KB). Max 1MB for reading.]`;
    
    const content = fs.readFileSync(filepath, 'utf-8');
    // Cap at 2000 chars to protect context window
    return content.length > 2000 
        ? content.substring(0, 2000) + `\n[... truncated at 2000 chars. Full file: ${content.length} chars]`
        : content;
}, 'Read a file from your chamber');


// --- WRITE: Save a file to the chamber ---
tools.register('WRITE', async (args) => {
    // Expected format from LLM: filename CONTENT: text to write
    // The regex handles: "notes.txt" CONTENT: "some text here"
    // Also handles: notes.txt CONTENT: some text here
    const contentMatch = args.match(/^["']?(.+?)["']?\s+CONTENT:\s*["']?([\s\S]+?)["']?$/i);
    if (!contentMatch) {
        return '[ERROR: Format: [WRITE: "filename" CONTENT: "text to save"]]';
    }
    
    const filename = contentMatch[1].trim();
    const content = contentMatch[2].trim();
    const filepath = safePath(filename);
    if (!filepath) return '[ERROR: Invalid filename]';
    
    fs.writeFileSync(filepath, content, 'utf-8');
    return `[File "${filename}" saved to chamber (${content.length} chars)]`;
}, 'Save a file to your chamber. Format: [WRITE: "filename" CONTENT: "text"]');


// --- LIST: List chamber contents ---
tools.register('LIST', async (subfolder) => {
    const dirPath = subfolder ? safePath(subfolder) : CHAMBER_DIR;
    if (!dirPath) return '[ERROR: Invalid path]';
    if (!fs.existsSync(dirPath)) return '[Chamber is empty]';
    
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    if (entries.length === 0) return '[Chamber is empty]';
    
    const listing = entries.map(e => {
        try {
            const stats = fs.statSync(path.join(dirPath, e.name));
            const size = e.isDirectory() ? 'DIR' : formatSize(stats.size);
            const modified = stats.mtime.toISOString().split('T')[0];
            return `  ${e.name}  (${size}, modified ${modified})`;
        } catch {
            return `  ${e.name}`;
        }
    });
    return `Chamber contents:\n${listing.join('\n')}`;
}, 'List files in your chamber');

function formatSize(bytes) {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}


// --- SEARCH: Search file contents in the chamber ---
tools.register('SEARCH', async (query) => {
    if (!query || query.length < 2) return '[ERROR: Search query too short (min 2 chars)]';
    
    const results = [];
    let files;
    try {
        files = fs.readdirSync(CHAMBER_DIR).filter(f => {
            try {
                const stat = fs.statSync(path.join(CHAMBER_DIR, f));
                return stat.isFile() && stat.size < 1000000; // Skip files over 1MB
            } catch { return false; }
        });
    } catch {
        return '[ERROR: Could not read chamber directory]';
    }

    const queryLower = query.toLowerCase();
    for (const file of files) {
        try {
            const content = fs.readFileSync(path.join(CHAMBER_DIR, file), 'utf-8');
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].toLowerCase().includes(queryLower)) {
                    results.push(`${file}:${i + 1}: ${lines[i].substring(0, 120)}`);
                    if (results.length >= 10) break;
                }
            }
        } catch { /* skip binary/unreadable files */ }
        if (results.length >= 10) break;
    }

    return results.length > 0 
        ? `Search results for "${query}":\n${results.join('\n')}`
        : `[No results found for "${query}" in chamber]`;
}, 'Search file contents in your chamber');


// --- FETCH: Read a web page (text only) ---
tools.register('FETCH', async (url) => {
    // Validate URL
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return '[ERROR: URL must start with http:// or https://]';
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

    try {
        const response = await fetch(url, { 
            signal: controller.signal,
            headers: { 'User-Agent': 'MemoryRing/3.3' }
        });
        clearTimeout(timeout);

        if (!response.ok) {
            return `[FETCH ERROR: HTTP ${response.status} ${response.statusText}]`;
        }

        const html = await response.text();

        // Strip HTML to text — rough but functional
        const text = html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
            .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
            .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/\s+/g, ' ')
            .trim();

        // Cap at 3000 chars to protect context window
        return text.length > 3000
            ? text.substring(0, 3000) + `\n[... truncated at 3000 chars. Full page: ${text.length} chars]`
            : text || '[Page returned no readable text content]';
    } catch (err) {
        clearTimeout(timeout);
        if (err.name === 'AbortError') return '[FETCH ERROR: Request timed out (10 second limit)]';
        return `[FETCH ERROR: ${err.message}]`;
    }
}, 'Fetch and read a web page (text only, no JavaScript)');


// --- EXECUTE: Run Python code ---
tools.register('EXECUTE', async (code) => {
    // WARNING: This runs arbitrary Python on the host machine.
    // No Docker sandbox. 5-second timeout. Output capped.
    // The cwd is set to the chamber, so the entity can interact
    // with its own files via Python if needed.
    // Do not enable on public-facing deployments.
    return new Promise((resolve) => {
        execFile('python3', ['-c', code], {
            timeout: 5000,
            maxBuffer: 1024 * 100,
            cwd: CHAMBER_DIR
        }, (error, stdout, stderr) => {
            if (error) {
                if (error.killed) return resolve('[EXECUTION TIMEOUT: 5-second limit exceeded]');
                const errMsg = (stderr || error.message).substring(0, 500);
                return resolve(`[EXECUTION ERROR: ${errMsg}]`);
            }
            const output = (stdout || '').trim();
            if (!output) return resolve('[No output]');
            resolve(output.length > 2000
                ? output.substring(0, 2000) + '\n[... truncated at 2000 chars]'
                : output
            );
        });
    });
}, 'Run Python code (5-second timeout, runs in chamber directory)');


module.exports = tools;

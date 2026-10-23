/**
 * LocalFileManifest
 *
 * Remembers, for every file the launcher downloaded (or validated) from the
 * distribution, what the server declared for it at that time (url, MD5, size)
 * and what the file looked like on disk (hash, size, mtime).
 *
 * This lets the launcher answer two questions cheaply on the next launch:
 *   1. Has the server-side file changed since the client last got it?
 *   2. Has the local file changed since the client last got it?
 *
 * A file is only downloaded again when the answer to one of them is yes.
 */
const fs = require('fs-extra')
const path = require('path')
const { calculateHash } = require('helios-core/common')

const MANIFEST_VERSION = 1

/**
 * Build the "remote signature" of a distribution artifact, i.e. everything
 * the server tells us about the file. If any of it changes, the file changed
 * on the server.
 */
function remoteSignatureOf(artifact) {
    return {
        url: artifact.url ?? null,
        hash: typeof artifact.MD5 === 'string' && artifact.MD5.length > 0 ? artifact.MD5.toLowerCase() : null,
        size: Number.isFinite(artifact.size) ? artifact.size : null
    }
}

function sameRemote(a, b) {
    return a != null && b != null
        && a.url === b.url
        && a.hash === b.hash
        && a.size === b.size
}

class LocalFileManifest {

    constructor(file) {
        this.file = file
        this.entries = {}
        this.dirty = false
    }

    static key(filePath) {
        const resolved = path.resolve(filePath)
        // Windows and macOS (default) file systems are case-insensitive.
        return process.platform === 'linux' ? resolved : resolved.toLowerCase()
    }

    async load() {
        try {
            const data = await fs.readJson(this.file)
            if(data && data.version === MANIFEST_VERSION && data.entries && typeof data.entries === 'object') {
                this.entries = data.entries
            }
        } catch (_err) {
            // Missing or corrupted manifest: start from scratch. Files will be
            // checked against the distribution hashes like before.
            this.entries = {}
        }
    }

    get(filePath) {
        return this.entries[LocalFileManifest.key(filePath)] ?? null
    }

    async record(filePath, remote, localHash, algo) {
        const stats = await fs.stat(filePath)
        this.entries[LocalFileManifest.key(filePath)] = {
            remote,
            local: {
                algo,
                hash: localHash,
                size: stats.size,
                mtimeMs: stats.mtimeMs
            },
            updatedAt: Date.now()
        }
        this.dirty = true
    }

    forget(filePath) {
        const key = LocalFileManifest.key(filePath)
        if(key in this.entries) {
            delete this.entries[key]
            this.dirty = true
        }
    }

    /**
     * Is the local file exactly the one we recorded ?
     * Fast path: same size and same modification time -> no hashing needed.
     */
    async isLocalUnchanged(filePath, entry) {
        let stats
        try {
            stats = await fs.stat(filePath)
        } catch (_err) {
            return false
        }
        const local = entry.local
        if(local == null || stats.size !== local.size) {
            return false
        }
        if(stats.mtimeMs === local.mtimeMs) {
            return true
        }
        // Same size but touched (copy, antivirus, backup tool...): check the content.
        const hash = await calculateHash(filePath, local.algo)
        if(hash === local.hash) {
            local.mtimeMs = stats.mtimeMs
            this.dirty = true
            return true
        }
        return false
    }

    async save() {
        if(!this.dirty) {
            return
        }
        await fs.ensureDir(path.dirname(this.file))
        const tmp = `${this.file}.tmp`
        await fs.writeJson(tmp, { version: MANIFEST_VERSION, entries: this.entries })
        await fs.move(tmp, this.file, { overwrite: true })
        this.dirty = false
    }
}

module.exports = {
    LocalFileManifest,
    remoteSignatureOf,
    sameRemote
}

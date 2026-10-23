/**
 * SmartDistributionIndexProcessor
 *
 * Same job as helios-core's DistributionIndexProcessor (decide which files of
 * the distribution must be downloaded), but a file is only marked for download
 * when:
 *   - it is missing on disk, or
 *   - the server declares something different from what the client got last
 *     time (new url, new MD5 or new size), or
 *   - the local copy was damaged/modified (except for the types listed in
 *     PRESERVE_LOCAL_CHANGES_TYPES, see below).
 */
const { DistributionIndexProcessor, HashAlgo } = require('helios-core/dl')
const { calculateHash } = require('helios-core/common')
const { LoggerUtil } = require('helios-core')
const { Type } = require('helios-distribution-types')
const fs = require('fs-extra')

const { remoteSignatureOf, sameRemote } = require('./LocalFileManifest')

const logger = LoggerUtil.getLogger('SmartDistributionIndexProcessor')

/**
 * Module types for which a local modification made by the player is kept as
 * long as the file did not change on the server. Typically config files
 * (options.txt, mod configs...) that the game rewrites itself and that the
 * stock launcher would overwrite on every launch.
 *
 * Empty this array to always restore these files to the server version.
 */
const PRESERVE_LOCAL_CHANGES_TYPES = [Type.File]

class SmartDistributionIndexProcessor extends DistributionIndexProcessor {

    constructor(commonDir, distribution, serverId, manifest) {
        super(commonDir, distribution, serverId)
        this.manifest = manifest
        this.stats = { upToDate: 0, missing: 0, serverChanged: 0, localChanged: 0 }
    }

    async validate(onStageComplete) {
        const result = await super.validate(onStageComplete)
        const s = this.stats
        logger.info(`Distribution files: ${s.upToDate} up to date, ${s.missing} missing, ${s.serverChanged} changed on the server, ${s.localChanged} damaged/modified locally.`)
        return result
    }

    async validateModules(modules, accumulator) {
        for (const module of modules) {
            const artifact = module.rawModule.artifact
            const filePath = module.getPath()
            const remote = remoteSignatureOf(artifact)
            const preserveLocal = PRESERVE_LOCAL_CHANGES_TYPES.includes(module.rawModule.type)

            if(!await this.isUpToDate(module.rawModule.id, filePath, remote, preserveLocal)) {
                accumulator.push({
                    id: module.rawModule.id,
                    hash: remote.hash,
                    algo: HashAlgo.MD5,
                    size: artifact.size,
                    url: artifact.url,
                    path: filePath,
                    // Extra data used by SmartRepairReceiver after the download.
                    remote,
                    fromDistribution: true
                })
            }

            if(module.hasSubModules()) {
                await this.validateModules(module.subModules, accumulator)
            }
        }
    }

    async isUpToDate(id, filePath, remote, preserveLocal) {
        if(!await fs.pathExists(filePath)) {
            this.stats.missing++
            logger.debug(`[missing] ${id}`)
            return false
        }

        const entry = this.manifest.get(filePath)

        // 1. The server declares exactly what we already downloaded.
        if(entry != null && sameRemote(entry.remote, remote)) {
            if(preserveLocal || await this.manifest.isLocalUnchanged(filePath, entry)) {
                this.stats.upToDate++
                return true
            }
            this.stats.localChanged++
            logger.debug(`[local change] ${id}`)
            return false
        }

        // 2. No MD5 provided by the server: we can only rely on url/size.
        if(remote.hash == null) {
            if(entry == null) {
                // Never seen before (first launch with this launcher version):
                // keep the existing file, like the stock launcher does.
                await this.manifest.record(filePath, remote, await calculateHash(filePath, HashAlgo.MD5), HashAlgo.MD5)
                this.stats.upToDate++
                return true
            }
            this.stats.serverChanged++
            logger.debug(`[server change] ${id}`)
            return false
        }

        // 3. Unknown file or server declaration changed: compare the content.
        const localHash = await calculateHash(filePath, HashAlgo.MD5)
        if(localHash === remote.hash) {
            await this.manifest.record(filePath, remote, localHash, HashAlgo.MD5)
            this.stats.upToDate++
            return true
        }

        if(entry != null) {
            this.stats.serverChanged++
            logger.debug(`[server change] ${id}`)
        } else {
            this.stats.localChanged++
            logger.debug(`[hash mismatch] ${id}`)
        }
        return false
    }
}

module.exports = {
    SmartDistributionIndexProcessor,
    PRESERVE_LOCAL_CHANGES_TYPES
}

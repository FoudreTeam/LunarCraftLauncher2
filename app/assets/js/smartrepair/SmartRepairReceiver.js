/**
 * SmartRepairReceiver
 *
 * Replacement for helios-core's FullRepairReceiver (runs in the child process).
 * Differences:
 *   - uses the local manifest to only download what changed,
 *   - downloads into a temporary file and only replaces the real file once the
 *     download is complete (an interrupted download never leaves a broken file),
 *   - records every downloaded file in the manifest.
 */
const fs = require('fs-extra')
const path = require('path')
const { RequestError, HTTPError, TimeoutError, ParseError, ReadError } = require('got')
const { DistributionAPI, calculateHash } = require('helios-core/common')
const { downloadQueue, getExpectedDownloadSize } = require('helios-core/dl')
const { LoggerUtil } = require('helios-core')

const { LocalFileManifest } = require('./LocalFileManifest')
const { SmartDistributionIndexProcessor } = require('./SmartDistributionIndexProcessor')
const { SmartMojangIndexProcessor } = require('./SmartMojangIndexProcessor')

const log = LoggerUtil.getLogger('SmartRepairReceiver')

const MANIFEST_FILE_NAME = 'downloaded-files.json'
const TMP_SUFFIX = '.lcdownload'

class SmartRepairReceiver {

    processors = []
    assets = []
    manifest = null

    async execute(message) {
        switch (message.action) {
            case 'validate':
                await this.validate(message)
                break
            case 'download':
                await this.download(message)
                break
        }
    }

    async parseError(error) {
        if(error instanceof RequestError) {
            if(error?.request?.requestUrl) {
                log.debug(`Error during request to ${error.request.requestUrl}`)
            }
            if(error instanceof HTTPError) {
                return `Error during request (HTTP Response ${error.response.statusCode})`
            } else if(error.name === 'RequestError') {
                return `Request received no response (${error.code}).`
            } else if(error instanceof TimeoutError) {
                return `Request timed out (${error.timings.phases.total}ms).`
            } else if(error instanceof ParseError) {
                return 'Request received unexepected body (Parse Error).'
            } else if(error instanceof ReadError) {
                return `Read Error (${error.code}): ${error.message}.`
            }
            return 'Error during request.'
        }
        return undefined
    }

    async validate(message) {
        const api = new DistributionAPI(
            message.launcherDirectory,
            message.commonDirectory,
            message.instanceDirectory,
            null, // The main process must refresh, this is a local pull only.
            message.devMode
        )
        const distribution = await api.getDistributionLocalLoadOnly()
        const server = distribution.getServerById(message.serverId)

        this.manifest = new LocalFileManifest(path.join(message.launcherDirectory, MANIFEST_FILE_NAME))
        await this.manifest.load()

        this.processors = [
            new SmartMojangIndexProcessor(message.commonDirectory, server.rawServer.minecraftVersion),
            new SmartDistributionIndexProcessor(message.commonDirectory, distribution, message.serverId, this.manifest)
        ]

        let numStages = 0
        for (const processor of this.processors) {
            await processor.init()
            numStages += processor.totalStages()
        }

        const assets = []
        let completedStages = 0
        for (const processor of this.processors) {
            Object.values(await processor.validate(async () => {
                completedStages++
                process.send({ response: 'validateProgress', percent: Math.trunc((completedStages / numStages) * 100) })
            }))
                .flatMap(asset => asset)
                .forEach(asset => assets.push(asset))
        }

        // The same file can be listed twice (e.g. two Mojang assets sharing a hash).
        const seen = new Set()
        this.assets = assets.filter(asset => {
            const key = LocalFileManifest.key(asset.path)
            if(seen.has(key)) {
                return false
            }
            seen.add(key)
            return true
        })

        await this.manifest.save()
        process.send({ response: 'validateComplete', invalidCount: this.assets.length })
    }

    async download(_message) {
        const staged = this.assets.map(asset => ({ ...asset, finalPath: asset.path, path: asset.path + TMP_SUFFIX }))

        const expectedTotalSize = getExpectedDownloadSize(staged.map(a => ({ size: Number.isFinite(a.size) ? a.size : 0 })))
        log.info(`${staged.length} file(s) to download (${expectedTotalSize} bytes).`)
        staged.forEach(({ id }) => log.debug(`Asset Requires Download: ${id}`))

        let currentPercent = 0
        try {
            await downloadQueue(staged, received => {
                const nextPercent = expectedTotalSize > 0 ? Math.min(100, Math.trunc((received / expectedTotalSize) * 100)) : 0
                if(currentPercent !== nextPercent) {
                    currentPercent = nextPercent
                    process.send({ response: 'downloadProgress', percent: currentPercent })
                }
            })
        } catch (err) {
            // Do not leave half-downloaded temp files behind.
            await Promise.all(staged.map(a => fs.remove(a.path).catch(() => {})))
            throw err
        }

        for (const asset of staged) {
            await this.finalize(asset)
        }
        await this.manifest.save()

        for (const processor of this.processors) {
            await processor.postDownload()
        }

        process.send({ response: 'downloadComplete' })
    }

    /**
     * Move a downloaded temp file to its real location and record it.
     */
    async finalize(asset) {
        const { size: actualSize } = await fs.stat(asset.path)
        const sizeOk = !Number.isFinite(asset.size) || asset.size === actualSize
        const expected = typeof asset.hash === 'string' ? asset.hash.toLowerCase() : null
        const actualHash = asset.algo ? await calculateHash(asset.path, asset.algo) : null
        const hashOk = expected == null || expected === actualHash

        if(!sizeOk) {
            log.warn(`${asset.id}: expected ${asset.size} bytes but received ${actualSize}.`)
        }
        if(!hashOk) {
            if(sizeOk && asset.fromDistribution) {
                // Complete download but the MD5 written in the distribution is
                // wrong. The file is kept and remembered, so it will NOT be
                // downloaded again on every launch. Fix the distribution!
                log.warn(`${asset.id}: the MD5 declared in the distribution (${expected}) does not match the file served (${actualHash}). Update the distribution.`)
            } else {
                log.error(`${asset.id}: hashes do not match, the file may be corrupted. It will be checked again next launch.`)
            }
        }

        await fs.move(asset.path, asset.finalPath, { overwrite: true })

        if(asset.fromDistribution) {
            if(sizeOk) {
                await this.manifest.record(asset.finalPath, asset.remote, actualHash, asset.algo)
            } else {
                this.manifest.forget(asset.finalPath)
            }
        }
    }
}

module.exports = { SmartRepairReceiver }

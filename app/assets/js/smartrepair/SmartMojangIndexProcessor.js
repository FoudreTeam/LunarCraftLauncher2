/**
 * SmartMojangIndexProcessor
 *
 * helios-core already skips Mojang files (assets, libraries, client jar) whose
 * SHA1 matches. The only weak spot is the version JSON / asset index: the
 * stock code saves JSON.stringify(parsedBody) instead of the bytes Mojang sent,
 * so the SHA1 check can fail on the next launch and the file gets fetched
 * again. Here the raw bytes are saved, so the hash check stays meaningful.
 */
const got = require('got')
const fs = require('fs-extra')
const path = require('path')
const { MojangIndexProcessor } = require('helios-core/dl')
const { calculateHashByBuffer, handleGotError } = require('helios-core/common')

class SmartMojangIndexProcessor extends MojangIndexProcessor {

    async loadContentWithRemoteFallback(url, filePath, hash) {
        try {
            if(await fs.pathExists(filePath)) {
                const buf = await fs.readFile(filePath)
                if(!hash || calculateHashByBuffer(buf, hash.algo) === hash.value) {
                    return JSON.parse(buf.toString())
                }
            }
        } catch (error) {
            throw new Error(`Failure while loading ${filePath}.`, { cause: error })
        }

        try {
            const res = await got.get(url, { responseType: 'buffer' })
            const body = JSON.parse(res.body.toString())
            if(hash && calculateHashByBuffer(res.body, hash.algo) !== hash.value) {
                MojangIndexProcessor.logger.warn(`Hash mismatch for ${url}, it will be checked again next launch.`)
            }
            await fs.ensureDir(path.dirname(filePath))
            await fs.writeFile(filePath, res.body)
            return body
        } catch (error) {
            return handleGotError(url, error, MojangIndexProcessor.logger, () => null).data
        }
    }
}

module.exports = { SmartMojangIndexProcessor }

/**
 * SmartRepair
 *
 * Drop-in replacement for helios-core's FullRepair (same API: spawnReceiver,
 * verifyFiles, download, destroyReceiver, childProcess). Only the child
 * process it starts is different.
 */
const { fork } = require('child_process')
const path = require('path')
const { FullRepair } = require('helios-core/dl')

/**
 * Thrown by verifyFiles / download when the player cancels the launch.
 */
class LaunchCancelledError extends Error {
    constructor() {
        super('Launch cancelled by the user.')
        this.name = 'LaunchCancelledError'
    }
}

class SmartRepair extends FullRepair {

    cancelled = false
    rejectPending = null

    verifyFiles(onProgress) {
        return this.cancellable(() => super.verifyFiles(onProgress))
    }

    download(onProgress) {
        return this.cancellable(() => super.download(onProgress))
    }

    cancellable(start) {
        if(this.cancelled) {
            return Promise.reject(new LaunchCancelledError())
        }
        return new Promise((resolve, reject) => {
            this.rejectPending = reject
            start().then(resolve, reject).finally(() => {
                this.rejectPending = null
            })
        })
    }

    /**
     * Stop the check/download right away. Files are downloaded to temporary
     * files first, so stopping never leaves a broken mod in place.
     */
    cancel() {
        if(this.cancelled) {
            return
        }
        this.cancelled = true
        const receiver = this.receiver
        this.receiver = null
        if(receiver != null) {
            receiver.removeAllListeners('message')
            try {
                receiver.kill()
            } catch (_err) {
                // Already stopped.
            }
        }
        if(this.rejectPending != null) {
            this.rejectPending(new LaunchCancelledError())
        }
    }

    destroyReceiver() {
        if(this.receiver != null) {
            super.destroyReceiver()
        }
    }

    spawnReceiver(additionalEnvVars) {
        if(this.receiver != null) {
            throw new Error('Receiver already spawned!')
        }
        const forkOptions = { stdio: 'pipe' }
        if(additionalEnvVars) {
            forkOptions.env = { ...JSON.parse(JSON.stringify(process.env)), ...additionalEnvVars }
        }

        this.receiver = fork(path.join(__dirname, 'SmartRepairExecutor.js'), ['SmartRepairReceiver'], forkOptions)

        this.receiver.stdio[1].setEncoding('utf8')
        this.receiver.stdio[1].on('data', (data) => {
            `${data}`.trim().split('\n').forEach(line => console.log(`\x1b[32m[_]\x1b[0m ${line}`))
        })
        this.receiver.stdio[2].setEncoding('utf8')
        this.receiver.stdio[2].on('data', (data) => {
            `${data}`.trim().split('\n').forEach(line => console.log(`\x1b[31m[_]\x1b[0m ${line}`))
        })
    }
}

module.exports = { SmartRepair, LaunchCancelledError }

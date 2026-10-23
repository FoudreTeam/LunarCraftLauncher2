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

class SmartRepair extends FullRepair {

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

module.exports = { SmartRepair }

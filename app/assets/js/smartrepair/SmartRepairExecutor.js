/**
 * Entry point of the child process forked by SmartRepair.
 * Same behavior as helios-core's ReceiverExecutor, with our receiver.
 */
const { writeSync, fsyncSync } = require('fs')
const { LoggerUtil } = require('helios-core')
const { SmartRepairReceiver } = require('./SmartRepairReceiver')

const log = LoggerUtil.getLogger('SmartRepairExecutor')
log.info('Receiver process started.')

const receiver = new SmartRepairReceiver()

process.on('message', async (message) => {
    try {
        await receiver.execute(message)
    } catch (err) {
        log.error('Error During Receiver Operation')
        log.error(err)
        let displayable = undefined
        try {
            displayable = await receiver.parseError(err)
            if(displayable) {
                log.error(`Receiver replied with ${displayable}`)
            }
        } catch (parseErr) {
            log.error('The receiver\'s error parser threw also.', parseErr)
        }
        try {
            writeSync(process.stdout.fd, 'Error now being propagated back to the transmitter.\n')
            fsyncSync(process.stdout.fd)
        } catch (_err) {
            // fsync is not supported on pipes on some platforms, ignore.
        }
        process.send({ response: 'error', displayable })
        process.exit(1)
    }
})

process.on('unhandledRejection', r => console.log(r))
process.on('disconnect', () => {
    log.info('Disconnect signal received, shutting down.')
    process.exit(0)
})

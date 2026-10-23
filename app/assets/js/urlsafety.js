/**
 * URL helpers shared by the main process and the renderer.
 *
 * Only these protocols may ever be handed to the operating system
 * (shell.openExternal). Anything else (file:, smb:, ms-*, custom protocol
 * handlers...) can be abused to run programs on the player's computer.
 */
const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

function parseURL(url) {
    try {
        return new URL(String(url))
    } catch (_err) {
        return null
    }
}

function isSafeExternalURL(url) {
    const parsed = parseURL(url)
    return parsed != null && EXTERNAL_PROTOCOLS.has(parsed.protocol)
}

/**
 * shell.openExternal, restricted to safe protocols.
 * @returns {Promise<boolean>} true if the URL was opened.
 */
async function openExternalSafe(shell, url) {
    if(!isSafeExternalURL(url)) {
        console.warn(`Blocked opening of unsafe external URL: ${url}`)
        return false
    }
    await shell.openExternal(url)
    return true
}

module.exports = {
    isSafeExternalURL,
    openExternalSafe
}

/**
 * AuthManager
 * 
 * This module aims to abstract login procedures. Results from Mojang's REST api
 * are retrieved through our Mojang module. These results are processed and stored,
 * if applicable, in the config using the ConfigManager. All login procedures should
 * be made through this module.
 * 
 * @module authmanager
 */
// Requirements
const ConfigManager          = require('./configmanager')
const { LoggerUtil }         = require('helios-core')
const { RestResponseStatus } = require('helios-core/common')
const { MojangRestAPI, MojangErrorCode } = require('helios-core/mojang')
const { MicrosoftAuth, MicrosoftErrorCode } = require('helios-core/microsoft')
const { HTTPError }          = require('got')
const { AZURE_CLIENT_ID }    = require('./ipcconstants')
const Lang = require('./langloader')

const log = LoggerUtil.getLogger('AuthManager')

// Error messages

function microsoftErrorDisplayable(errorCode) {
    switch (errorCode) {
        case MicrosoftErrorCode.NO_PROFILE:
            return {
                title: Lang.queryJS('auth.microsoft.error.noProfileTitle'),
                desc: Lang.queryJS('auth.microsoft.error.noProfileDesc')
            }
        case MicrosoftErrorCode.NO_XBOX_ACCOUNT:
            return {
                title: Lang.queryJS('auth.microsoft.error.noXboxAccountTitle'),
                desc: Lang.queryJS('auth.microsoft.error.noXboxAccountDesc')
            }
        case MicrosoftErrorCode.XBL_BANNED:
            return {
                title: Lang.queryJS('auth.microsoft.error.xblBannedTitle'),
                desc: Lang.queryJS('auth.microsoft.error.xblBannedDesc')
            }
        case MicrosoftErrorCode.UNDER_18:
            return {
                title: Lang.queryJS('auth.microsoft.error.under18Title'),
                desc: Lang.queryJS('auth.microsoft.error.under18Desc')
            }
        case MicrosoftErrorCode.UNKNOWN:
            return {
                title: Lang.queryJS('auth.microsoft.error.unknownTitle'),
                desc: Lang.queryJS('auth.microsoft.error.unknownDesc')
            }
    }
}

function mojangErrorDisplayable(errorCode) {
    switch(errorCode) {
        case MojangErrorCode.ERROR_METHOD_NOT_ALLOWED:
            return {
                title: Lang.queryJS('auth.mojang.error.methodNotAllowedTitle'),
                desc: Lang.queryJS('auth.mojang.error.methodNotAllowedDesc')
            }
        case MojangErrorCode.ERROR_NOT_FOUND:
            return {
                title: Lang.queryJS('auth.mojang.error.notFoundTitle'),
                desc: Lang.queryJS('auth.mojang.error.notFoundDesc')
            }
        case MojangErrorCode.ERROR_USER_MIGRATED:
            return {
                title: Lang.queryJS('auth.mojang.error.accountMigratedTitle'),
                desc: Lang.queryJS('auth.mojang.error.accountMigratedDesc')
            }
        case MojangErrorCode.ERROR_INVALID_CREDENTIALS:
            return {
                title: Lang.queryJS('auth.mojang.error.invalidCredentialsTitle'),
                desc: Lang.queryJS('auth.mojang.error.invalidCredentialsDesc')
            }
        case MojangErrorCode.ERROR_RATELIMIT:
            return {
                title: Lang.queryJS('auth.mojang.error.tooManyAttemptsTitle'),
                desc: Lang.queryJS('auth.mojang.error.tooManyAttemptsDesc')
            }
        case MojangErrorCode.ERROR_INVALID_TOKEN:
            return {
                title: Lang.queryJS('auth.mojang.error.invalidTokenTitle'),
                desc: Lang.queryJS('auth.mojang.error.invalidTokenDesc')
            }
        case MojangErrorCode.ERROR_ACCESS_TOKEN_HAS_PROFILE:
            return {
                title: Lang.queryJS('auth.mojang.error.tokenHasProfileTitle'),
                desc: Lang.queryJS('auth.mojang.error.tokenHasProfileDesc')
            }
        case MojangErrorCode.ERROR_CREDENTIALS_MISSING:
            return {
                title: Lang.queryJS('auth.mojang.error.credentialsMissingTitle'),
                desc: Lang.queryJS('auth.mojang.error.credentialsMissingDesc')
            }
        case MojangErrorCode.ERROR_INVALID_SALT_VERSION:
            return {
                title: Lang.queryJS('auth.mojang.error.invalidSaltVersionTitle'),
                desc: Lang.queryJS('auth.mojang.error.invalidSaltVersionDesc')
            }
        case MojangErrorCode.ERROR_UNSUPPORTED_MEDIA_TYPE:
            return {
                title: Lang.queryJS('auth.mojang.error.unsupportedMediaTypeTitle'),
                desc: Lang.queryJS('auth.mojang.error.unsupportedMediaTypeDesc')
            }
        case MojangErrorCode.ERROR_GONE:
            return {
                title: Lang.queryJS('auth.mojang.error.accountGoneTitle'),
                desc: Lang.queryJS('auth.mojang.error.accountGoneDesc')
            }
        case MojangErrorCode.ERROR_UNREACHABLE:
            return {
                title: Lang.queryJS('auth.mojang.error.unreachableTitle'),
                desc: Lang.queryJS('auth.mojang.error.unreachableDesc')
            }
        case MojangErrorCode.ERROR_NOT_PAID:
            return {
                title: Lang.queryJS('auth.mojang.error.gameNotPurchasedTitle'),
                desc: Lang.queryJS('auth.mojang.error.gameNotPurchasedDesc')
            }
        case MojangErrorCode.UNKNOWN:
            return {
                title: Lang.queryJS('auth.mojang.error.unknownErrorTitle'),
                desc: Lang.queryJS('auth.mojang.error.unknownErrorDesc')
            }
        default:
            throw new Error(`Unknown error code: ${errorCode}`)
    }
}

// Functions

/**
 * Add a Mojang account. This will authenticate the given credentials with Mojang's
 * authserver. The resultant data will be stored as an auth account in the
 * configuration database.
 * 
 * @param {string} username The account username (email if migrated).
 * @param {string} password The account password.
 * @returns {Promise.<Object>} Promise which resolves the resolved authenticated account object.
 */
exports.addMojangAccount = async function(username, password) {
    try {
        const response = await MojangRestAPI.authenticate(username, password, ConfigManager.getClientToken())
        console.log(response)
        if(response.responseStatus === RestResponseStatus.SUCCESS) {

            const session = response.data
            if(session.selectedProfile != null){
                const ret = ConfigManager.addMojangAuthAccount(session.selectedProfile.id, session.accessToken, username, session.selectedProfile.name)
                if(ConfigManager.getClientToken() == null){
                    ConfigManager.setClientToken(session.clientToken)
                }
                ConfigManager.save()
                return ret
            } else {
                return Promise.reject(mojangErrorDisplayable(MojangErrorCode.ERROR_NOT_PAID))
            }

        } else {
            return Promise.reject(mojangErrorDisplayable(response.mojangErrorCode))
        }
        
    } catch (err){
        log.error(err)
        return Promise.reject(mojangErrorDisplayable(MojangErrorCode.UNKNOWN))
    }
}

const AUTH_MODE = { FULL: 0, MS_REFRESH: 1, MC_REFRESH: 2 }

/**
 * Perform the full MS Auth flow in a given mode.
 * 
 * AUTH_MODE.FULL = Full authorization for a new account.
 * AUTH_MODE.MS_REFRESH = Full refresh authorization.
 * AUTH_MODE.MC_REFRESH = Refresh of the MC token, reusing the MS token.
 * 
 * @param {string} entryCode FULL-AuthCode. MS_REFRESH=refreshToken, MC_REFRESH=accessToken
 * @param {*} authMode The auth mode.
 * @returns An object with all auth data. AccessToken object will be null when mode is MC_REFRESH.
 */
async function fullMicrosoftAuthFlow(entryCode, authMode, onStep = () => {}) {
    try {

        let accessTokenRaw
        let accessToken
        if(authMode !== AUTH_MODE.MC_REFRESH) {
            accessToken = await authStep('msToken', onStep,
                () => MicrosoftAuth.getAccessToken(entryCode, authMode === AUTH_MODE.MS_REFRESH, AZURE_CLIENT_ID))
            accessTokenRaw = accessToken.access_token
        } else {
            accessTokenRaw = entryCode
        }

        const xbl = await authStep('xbl', onStep, () => MicrosoftAuth.getXBLToken(accessTokenRaw))
        const xsts = await authStep('xsts', onStep, () => MicrosoftAuth.getXSTSToken(xbl))
        const mcToken = await authStep('mcToken', onStep, () => MicrosoftAuth.getMCAccessToken(xsts))
        const mcProfile = await authStep('mcProfile', onStep, () => MicrosoftAuth.getMCProfile(mcToken.access_token))

        return {
            accessToken,
            accessTokenRaw,
            xbl,
            xsts,
            mcToken,
            mcProfile
        }
    } catch(err) {
        if(isDisplayableError(err)) {
            return Promise.reject(err)
        }
        log.error(err)
        return Promise.reject(microsoftErrorDisplayable(MicrosoftErrorCode.UNKNOWN))
    }
}

/* Steps, retries and network errors */

/** Order of the steps of a Microsoft login, as reported to onStep. */
exports.AUTH_STEPS = ['msToken', 'xbl', 'xsts', 'mcToken', 'mcProfile']

/** Readable name of the service behind each step (used in error messages). */
const STEP_SERVICE = {
    msToken: 'Microsoft',
    xbl: 'Xbox Live',
    xsts: 'Xbox Live',
    mcToken: 'Minecraft',
    mcProfile: 'Minecraft'
}

const MAX_ATTEMPTS = 3
const RETRY_DELAYS_MS = [1500, 4000]

function isDisplayableError(err) {
    return err != null && typeof err === 'object' && 'title' in err && 'desc' in err
}

/**
 * A request that failed because the service could not be reached or is
 * temporarily down. Retrying (or waiting) may help. Anything else (e.g. an
 * expired or revoked token) is an actual authentication failure.
 */
function isNetworkFailure(error) {
    if(error == null) {
        return false
    }
    if(error instanceof HTTPError) {
        const code = error.response?.statusCode
        return code === 408 || code === 429 || code >= 500
    }
    // RequestError (ETIMEDOUT, ECONNRESET, ENOTFOUND...), TimeoutError, ReadError...
    return true
}

function networkErrorDisplayable(step) {
    const service = STEP_SERVICE[step] ?? 'Microsoft'
    return {
        title: Lang.queryJS('auth.network.title', { service }),
        desc: Lang.queryJS('auth.network.desc', { service })
    }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Run one step of the login, retrying when the service cannot be reached.
 * Rejects with a displayable error carrying `step` and `network`.
 */
async function authStep(step, onStep, request) {
    for(let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        onStep({ step, state: 'active', attempt, maxAttempts: MAX_ATTEMPTS })
        const response = await request()
        if(response.responseStatus !== RestResponseStatus.ERROR) {
            onStep({ step, state: 'done' })
            return response.data
        }
        const network = isNetworkFailure(response.error)
        if(network && attempt < MAX_ATTEMPTS) {
            log.warn(`Step ${step} failed (attempt ${attempt}/${MAX_ATTEMPTS}), retrying.`)
            onStep({ step, state: 'retry', attempt, maxAttempts: MAX_ATTEMPTS })
            await sleep(RETRY_DELAYS_MS[attempt - 1])
            continue
        }
        const displayable = network
            ? networkErrorDisplayable(step)
            : microsoftErrorDisplayable(response.microsoftErrorCode)
        onStep({ step, state: 'failed', network })
        return Promise.reject({ ...displayable, step, network })
    }
}

/**
 * Calculate the expiry date. Advance the expiry time by 10 seconds
 * to reduce the liklihood of working with an expired token.
 * 
 * @param {number} nowMs Current time milliseconds.
 * @param {number} epiresInS Expires in (seconds)
 * @returns 
 */
function calculateExpiryDate(nowMs, epiresInS) {
    return nowMs + ((epiresInS-10)*1000)
}

/**
 * Add a Microsoft account. This will pass the provided auth code to Mojang's OAuth2.0 flow.
 * The resultant data will be stored as an auth account in the configuration database.
 * 
 * @param {string} authCode The authCode obtained from microsoft.
 * @returns {Promise.<Object>} Promise which resolves the resolved authenticated account object.
 */
exports.addMicrosoftAccount = async function(authCode, onStep) {

    const fullAuth = await fullMicrosoftAuthFlow(authCode, AUTH_MODE.FULL, onStep)

    // Advance expiry by 10 seconds to avoid close calls.
    const now = new Date().getTime()

    const ret = ConfigManager.addMicrosoftAuthAccount(
        fullAuth.mcProfile.id,
        fullAuth.mcToken.access_token,
        fullAuth.mcProfile.name,
        calculateExpiryDate(now, fullAuth.mcToken.expires_in),
        fullAuth.accessToken.access_token,
        fullAuth.accessToken.refresh_token,
        calculateExpiryDate(now, fullAuth.accessToken.expires_in)
    )
    ConfigManager.save()

    return ret
}

/**
 * Remove a Mojang account. This will invalidate the access token associated
 * with the account and then remove it from the database.
 * 
 * @param {string} uuid The UUID of the account to be removed.
 * @returns {Promise.<void>} Promise which resolves to void when the action is complete.
 */
exports.removeMojangAccount = async function(uuid){
    try {
        const authAcc = ConfigManager.getAuthAccount(uuid)
        const response = await MojangRestAPI.invalidate(authAcc.accessToken, ConfigManager.getClientToken())
        if(response.responseStatus === RestResponseStatus.SUCCESS) {
            ConfigManager.removeAuthAccount(uuid)
            ConfigManager.save()
            return Promise.resolve()
        } else {
            log.error('Error while removing account', response.error)
            return Promise.reject(response.error)
        }
    } catch (err){
        log.error('Error while removing account', err)
        return Promise.reject(err)
    }
}

/**
 * Remove a Microsoft account. It is expected that the caller will invoke the OAuth logout
 * through the ipc renderer.
 * 
 * @param {string} uuid The UUID of the account to be removed.
 * @returns {Promise.<void>} Promise which resolves to void when the action is complete.
 */
exports.removeMicrosoftAccount = async function(uuid){
    try {
        ConfigManager.removeAuthAccount(uuid)
        ConfigManager.save()
        return Promise.resolve()
    } catch (err){
        log.error('Error while removing account', err)
        return Promise.reject(err)
    }
}

/**
 * Validate the selected account with Microsoft's authserver. If the account is not valid,
 * we will attempt to refresh the access token and update that value. If that fails, a
 * new login will be required.
 * 
 * @returns {Promise.<boolean>} Promise which resolves to true if the access token is valid,
 * otherwise false.
 */
/**
 * Refresh a little before the real expiry, so the token is still valid when
 * the game joins the server (file checks and downloads take some time).
 */
const REFRESH_MARGIN_MS = 5 * 60 * 1000

/**
 * @returns {Promise<{status: 'ok'|'refreshed'|'invalid'|'network', error?: Object}>}
 */
async function validateSelectedMicrosoftAccount(onStep){
    const current = ConfigManager.getSelectedAccount()
    const now = new Date().getTime()

    if(now + REFRESH_MARGIN_MS < current.expiresAt) {
        return { status: 'ok' }
    }

    const saveRefresh = (res, msToken) => {
        ConfigManager.updateMicrosoftAuthAccount(
            current.uuid,
            res.mcToken.access_token,
            msToken.access_token,
            msToken.refresh_token,
            msToken.expires_at,
            calculateExpiryDate(now, res.mcToken.expires_in)
        )
        ConfigManager.save()
    }

    const fullRefresh = async () => {
        const res = await fullMicrosoftAuthFlow(current.microsoft.refresh_token, AUTH_MODE.MS_REFRESH, onStep)
        saveRefresh(res, {
            access_token: res.accessToken.access_token,
            // Microsoft may or may not rotate the refresh token.
            refresh_token: res.accessToken.refresh_token ?? current.microsoft.refresh_token,
            expires_at: calculateExpiryDate(now, res.accessToken.expires_in)
        })
    }

    try {
        if(now + REFRESH_MARGIN_MS >= current.microsoft.expires_at) {
            // Microsoft token expired too: full refresh.
            await fullRefresh()
        } else {
            // Only the Minecraft token expired: reuse the Microsoft token.
            try {
                const res = await fullMicrosoftAuthFlow(current.microsoft.access_token, AUTH_MODE.MC_REFRESH, onStep)
                saveRefresh(res, current.microsoft)
            } catch(err) {
                if(err?.network) {
                    throw err
                }
                // The Microsoft token was refused (revoked...): try a full refresh.
                log.warn('Minecraft token refresh refused, trying a full Microsoft refresh.')
                await fullRefresh()
            }
        }
        log.info(`Session of ${current.displayName} renewed.`)
        return { status: 'refreshed' }
    } catch(err) {
        if(err?.network) {
            log.warn(`Could not reach ${STEP_SERVICE[err.step] ?? 'Microsoft'} to renew the session of ${current.displayName}.`)
            return { status: 'network', error: err }
        }
        log.error(`The session of ${current.displayName} is no longer valid.`, err)
        return { status: 'invalid', error: err }
    }
}

/**
 * Validate the selected auth account.
 * 
 * @returns {Promise.<boolean>} Promise which resolves to true if the access token is valid,
 * otherwise false.
 */
exports.validateSelected = async function(onStep){
    const current = ConfigManager.getSelectedAccount()

    if(current == null) {
        return { status: 'invalid' }
    }
    if(current.type === 'microsoft') {
        return await validateSelectedMicrosoftAccount(onStep)
    }
    // Mojang accounts no longer exist (they are removed at startup).
    return { status: 'invalid' }
}

/**
 * HTML helpers for the renderer.
 *
 * The launcher window runs with Node.js integration, so any HTML coming from
 * the network (news feed, distribution, release notes...) must never reach
 * innerHTML unfiltered: a single injected element could lead to code
 * execution on the player's computer.
 */
/* global window */
const createDOMPurify = require('dompurify')

const DOMPurify = createDOMPurify(window)

const SANITIZE_CONFIG = {
    USE_PROFILES: { html: true },
    // Nothing that can submit, embed, navigate or restyle the whole app.
    FORBID_TAGS: [
        'style', 'link', 'meta', 'base', 'form', 'input', 'button', 'textarea', 'select',
        'option', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'portal',
        'audio', 'video', 'source', 'track', 'template', 'dialog', 'svg', 'math'
    ],
    FORBID_ATTR: ['id', 'name', 'formaction', 'srcset', 'ping', 'target'],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#)/i,
    ALLOW_DATA_ATTR: false
}

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if(node.tagName === 'A') {
        node.setAttribute('rel', 'noopener noreferrer')
    }
})

/**
 * Keep harmless formatting (paragraphs, bold, links, images...) and remove
 * everything else.
 */
function sanitizeHTML(html) {
    return DOMPurify.sanitize(html == null ? '' : String(html), SANITIZE_CONFIG)
}

/**
 * Escape text so it is displayed as-is, never interpreted as HTML.
 * Safe both between tags and inside double-quoted attributes.
 */
function escapeHTML(text) {
    return String(text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

/**
 * Return the URL if it is http(s), otherwise a harmless fallback.
 */
function safeLinkURL(url, fallback = '#') {
    try {
        const { protocol } = new URL(String(url))
        return protocol === 'http:' || protocol === 'https:' ? String(url) : fallback
    } catch (_err) {
        return fallback
    }
}

/**
 * For <img src>: http(s), local files (bundled icons) and inline images only.
 */
function safeImageURL(url, fallback = '') {
    const value = String(url ?? '')
    if(/^data:image\/(png|gif|jpe?g|webp);/i.test(value)) {
        return value
    }
    try {
        const { protocol } = new URL(value, window.location.href)
        return ['http:', 'https:', 'file:'].includes(protocol) ? value : fallback
    } catch (_err) {
        return fallback
    }
}

module.exports = {
    sanitizeHTML,
    escapeHTML,
    safeLinkURL,
    safeImageURL
}

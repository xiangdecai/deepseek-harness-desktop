'use strict'

const path = require('node:path')
const { fileURLToPath } = require('node:url')

function parseUrl(value) {
  try {
    return new URL(value)
  } catch {
    return undefined
  }
}

function sameFilePath(left, right) {
  const leftPath = path.resolve(fileURLToPath(left))
  const rightPath = path.resolve(fileURLToPath(right))
  return process.platform === 'win32'
    ? leftPath.toLowerCase() === rightPath.toLowerCase()
    : leftPath === rightPath
}

function isTrustedDocumentUrl(candidate, allowedUrls) {
  const actual = parseUrl(candidate)
  if (!actual || !Array.isArray(allowedUrls)) return false

  for (const allowedValue of allowedUrls) {
    const allowed = parseUrl(allowedValue)
    if (!allowed || actual.username || actual.password || allowed.username || allowed.password) continue

    if (actual.protocol === 'http:' && allowed.protocol === 'http:') {
      if (actual.hostname === '127.0.0.1' && allowed.hostname === '127.0.0.1' && actual.origin === allowed.origin) return true
      continue
    }

    if (actual.protocol === 'file:' && allowed.protocol === 'file:') {
      try {
        if (sameFilePath(actual, allowed)) return true
      } catch {
        continue
      }
    }
  }
  return false
}

function isTrustedIpcEvent(event, { webContents, allowedUrls } = {}) {
  if (!webContents || event?.sender !== webContents) return false
  const frame = event.senderFrame
  if (!frame || frame !== webContents.mainFrame) return false
  return isTrustedDocumentUrl(frame.url, allowedUrls)
}

module.exports = { isTrustedDocumentUrl, isTrustedIpcEvent }

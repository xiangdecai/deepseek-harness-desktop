'use strict'

const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')
const { pathToFileURL } = require('node:url')
const { isTrustedDocumentUrl, isTrustedIpcEvent } = require('../src/ipc-security.cjs')

const startupPage = pathToFileURL(path.resolve('src/ui/startup.html')).href
const pluginPage = pathToFileURL(path.resolve('src/ui/plugin-center.html')).href
const harnessUrl = 'http://127.0.0.1:3081'

test('trusted internal UI pages require an exact packaged file path', () => {
  assert.equal(isTrustedDocumentUrl(`${startupPage}?state=ready#status`, [startupPage]), true)
  assert.equal(isTrustedDocumentUrl(pluginPage, [startupPage]), false)
  assert.equal(isTrustedDocumentUrl(pathToFileURL(path.resolve('src/ui/other.html')).href, [startupPage]), false)
  assert.equal(isTrustedDocumentUrl('file:///C:/Users/Public/attacker.html', [startupPage]), false)
})

test('Harness navigation is limited to the selected loopback origin', () => {
  assert.equal(isTrustedDocumentUrl('http://127.0.0.1:3081/sessions/active?tab=chat', [harnessUrl]), true)
  assert.equal(isTrustedDocumentUrl('http://127.0.0.1:3080/', [harnessUrl]), false)
  assert.equal(isTrustedDocumentUrl('http://localhost:3081/', [harnessUrl]), false)
  assert.equal(isTrustedDocumentUrl('https://127.0.0.1:3081/', [harnessUrl]), false)
  assert.equal(isTrustedDocumentUrl('http://user:pass@127.0.0.1:3081/', [harnessUrl]), false)
  assert.equal(isTrustedDocumentUrl('http://192.168.1.10:3081/', [harnessUrl]), false)
  assert.equal(isTrustedDocumentUrl('not a URL', [harnessUrl]), false)
})

test('IPC is accepted only from the expected top-level renderer and document', () => {
  const webContents = { mainFrame: { url: startupPage } }
  const event = { sender: webContents, senderFrame: webContents.mainFrame }
  assert.equal(isTrustedIpcEvent(event, { webContents, allowedUrls: [startupPage] }), true)
  assert.equal(isTrustedIpcEvent(event, { webContents: {}, allowedUrls: [startupPage] }), false)
  assert.equal(isTrustedIpcEvent({ ...event, senderFrame: { url: startupPage } }, { webContents, allowedUrls: [startupPage] }), false)
  assert.equal(isTrustedIpcEvent({ ...event, senderFrame: { url: 'http://127.0.0.1:3081/' } }, { webContents, allowedUrls: [startupPage] }), false)
})

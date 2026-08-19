'use strict'

const assert = require('node:assert/strict')
const { mkdtemp, rm } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { EventEmitter } = require('node:events')
const { DesktopAppUpdater, isPortableEnvironment } = require('../src/desktop-updater.cjs')

class FakeUpdater extends EventEmitter {
  constructor(version = '0.2.0') {
    super()
    this.currentVersion = { version: '0.1.0' }
    this.availableVersion = version
    this.downloads = 0
  }

  async checkForUpdates() {
    const updateInfo = { version: this.availableVersion }
    this.emit('update-available', updateInfo)
    return { updateInfo }
  }

  async downloadUpdate() {
    this.downloads += 1
    this.emit('download-progress', { percent: 48, transferred: 48, total: 100 })
    this.emit('update-downloaded', { version: this.availableVersion })
  }
}

test('portable desktop builds do not enable self update', () => {
  assert.equal(isPortableEnvironment({ PORTABLE_EXECUTABLE_DIR: 'E:\\portable' }), true)
  const updater = new DesktopAppUpdater({ autoUpdater: new FakeUpdater(), userData: os.tmpdir(), isPackaged: true, environment: { PORTABLE_EXECUTABLE_DIR: 'E:\\portable' } })
  assert.equal(updater.enabled, false)
})

test('setup updater checks, records state, and downloads only after an explicit action', async () => {
  const userData = await mkdtemp(path.join(os.tmpdir(), 'dhd-desktop-updater-'))
  const events = []
  const nativeUpdater = new FakeUpdater()
  try {
    const updater = new DesktopAppUpdater({ autoUpdater: nativeUpdater, userData, isPackaged: true, environment: {}, onStatus: event => events.push(event) })
    const checked = await updater.check({ manual: true })
    assert.equal(checked.status, 'available')
    assert.equal(nativeUpdater.downloads, 0)
    await updater.download()
    assert.equal(nativeUpdater.downloads, 1)
    assert.equal(events.some(event => event.status === 'downloaded'), true)
  } finally {
    await rm(userData, { recursive: true, force: true })
  }
})

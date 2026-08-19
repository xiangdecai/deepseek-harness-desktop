'use strict'

const { mkdir, readFile, writeFile } = require('node:fs/promises')
const path = require('node:path')

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000
const STATE_FILE = 'desktop-update-state.json'

function isPortableEnvironment(environment = process.env) {
  return Boolean(environment.PORTABLE_EXECUTABLE_DIR)
}

async function readState(userData) {
  try {
    return JSON.parse(await readFile(path.join(userData, STATE_FILE), 'utf8'))
  } catch {
    return {}
  }
}

async function writeState(userData, state) {
  await mkdir(userData, { recursive: true })
  await writeFile(path.join(userData, STATE_FILE), `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

class DesktopAppUpdater {
  constructor(options) {
    this.autoUpdater = options.autoUpdater
    this.userData = options.userData
    this.isPackaged = options.isPackaged === true
    this.environment = options.environment ?? process.env
    this.logger = options.logger
    this.onStatus = options.onStatus
    this.checking = undefined
    this.latest = undefined
    this.configured = false
  }

  get enabled() {
    return this.isPackaged && !isPortableEnvironment(this.environment) && Boolean(this.autoUpdater)
  }

  configure() {
    if (!this.enabled || this.configured) return
    this.configured = true
    this.autoUpdater.autoDownload = false
    this.autoUpdater.autoInstallOnAppQuit = false
    this.autoUpdater.on('checking-for-update', () => this.publish({ status: 'checking' }))
    this.autoUpdater.on('update-available', info => {
      this.latest = info
      this.publish({ status: 'available', version: info.version, releaseDate: info.releaseDate })
    })
    this.autoUpdater.on('update-not-available', info => this.publish({ status: 'up-to-date', version: info?.version }))
    this.autoUpdater.on('download-progress', progress => this.publish({
      status: 'downloading',
      percent: Math.round(progress.percent),
      transferred: progress.transferred,
      total: progress.total,
    }))
    this.autoUpdater.on('update-downloaded', info => {
      this.latest = info
      this.publish({ status: 'downloaded', version: info.version })
    })
    this.autoUpdater.on('error', error => this.publish({ status: 'error', message: error.message }))
  }

  async due() {
    const state = await readState(this.userData)
    return !state.lastCheckedAt || Date.now() - Date.parse(state.lastCheckedAt) >= CHECK_INTERVAL_MS
  }

  async check({ manual = false } = {}) {
    if (!this.enabled) return { status: isPortableEnvironment(this.environment) ? 'portable' : 'disabled' }
    this.configure()
    if (!manual && !(await this.due())) return { status: 'not-due' }
    if (this.checking) return this.checking
    this.checking = (async () => {
      try {
        const result = await this.autoUpdater.checkForUpdates()
        await writeState(this.userData, { lastCheckedAt: new Date().toISOString() })
        const info = result?.updateInfo
        if (info?.version && info.version !== this.autoUpdater.currentVersion?.version) {
          this.latest = info
          return { status: 'available', version: info.version, releaseDate: info.releaseDate }
        }
        return { status: 'up-to-date', version: info?.version }
      } catch (error) {
        this.publish({ status: 'error', message: error.message })
        return { status: 'error', message: error.message }
      } finally {
        this.checking = undefined
      }
    })()
    return this.checking
  }

  async download() {
    if (!this.enabled) return { status: 'disabled' }
    if (!this.latest) return { status: 'unavailable' }
    this.publish({ status: 'downloading', percent: 0 })
    try {
      await this.autoUpdater.downloadUpdate()
      return { status: 'downloading' }
    } catch (error) {
      this.publish({ status: 'error', message: error.message })
      return { status: 'error', message: error.message }
    }
  }

  install() {
    if (!this.enabled || !this.latest) return false
    this.autoUpdater.quitAndInstall(false, true)
    return true
  }

  publish(status) {
    this.logger?.info(`Desktop update: ${status.status}${status.version ? ` ${status.version}` : ''}${status.message ? ` (${status.message})` : ''}.`, 'desktop-updater')
    this.onStatus?.(status)
  }
}

module.exports = { DesktopAppUpdater, CHECK_INTERVAL_MS, isPortableEnvironment }

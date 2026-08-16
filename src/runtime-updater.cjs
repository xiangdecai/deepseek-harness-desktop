'use strict'

const { createHash } = require('node:crypto')
const { createWriteStream, existsSync, readFileSync } = require('node:fs')
const { mkdir, readFile, rename, rm, writeFile } = require('node:fs/promises')
const https = require('node:https')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { validRuntime } = require('./runtime-loader.cjs')

const OFFICIAL_REPOSITORY = 'deepseek-ai/deepseek-harness'
const RELEASES_API = `https://api.github.com/repos/${OFFICIAL_REPOSITORY}/releases/latest`
const ARCHIVE_PATTERN = /(?:harness.*(?:runtime|win|windows)|(?:runtime|win|windows).*harness).+\.(?:tar\.gz|tgz|zip)$/iu
const STATE_FILE = 'runtime-selection.json'

function normalizeVersion(value) {
  return String(value ?? '').trim().replace(/^v/iu, '')
}

function parseVersion(value) {
  const normalized = normalizeVersion(value)
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/u.exec(normalized)
  if (!match) return undefined
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
  }
}

function compareVersions(left, right) {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (!a || !b) return normalizeVersion(left).localeCompare(normalizeVersion(right), undefined, { numeric: true })
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] - b[key]
  }
  if (a.prerelease.length === 0 && b.prerelease.length > 0) return 1
  if (a.prerelease.length > 0 && b.prerelease.length === 0) return -1
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
    const av = a.prerelease[index]
    const bv = b.prerelease[index]
    if (av === undefined) return -1
    if (bv === undefined) return 1
    if (av === bv) continue
    const an = /^\d+$/u.test(av)
    const bn = /^\d+$/u.test(bv)
    if (an && bn) return Number(av) - Number(bv)
    if (an !== bn) return an ? -1 : 1
    return av.localeCompare(bv)
  }
  return 0
}

function statePath(userData) {
  return path.join(userData, 'runtime', STATE_FILE)
}

async function readState(userData) {
  try {
    return JSON.parse(await readFile(statePath(userData), 'utf8'))
  } catch {
    return {}
  }
}

async function writeState(userData, state) {
  const file = statePath(userData)
  await mkdir(path.dirname(file), { recursive: true })
  if (!state.active && !state.pending) {
    await rm(file, { force: true })
    return
  }
  await writeFile(file, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

function request(url, { accept = 'application/json' } = {}) {
  return new Promise((resolve, reject) => {
    const requestHandle = https.get(url, {
      headers: {
        Accept: accept,
        'User-Agent': 'DeepSeek-Harness-Desktop-Updater',
      },
    }, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume()
        request(response.headers.location, { accept }).then(resolve, reject)
        return
      }
      let body = ''
      response.setEncoding('utf8')
      response.on('data', chunk => { body += chunk })
      response.once('end', () => {
        if ((response.statusCode ?? 500) < 200 || (response.statusCode ?? 500) >= 300) {
          const error = new Error(`GitHub request failed with HTTP ${response.statusCode}`)
          error.code = response.statusCode === 404 ? 'NOT_FOUND' : 'HTTP_ERROR'
          reject(error)
          return
        }
        resolve({ headers: response.headers, body })
      })
    })
    requestHandle.once('error', reject)
    requestHandle.setTimeout(20_000, () => requestHandle.destroy(new Error('GitHub request timed out')))
  })
}

function download(url, destination, onProgress) {
  return new Promise((resolve, reject) => {
    const requestHandle = https.get(url, {
      headers: { 'User-Agent': 'DeepSeek-Harness-Desktop-Updater' },
    }, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume()
        download(response.headers.location, destination, onProgress).then(resolve, reject)
        return
      }
      if ((response.statusCode ?? 500) < 200 || (response.statusCode ?? 500) >= 300) {
        response.resume()
        reject(new Error(`Runtime download failed with HTTP ${response.statusCode}`))
        return
      }
      const output = createWriteStream(destination)
      let received = 0
      const total = Number(response.headers['content-length'] ?? 0)
      response.on('data', chunk => {
        received += chunk.length
        onProgress?.(received, total)
      })
      response.pipe(output)
      output.once('finish', () => output.close(resolve))
      output.once('error', reject)
      response.once('error', reject)
    })
    requestHandle.once('error', reject)
    requestHandle.setTimeout(120_000, () => requestHandle.destroy(new Error('Runtime download timed out')))
  })
}

async function sha256(file) {
  const hash = createHash('sha256')
  const stream = require('node:fs').createReadStream(file)
  for await (const chunk of stream) hash.update(chunk)
  return hash.digest('hex')
}

async function extractArchive(archive, destination) {
  const tar = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
  await new Promise((resolve, reject) => {
    const child = spawn(tar, ['-xf', archive, '-C', destination], {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', chunk => { stderr += chunk })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Runtime archive extraction failed with code ${code}: ${stderr.trim()}`)))
  })
}

async function findRuntimeRoot(directory) {
  if (existsSync(path.join(directory, 'lib', 'bin.js'))) return directory
  const entries = require('node:fs').readdirSync(directory, { withFileTypes: true })
  const children = entries.filter(entry => entry.isDirectory()).map(entry => path.join(directory, entry.name))
  if (children.length !== 1) return undefined
  return findRuntimeRoot(children[0])
}

function runtimeVersion(directory) {
  try {
    return normalizeVersion(JSON.parse(readFileSync(path.join(directory, 'desktop-runtime.json'), 'utf8')).harness_version)
  } catch {
    return ''
  }
}

function selectRuntimeAsset(release) {
  const assets = Array.isArray(release?.assets) ? release.assets : []
  return assets.find(asset => ARCHIVE_PATTERN.test(asset.name))
}

function releaseVersion(release) {
  return normalizeVersion(release?.tag_name || release?.name)
}

class HarnessRuntimeUpdater {
  constructor(options) {
    this.userData = options.userData
    this.logger = options.logger
    this.releaseUrl = options.releaseUrl ?? 'https://github.com/deepseek-ai/deepseek-harness/releases'
    this.apiUrl = options.apiUrl ?? RELEASES_API
  }

  async check(currentVersion) {
    try {
      const response = await request(this.apiUrl)
      const release = JSON.parse(response.body)
      const latestVersion = releaseVersion(release)
      if (!latestVersion) return { status: 'unavailable', reason: '官方 Release 没有有效版本号', releaseUrl: this.releaseUrl }
      if (compareVersions(latestVersion, currentVersion) <= 0) {
        return { status: 'up-to-date', currentVersion, latestVersion, releaseUrl: release.html_url ?? this.releaseUrl }
      }
      const asset = selectRuntimeAsset(release)
      if (!asset || !asset.browser_download_url) {
        return { status: 'unsupported', currentVersion, latestVersion, releaseUrl: release.html_url ?? this.releaseUrl, reason: '官方 Release 未提供 Windows Harness runtime archive' }
      }
      const digest = typeof asset.digest === 'string' && /^sha256:[a-f0-9]{64}$/iu.test(asset.digest)
        ? asset.digest.slice('sha256:'.length).toLowerCase()
        : undefined
      if (!digest) {
        return { status: 'unsupported', currentVersion, latestVersion, releaseUrl: release.html_url ?? this.releaseUrl, reason: '官方 runtime asset 没有 SHA-256 摘要' }
      }
      return {
        status: 'update-available',
        currentVersion,
        latestVersion,
        releaseUrl: release.html_url ?? this.releaseUrl,
        release,
        asset: { name: asset.name, url: asset.browser_download_url, digest },
      }
    } catch (error) {
      if (error.code === 'NOT_FOUND') return { status: 'unavailable', reason: '官方 GitHub 目前没有可用 Release', releaseUrl: this.releaseUrl }
      this.logger?.warn(`Harness update check failed: ${error.message}`, 'updater')
      return { status: 'error', reason: error.message, releaseUrl: this.releaseUrl }
    }
  }

  async install(update) {
    if (update?.status !== 'update-available') throw new Error('No installable Harness update was provided')
    const runtimeDirectory = path.join(this.userData, 'runtime')
    const staging = path.join(runtimeDirectory, `.update-${update.latestVersion}-${process.pid}`)
    const archive = path.join(runtimeDirectory, `${update.asset.name}.download`)
    const target = path.join(runtimeDirectory, `harness-${update.latestVersion}`)
    await mkdir(runtimeDirectory, { recursive: true })
    await rm(staging, { recursive: true, force: true })
    await rm(archive, { force: true })
    this.logger?.info(`Downloading official Harness ${update.latestVersion} from ${update.releaseUrl}.`, 'updater')
    await download(update.asset.url, archive, (received, total) => {
      if (total > 0 && (received === total || received % (25 * 1024 * 1024) < 1024 * 1024)) {
        this.logger?.info(`Harness update download ${Math.round(received / total * 100)}%.`, 'updater')
      }
    })
    const digest = await sha256(archive)
    if (digest !== update.asset.digest) {
      await rm(archive, { force: true })
      throw new Error(`Harness update SHA-256 mismatch: expected ${update.asset.digest}, got ${digest}`)
    }
    await mkdir(staging, { recursive: true })
    await extractArchive(archive, staging)
    await rm(archive, { force: true })
    const root = await findRuntimeRoot(staging)
    if (!root) throw new Error('Official runtime archive has no recognizable Harness layout')
    await writeFile(path.join(root, 'desktop-runtime.json'), `${JSON.stringify({
      harness_version: update.latestVersion,
      source: OFFICIAL_REPOSITORY,
      release_url: update.releaseUrl,
      installed_at: new Date().toISOString(),
    }, null, 2)}\n`, 'utf8')
    if (!validRuntime(root, update.latestVersion)) {
      await rm(staging, { recursive: true, force: true })
      throw new Error(`Official runtime ${update.latestVersion} failed validation`)
    }
    await rm(target, { recursive: true, force: true })
    await rename(root, target)
    if (root !== staging) await rm(staging, { recursive: true, force: true })
    const state = await readState(this.userData)
    await writeState(this.userData, {
      active: state.active,
      pending: { version: update.latestVersion, path: target, attempts: 0 },
    })
    this.logger?.info(`Official Harness ${update.latestVersion} is staged and will activate after a successful restart.`, 'updater')
    return { version: update.latestVersion, path: target }
  }

  async markHealthy(runtimePath) {
    const state = await readState(this.userData)
    if (!state.pending || path.resolve(state.pending.path) !== path.resolve(runtimePath)) return
    await writeState(this.userData, {
      active: { version: state.pending.version, path: state.pending.path },
    })
    this.logger?.info(`Official Harness ${state.pending.version} is now active.`, 'updater')
  }

  async rollbackPending() {
    const state = await readState(this.userData)
    if (!state.pending) return state.active?.path
    await rm(state.pending.path, { recursive: true, force: true })
    await writeState(this.userData, { active: state.active })
    this.logger?.warn(`Rolled back failed Harness runtime ${state.pending.version}.`, 'updater')
    return state.active?.path
  }

  async resolveSelected(fallbackPath, fallbackVersion) {
    const state = await readState(this.userData)
    if (state.pending) {
      if (state.pending.attempts > 0 || !validRuntime(state.pending.path, state.pending.version)) {
        await this.rollbackPending()
      } else {
        state.pending.attempts = 1
        await writeState(this.userData, state)
        return state.pending.path
      }
    }
    if (state.active && validRuntime(state.active.path, state.active.version)) return state.active.path
    if (state.active) await writeState(this.userData, {})
    return fallbackPath
  }
}

module.exports = {
  HarnessRuntimeUpdater,
  compareVersions,
  normalizeVersion,
  selectRuntimeAsset,
  runtimeVersion,
}

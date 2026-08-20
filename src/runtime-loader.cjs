'use strict'

const { spawn } = require('node:child_process')
const { existsSync, readFileSync } = require('node:fs')
const { mkdir, readFile, rename, rm } = require('node:fs/promises')
const path = require('node:path')

async function ensureHarnessRuntime(options) {
  if (!options.isPackaged) return options.developmentRuntime
  const archive = path.join(options.resourcesPath, 'harness-runtime.tar.gz')
  const manifestPath = path.join(options.resourcesPath, 'runtime-manifest.json')
  if (!existsSync(archive) || !existsSync(manifestPath)) {
    throw new Error('Packaged Harness archive or runtime manifest is missing')
  }
  const expected = JSON.parse(await readFile(manifestPath, 'utf8'))
  const version = expected.harness_version
  if (typeof version !== 'string' || version === '') throw new Error('Runtime manifest has no harness_version')
  const runtimeDirectory = path.join(options.userData, 'runtime')
  const target = path.join(runtimeDirectory, `harness-${version}`)
  if (validRuntime(target, version)) {
    options.logger.info(`Reusing extracted Harness runtime ${version} at ${target}.`)
    return target
  }

  const staging = `${target}.staging-${process.pid}`
  await mkdir(runtimeDirectory, { recursive: true })
  await rm(staging, { recursive: true, force: true })
  await rm(target, { recursive: true, force: true })
  await mkdir(staging, { recursive: true })
  options.logger.info(`Extracting Harness runtime ${version}; this is required only once.`)
  const extractionStartedAt = Date.now()
  await expandArchive(archive, staging)
  if (!validRuntime(staging, version)) {
    await rm(staging, { recursive: true, force: true })
    throw new Error(`Extracted Harness runtime ${version} failed validation`)
  }
  await rename(staging, target)
  options.logger.info(`Harness runtime ${version} extracted to ${target} in ${Date.now() - extractionStartedAt} ms.`)
  return target
}

function validRuntime(directory, version) {
  const marker = path.join(directory, 'desktop-runtime.json')
  const entry = path.join(directory, 'lib', 'bin.js')
  const frontend = path.join(directory, 'node_modules', '@deepseek-ai', 'dsh-web-frontend', 'dist', 'index.html')
  const officialEntry = path.join(directory, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  if (!existsSync(marker) || !existsSync(entry) || (!existsSync(frontend) && !existsSync(officialEntry))) return false
  try {
    return JSON.parse(readFileSync(marker, 'utf8')).harness_version === version
  } catch {
    return false
  }
}

function expandArchive(archive, destination) {
  const tar = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
  return new Promise((resolvePromise, reject) => {
    const child = spawn(tar, ['-xzf', archive, '-C', destination], {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', chunk => { stderr += chunk })
    child.once('error', reject)
    child.once('exit', code => {
      if (code === 0) resolvePromise()
      else reject(new Error(`Harness archive extraction failed with code ${code}: ${stderr.trim()}`))
    })
  })
}

module.exports = { ensureHarnessRuntime, validRuntime }

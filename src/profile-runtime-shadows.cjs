'use strict'

const { existsSync } = require('node:fs')
const { cp, mkdir, readFile, readdir, rename, rm, writeFile } = require('node:fs/promises')
const path = require('node:path')

const BACKUP_DIRECTORY = '.desktop-backups/runtime-shadows'
const MANIFEST_FILE = 'transaction.json'

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return fallback
  }
}

async function moveTree(source, target) {
  await mkdir(path.dirname(target), { recursive: true })
  try {
    await rename(source, target)
  } catch (error) {
    if (error.code !== 'EXDEV') throw error
    await cp(source, target, { recursive: true })
    await rm(source, { recursive: true, force: true })
  }
}

function transactionRoot(dshHome) {
  return path.join(dshHome, ...BACKUP_DIRECTORY.split('/'))
}

async function writeManifest(transaction, manifest) {
  await writeFile(path.join(transaction, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}

async function runtimeShadowCandidates({ dshHome, runtimePath, profileName = 'web' }) {
  const profileDirectory = path.join(dshHome, 'profiles', profileName)
  const profileScope = path.join(profileDirectory, 'node_modules', '@deepseek-ai')
  const runtimeScope = path.join(runtimePath, 'node_modules', '@deepseek-ai')
  if (!existsSync(profileScope) || !existsSync(runtimeScope)) return []

  const profileManifest = await readJson(path.join(profileDirectory, 'package.json'), {})
  const declared = new Set([
    ...Object.keys(profileManifest.dependencies ?? {}),
    ...Object.keys(profileManifest.devDependencies ?? {}),
    ...Object.keys(profileManifest.optionalDependencies ?? {}),
    ...Object.keys(profileManifest.peerDependencies ?? {}),
  ])
  const entries = await readdir(profileScope)
  const candidates = []
  for (const entry of entries) {
    const packageName = `@deepseek-ai/${entry}`
    if (declared.has(packageName)) continue
    const source = path.join(profileScope, entry)
    const runtimePackage = path.join(runtimeScope, entry)
    const profilePackageJson = await readJson(path.join(source, 'package.json'))
    const runtimePackageJson = await readJson(path.join(runtimePackage, 'package.json'))
    if (!profilePackageJson?.version || !runtimePackageJson?.version) continue
    if (profilePackageJson.version === runtimePackageJson.version) continue
    candidates.push({
      packageName,
      source,
      relativeBackup: path.join('packages', '@deepseek-ai', entry),
      profileVersion: profilePackageJson.version,
      runtimeVersion: runtimePackageJson.version,
    })
  }
  return candidates
}

async function quarantineProfileRuntimeShadows({ dshHome, runtimePath, runtimeVersion, profileName = 'web', logger }) {
  const entries = await runtimeShadowCandidates({ dshHome, runtimePath, profileName })
  if (entries.length === 0) return undefined
  const id = `${Date.now()}-${process.pid}-${String(runtimeVersion ?? 'runtime').replace(/[^0-9A-Za-z.-]/gu, '_')}`
  const transaction = path.join(transactionRoot(dshHome), id)
  const manifest = {
    status: 'preparing',
    targetRuntimePath: path.resolve(runtimePath),
    targetRuntimeVersion: runtimeVersion,
    profileName,
    entries,
  }
  await mkdir(transaction, { recursive: true })
  await writeManifest(transaction, manifest)
  try {
    for (const entry of entries) {
      if (!existsSync(entry.source)) continue
      await moveTree(entry.source, path.join(transaction, entry.relativeBackup))
    }
    manifest.status = 'prepared'
    await writeManifest(transaction, manifest)
    logger?.info(`Quarantined ${entries.length} stale profile-owned official packages before Harness ${runtimeVersion} activation.`, 'updater')
    return transaction
  } catch (error) {
    await restoreProfileRuntimeShadows(transaction, logger)
    throw error
  }
}

async function restoreProfileRuntimeShadows(transaction, logger) {
  if (!transaction || !existsSync(transaction)) return
  const manifest = await readJson(path.join(transaction, MANIFEST_FILE))
  if (!manifest?.entries) return
  for (const entry of [...manifest.entries].reverse()) {
    const backup = path.join(transaction, entry.relativeBackup)
    if (!existsSync(backup)) continue
    await rm(entry.source, { recursive: true, force: true })
    await moveTree(backup, entry.source)
  }
  await rm(transaction, { recursive: true, force: true })
  logger?.info(`Restored ${manifest.entries.length} profile package shadows after Harness activation rollback.`, 'updater')
}

async function commitProfileRuntimeShadows(transaction, logger) {
  if (!transaction || !existsSync(transaction)) return true
  const manifest = await readJson(path.join(transaction, MANIFEST_FILE), {})
  try {
    await rm(transaction, { recursive: true, force: true })
    logger?.info(`Committed Harness profile compatibility migration (${manifest.entries?.length ?? 0} stale packages removed).`, 'updater')
    return true
  } catch (error) {
    logger?.warn(`Profile compatibility backup cleanup deferred: ${error.code ?? error.message}`, 'updater')
    return false
  }
}

async function recoverProfileRuntimeShadows({ dshHome, runtimeState = {}, logger }) {
  const root = transactionRoot(dshHome)
  if (!existsSync(root)) return []
  const transactions = await readdir(root, { withFileTypes: true })
  const retained = []
  for (const entry of transactions) {
    if (!entry.isDirectory()) continue
    const transaction = path.join(root, entry.name)
    const manifest = await readJson(path.join(transaction, MANIFEST_FILE))
    if (!manifest) {
      await rm(transaction, { recursive: true, force: true })
      continue
    }
    const target = path.resolve(manifest.targetRuntimePath)
    const activeMatches = runtimeState.active && path.resolve(runtimeState.active.path) === target && !runtimeState.pending
    if (activeMatches) {
      await commitProfileRuntimeShadows(transaction, logger)
      continue
    }
    const pendingMatches = manifest.status === 'prepared'
      && runtimeState.pending
      && path.resolve(runtimeState.pending.path) === target
      && Number(runtimeState.pending.attempts ?? 0) === 0
    if (pendingMatches) {
      retained.push(transaction)
      continue
    }
    await restoreProfileRuntimeShadows(transaction, logger)
  }
  return retained
}

module.exports = {
  commitProfileRuntimeShadows,
  quarantineProfileRuntimeShadows,
  recoverProfileRuntimeShadows,
  restoreProfileRuntimeShadows,
  runtimeShadowCandidates,
}

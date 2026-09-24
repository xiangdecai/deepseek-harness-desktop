'use strict'

const { existsSync, lstatSync } = require('node:fs')
const { readFile, rm } = require('node:fs/promises')
const path = require('node:path')

const LEGACY_PACKAGE_NAME = '@xiangong/dsh-client-ui-deliverables'
const LEGACY_PACKAGE_DESCRIPTION = 'Xiangong Desktop clickable deliverables overlay'
const LEGACY_PATCH_CONTENT = [
  '# Desktop-owned overlay. The package files live under the web profile only',
  '# so Cordis can resolve the client bundle without changing user manifests.',
  '- id: ui-deliverables',
  '  disabled: true',
  '- insert:',
  '    - id: xiangong-ui-deliverables',
  "      name: '@xiangong/dsh-client-ui-deliverables'",
  '',
].join('\n')

async function removeOwnedPackage(packageDirectory, removed) {
  if (!existsSync(packageDirectory)) return
  const directoryInfo = lstatSync(packageDirectory)
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) return
  const manifestPath = path.join(packageDirectory, 'package.json')
  if (!existsSync(manifestPath)) return
  const manifestInfo = lstatSync(manifestPath)
  if (!manifestInfo.isFile() || manifestInfo.isSymbolicLink()) return
  let manifest
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  } catch {
    return
  }
  if (manifest.name !== LEGACY_PACKAGE_NAME || manifest.description !== LEGACY_PACKAGE_DESCRIPTION || manifest.private !== true) return
  await rm(packageDirectory, { recursive: true, force: true })
  removed.push(packageDirectory)
}

async function removeOwnedPatch(runtimePath, removed) {
  const patchPath = path.join(runtimePath, 'desktop-deliverables.cordis.patch.yml')
  if (!existsSync(patchPath)) return
  const patchInfo = lstatSync(patchPath)
  if (!patchInfo.isFile() || patchInfo.isSymbolicLink()) return
  const content = (await readFile(patchPath, 'utf8')).replace(/\r\n/gu, '\n')
  if (content !== LEGACY_PATCH_CONTENT) return
  await rm(patchPath, { force: true })
  removed.push(patchPath)
}

async function removeLegacyDesktopDeliverables({ dshHome, runtimePaths = [], logger } = {}) {
  const removed = []
  const packageDirectories = new Set()
  for (const runtimePath of runtimePaths) {
    if (!runtimePath) continue
    const resolvedRuntime = path.resolve(runtimePath)
    packageDirectories.add(path.join(resolvedRuntime, 'node_modules', '@xiangong', 'dsh-client-ui-deliverables'))
    await removeOwnedPatch(resolvedRuntime, removed)
  }
  if (dshHome) {
    packageDirectories.add(path.join(path.resolve(dshHome), 'profiles', 'web', 'node_modules', '@xiangong', 'dsh-client-ui-deliverables'))
  }
  for (const packageDirectory of packageDirectories) await removeOwnedPackage(packageDirectory, removed)
  if (removed.length > 0) logger?.info(`Removed ${removed.length} obsolete Xiangong deliverables artifact(s).`, 'plugins')
  return { removed }
}

module.exports = { removeLegacyDesktopDeliverables }

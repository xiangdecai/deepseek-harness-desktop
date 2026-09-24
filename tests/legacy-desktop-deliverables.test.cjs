'use strict'

const assert = require('node:assert/strict')
const { mkdir, mkdtemp, readFile, rm, writeFile } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { removeLegacyDesktopDeliverables } = require('../src/legacy-desktop-deliverables.cjs')

const OLD_PACKAGE = {
  name: '@xiangong/dsh-client-ui-deliverables',
  version: '1.0.0',
  private: true,
  type: 'module',
  description: 'Xiangong Desktop clickable deliverables overlay',
}

const OLD_PATCH = [
  '# Desktop-owned overlay. The package files live under the web profile only',
  '# so Cordis can resolve the client bundle without changing user manifests.',
  '- id: ui-deliverables',
  '  disabled: true',
  '- insert:',
  '    - id: xiangong-ui-deliverables',
  "      name: '@xiangong/dsh-client-ui-deliverables'",
  '',
].join('\n')

async function writePackage(packageDirectory, manifest) {
  await mkdir(packageDirectory, { recursive: true })
  await writeFile(path.join(packageDirectory, 'package.json'), JSON.stringify(manifest), 'utf8')
  await writeFile(path.join(packageDirectory, 'client.js'), 'legacy overlay', 'utf8')
}

test('migration removes only the exact legacy desktop package and generated Cordis patch', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dhd-legacy-plugin-'))
  const runtime = path.join(root, 'runtime')
  const dshHome = path.join(root, 'dsh-home')
  const runtimePackage = path.join(runtime, 'node_modules', '@xiangong', 'dsh-client-ui-deliverables')
  const profilePackage = path.join(dshHome, 'profiles', 'web', 'node_modules', '@xiangong', 'dsh-client-ui-deliverables')
  const runtimePatch = path.join(runtime, 'desktop-deliverables.cordis.patch.yml')
  try {
    await writePackage(runtimePackage, OLD_PACKAGE)
    await writePackage(profilePackage, OLD_PACKAGE)
    await writeFile(runtimePatch, OLD_PATCH, 'utf8')

    const result = await removeLegacyDesktopDeliverables({ dshHome, runtimePaths: [runtime] })

    assert.equal(result.removed.length, 3)
    await assert.rejects(readFile(path.join(runtimePackage, 'package.json')))
    await assert.rejects(readFile(path.join(profilePackage, 'package.json')))
    await assert.rejects(readFile(runtimePatch))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('migration preserves other Xiangong plugins and modified patch files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dhd-user-plugin-'))
  const runtime = path.join(root, 'runtime')
  const dshHome = path.join(root, 'dsh-home')
  const userPackage = path.join(dshHome, 'profiles', 'web', 'node_modules', '@xiangong', 'my-user-plugin')
  const similarlyNamedPackage = path.join(runtime, 'node_modules', '@xiangong', 'dsh-client-ui-deliverables')
  const customPatchPath = path.join(runtime, 'desktop-deliverables.cordis.patch.yml')
  try {
    await writePackage(userPackage, { name: '@xiangong/my-user-plugin', private: true })
    await writePackage(similarlyNamedPackage, { ...OLD_PACKAGE, description: 'user-modified package' })
    await writeFile(customPatchPath, `${OLD_PATCH}# user change\n`, 'utf8')

    const result = await removeLegacyDesktopDeliverables({ dshHome, runtimePaths: [runtime] })

    assert.deepEqual(result.removed, [])
    assert.equal(await readFile(path.join(userPackage, 'package.json'), 'utf8'), JSON.stringify({ name: '@xiangong/my-user-plugin', private: true }))
    assert.equal(await readFile(path.join(similarlyNamedPackage, 'package.json'), 'utf8'), JSON.stringify({ ...OLD_PACKAGE, description: 'user-modified package' }))
    assert.equal(await readFile(customPatchPath, 'utf8'), `${OLD_PATCH}# user change\n`)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

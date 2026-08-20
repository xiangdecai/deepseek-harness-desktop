'use strict'

const assert = require('node:assert/strict')
const { existsSync } = require('node:fs')
const { mkdtemp, mkdir, readFile, rm, writeFile } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const {
  commitProfileRuntimeShadows,
  quarantineProfileRuntimeShadows,
  recoverProfileRuntimeShadows,
  restoreProfileRuntimeShadows,
  runtimeShadowCandidates,
} = require('../src/profile-runtime-shadows.cjs')

async function writePackage(directory, name, version) {
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, 'package.json'), `${JSON.stringify({ name, version })}\n`, 'utf8')
  await writeFile(path.join(directory, 'marker.txt'), version, 'utf8')
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dhd-profile-shadows-'))
  const dshHome = path.join(root, '.dsh')
  const runtimePath = path.join(root, 'runtime')
  const profile = path.join(dshHome, 'profiles', 'web')
  await mkdir(profile, { recursive: true })
  await writeFile(path.join(profile, 'package.json'), `${JSON.stringify({
    private: true,
    dependencies: { '@deepseek-ai/dsh-declared': '0.1.0-rc.7', 'community-plugin': '1.0.0' },
  })}\n`, 'utf8')
  for (const [name, profileVersion, runtimeVersion] of [
    ['dsh-stale', '0.1.0-rc.7', '0.1.0-rc.8'],
    ['dsh-same', '0.1.0-rc.8', '0.1.0-rc.8'],
    ['dsh-declared', '0.1.0-rc.7', '0.1.0-rc.8'],
  ]) {
    await writePackage(path.join(profile, 'node_modules', '@deepseek-ai', name), `@deepseek-ai/${name}`, profileVersion)
    await writePackage(path.join(runtimePath, 'node_modules', '@deepseek-ai', name), `@deepseek-ai/${name}`, runtimeVersion)
  }
  return { root, dshHome, runtimePath, profile }
}

test('profile runtime migration only quarantines stale undeclared official package shadows', async () => {
  const context = await fixture()
  try {
    const candidates = await runtimeShadowCandidates(context)
    assert.deepEqual(candidates.map(item => item.packageName), ['@deepseek-ai/dsh-stale'])
    const transaction = await quarantineProfileRuntimeShadows({ ...context, runtimeVersion: '0.1.0-rc.8' })
    const stale = path.join(context.profile, 'node_modules', '@deepseek-ai', 'dsh-stale')
    assert.equal(existsSync(stale), false)
    assert.equal(existsSync(path.join(context.profile, 'node_modules', '@deepseek-ai', 'dsh-same')), true)
    assert.equal(existsSync(path.join(context.profile, 'node_modules', '@deepseek-ai', 'dsh-declared')), true)
    await restoreProfileRuntimeShadows(transaction)
    assert.equal(await readFile(path.join(stale, 'marker.txt'), 'utf8'), '0.1.0-rc.7')
  } finally {
    await rm(context.root, { recursive: true, force: true })
  }
})

test('successful profile runtime migration commits the quarantined package backup', async () => {
  const context = await fixture()
  try {
    const transaction = await quarantineProfileRuntimeShadows({ ...context, runtimeVersion: '0.1.0-rc.8' })
    await commitProfileRuntimeShadows(transaction)
    assert.equal(existsSync(transaction), false)
    assert.equal(existsSync(path.join(context.profile, 'node_modules', '@deepseek-ai', 'dsh-stale')), false)
  } finally {
    await rm(context.root, { recursive: true, force: true })
  }
})

test('startup recovery retains a first-attempt pending migration and restores an attempted one', async () => {
  const context = await fixture()
  try {
    const transaction = await quarantineProfileRuntimeShadows({ ...context, runtimeVersion: '0.1.0-rc.8' })
    const retained = await recoverProfileRuntimeShadows({
      dshHome: context.dshHome,
      runtimeState: { pending: { path: context.runtimePath, attempts: 0 } },
    })
    assert.deepEqual(retained, [transaction])
    await recoverProfileRuntimeShadows({
      dshHome: context.dshHome,
      runtimeState: { pending: { path: context.runtimePath, attempts: 1 } },
    })
    assert.equal(existsSync(path.join(context.profile, 'node_modules', '@deepseek-ai', 'dsh-stale')), true)
  } finally {
    await rm(context.root, { recursive: true, force: true })
  }
})

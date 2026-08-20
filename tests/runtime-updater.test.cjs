'use strict'

const assert = require('node:assert/strict')
const { mkdtemp, mkdir, readFile, rm, writeFile } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const {
  HarnessRuntimeUpdater,
  compareVersions,
  selectNpmRuntime,
  selectRuntimeAsset,
} = require('../src/runtime-updater.cjs')

async function makeRuntime(root, version) {
  await mkdir(path.join(root, 'lib'), { recursive: true })
  await mkdir(path.join(root, 'node_modules', '@deepseek-ai', 'dsh-web-frontend', 'dist'), { recursive: true })
  await writeFile(path.join(root, 'lib', 'bin.js'), '', 'utf8')
  await writeFile(path.join(root, 'node_modules', '@deepseek-ai', 'dsh-web-frontend', 'dist', 'index.html'), '', 'utf8')
  await writeFile(path.join(root, 'desktop-runtime.json'), `${JSON.stringify({ harness_version: version })}\n`, 'utf8')
}

test('compareVersions orders stable and prerelease Harness versions', () => {
  assert.ok(compareVersions('0.1.0-rc.6', '0.1.0-rc.5') > 0)
  assert.ok(compareVersions('0.1.0', '0.1.0-rc.9') > 0)
  assert.equal(compareVersions('v0.1.0', '0.1.0'), 0)
})

test('selectRuntimeAsset only accepts named runtime archives', () => {
  const asset = selectRuntimeAsset({ assets: [
    { name: 'source.zip' },
    { name: 'deepseek-harness-runtime-win-x64.tar.gz', browser_download_url: 'https://example.test/runtime' },
  ] })
  assert.equal(asset.name, 'deepseek-harness-runtime-win-x64.tar.gz')
})

test('selectNpmRuntime promotes the newer official next release candidate', () => {
  const runtime = selectNpmRuntime({
    'dist-tags': { latest: '0.1.0-rc.7', next: '0.1.0-rc.8' },
    versions: {
      '0.1.0-rc.7': { dist: { tarball: 'https://example.test/rc.7.tgz', integrity: 'sha512-rc7' } },
      '0.1.0-rc.8': { dist: { tarball: 'https://example.test/rc.8.tgz', integrity: 'sha512-rc8' } },
    },
  })
  assert.deepEqual(runtime, {
    tag: 'next',
    version: '0.1.0-rc.8',
    info: { dist: { tarball: 'https://example.test/rc.8.tgz', integrity: 'sha512-rc8' } },
  })
})

test('pending runtime is selected once and rolled back after a failed boot', async () => {
  const userData = await mkdtemp(path.join(os.tmpdir(), 'dhd-updater-'))
  const fallback = path.join(userData, 'fallback')
  const pending = path.join(userData, 'runtime', 'harness-0.2.0')
  try {
    await makeRuntime(fallback, '0.1.0')
    await makeRuntime(pending, '0.2.0')
    await mkdir(path.join(userData, 'runtime'), { recursive: true })
    await writeFile(path.join(userData, 'runtime', 'runtime-selection.json'), `${JSON.stringify({ pending: { version: '0.2.0', path: pending, attempts: 0 } })}\n`, 'utf8')
    const updater = new HarnessRuntimeUpdater({ userData })
    assert.equal(await updater.resolveSelected(fallback, '0.1.0'), pending)
    const state = JSON.parse(await readFile(path.join(userData, 'runtime', 'runtime-selection.json'), 'utf8'))
    assert.equal(state.pending.attempts, 1)
    assert.equal(await updater.resolveSelected(fallback, '0.1.0'), fallback)
  } finally {
    await rm(userData, { recursive: true, force: true })
  }
})

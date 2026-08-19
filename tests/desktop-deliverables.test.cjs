'use strict'

const assert = require('node:assert/strict')
const { mkdtemp, mkdir, readFile, rm, writeFile } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { applyDesktopDeliverablesPatch, commonDir, patchSource } = require('../src/desktop-deliverables.cjs')

test('commonDir keeps Windows drive roots, Chinese paths, and relative folders stable', () => {
  assert.equal(commonDir(['E:\\项目资料\\成果\\a.md', 'E:\\项目资料\\成果\\b.md']), 'E:/项目资料/成果')
  assert.equal(commonDir(['E:/项目资料/子目录/a.md', 'E:/项目资料/b.md']), 'E:/项目资料')
  assert.equal(commonDir(['report.md']), '.')
  assert.equal(commonDir(['C:/a.md']), 'C:/')
})

test('deliverables patch is idempotent and keeps native opening guarded', () => {
  const source = 'const SHOWN_LIMIT = 6;\nconst canOpenPath = isLoopback && hostCanOpenPath;\nhidden > 0 && canOpenPath && (0, react_jsx_runtime.jsx)("button", {\nonClick: () => { openFile("."); }\n'
  const first = patchSource(source)
  assert.equal(first.changed, true)
  assert.match(first.source, /desktopCommonDir/)
  assert.match(first.source, /canOpenPath &&/)
  assert.match(first.source, /openFile\(folderPath\)/)
  assert.equal(patchSource(first.source).changed, false)
})

test('desktop creates a separate Cordis package instead of modifying the official plugin', async () => {
  const runtime = await mkdtemp(path.join(os.tmpdir(), 'dhd-deliverables-'))
  const home = await mkdtemp(path.join(os.tmpdir(), 'dhd-deliverables-home-'))
  const official = path.join(runtime, 'node_modules', '@deepseek-ai', 'dsh-client-ui-deliverables', 'lib')
  const source = 'window.__ModuleLoader__.load({ id: "@deepseek-ai/dsh-client-ui-deliverables", factory: () => {} });\nconst SHOWN_LIMIT = 6;\nconst canOpenPath = isLoopback && hostCanOpenPath;\nhidden > 0 && canOpenPath && (0, react_jsx_runtime.jsx)("button", {\nonClick: () => { openFile("."); }\n'
  try {
    await mkdir(official, { recursive: true })
    await writeFile(path.join(official, 'client.js'), source, 'utf8')
    await writeFile(path.join(official, 'index.js'), 'export const inject = []; export function apply() {}\n', 'utf8')
    const result = await applyDesktopDeliverablesPatch(runtime, undefined, home)
    assert.equal(result.status, 'ready')
    assert.equal(await readFile(path.join(official, 'client.js'), 'utf8'), source)
    const copied = await readFile(path.join(runtime, 'node_modules', '@xiangong', 'dsh-client-ui-deliverables', 'lib', 'client.js'), 'utf8')
    assert.match(copied, /@xiangong\/dsh-client-ui-deliverables/)
    const overlay = await readFile(result.patchFile, 'utf8')
    assert.match(overlay, /disabled: true/)
    assert.match(overlay, /@xiangong\/dsh-client-ui-deliverables/)
    assert.match(await readFile(path.join(home, 'profiles', 'web', 'node_modules', '@xiangong', 'dsh-client-ui-deliverables', 'lib', 'index.js'), 'utf8'), /export const inject/)
  } finally {
    await rm(runtime, { recursive: true, force: true })
    await rm(home, { recursive: true, force: true })
  }
})

'use strict'

const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.join(__dirname, '..')
const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const mainSource = readFileSync(path.join(root, 'src', 'main.cjs'), 'utf8')

test('Windows installer preserves user data on upgrade and uninstall', () => {
  assert.equal(packageJson.build.appId, 'ai.deepseek.harness.desktop')
  assert.equal(packageJson.build.nsis.deleteAppDataOnUninstall, false)
})

test('session-owned paths are stable across desktop versions', () => {
  assert.match(mainSource, /process\.env\.DSH_HOME \|\| path\.join\(os\.homedir\(\), ['"]\.dsh['"]\)/u)
  assert.match(mainSource, /app\.getPath\(['"]userData['"]\)/u)
  assert.doesNotMatch(mainSource, /getPath\(['"]userData-[^'"]*\$\{?app\.getVersion/u)
})


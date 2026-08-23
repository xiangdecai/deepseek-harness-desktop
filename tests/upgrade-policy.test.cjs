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
  assert.equal(packageJson.build.productName, 'X DSH Desktop')
})

test('session-owned paths are stable across desktop versions', () => {
  assert.match(mainSource, /process\.env\.DSH_HOME \|\| path\.join\(os\.homedir\(\), ['"]\.dsh['"]\)/u)
  assert.match(mainSource, /app\.getPath\(['"]userData['"]\)/u)
  assert.doesNotMatch(mainSource, /getPath\(['"]userData-[^'"]*\$\{?app\.getVersion/u)
})

test('desktop updates use a separate non-modal progress window', () => {
  const publisher = /function publishDesktopUpdate\(status\) \{(?<body>[\s\S]*?)\n\}/u.exec(mainSource)?.groups?.body ?? ''
  assert.match(mainSource, /function createUpdateWindow\(\)/u)
  assert.doesNotMatch(publisher, /showStartupPage\(\)/u)
  assert.doesNotMatch(mainSource, /showErrorBox\(['"]Harness 更新失败/u)
})

test('native Harness image attachments remain the default paste path', () => {
  assert.match(mainSource, /let visionEnabled = false/u)
  assert.match(mainSource, /纯文本模型：粘贴图片生成 OCR 证据/u)
})

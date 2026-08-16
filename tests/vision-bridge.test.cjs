'use strict'

const assert = require('node:assert/strict')
const { mkdtempSync, readFileSync, rmSync } = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { AppLogger } = require('../src/logger.cjs')
const { VisionBridge } = require('../src/vision-bridge.cjs')

test('vision bridge emits versioned local OCR evidence', { skip: process.platform !== 'win32' }, async t => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'dhd-vision-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const logger = new AppLogger(path.join(directory, 'logs'))
  const bridge = new VisionBridge({
    cacheDirectory: path.join(directory, 'cache'),
    scriptPath: path.resolve(__dirname, '..', 'src', 'windows-ocr.ps1'),
    logger,
  })
  const bytes = readFileSync(path.resolve(__dirname, '..', 'assets', 'icon.png'))
  const evidence = await bridge.analyze({ bytes, mimeType: 'image/png' })
  assert.equal(evidence.schema_version, 'xiangong.vision-evidence.v1')
  assert.equal(evidence.source.sha256.length, 64)
  assert.equal(evidence.source.width, 512)
  assert.equal(evidence.source.height, 512)
  assert.equal(evidence.ocr.engine, 'windows.media.ocr')
  assert.ok(Array.isArray(evidence.layout.regions))
})


'use strict'

const assert = require('node:assert/strict')
const { mkdtempSync, readFileSync, rmSync } = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { AppLogger } = require('../src/logger.cjs')

test('logger persists records and keeps a bounded snapshot', t => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'dhd-logger-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const logger = new AppLogger(directory, 2)
  logger.info('one')
  logger.warn('two')
  logger.error('three')
  assert.deepEqual(logger.snapshot().map(record => record.message), ['two', 'three'])
  const file = readFileSync(logger.filePath, 'utf8')
  assert.match(file, /\[INFO\].*one/u)
  assert.match(file, /\[ERROR\].*three/u)
})


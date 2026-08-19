'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { DEFAULT_WINDOW_BOUNDS, nextTextScale, normalizeTextScale } = require('../src/display-preferences.cjs')

test('desktop uses a Codex-like default work window and bounded text scales', () => {
  assert.deepEqual(DEFAULT_WINDOW_BOUNDS, { width: 1120, height: 690 })
  assert.equal(normalizeTextScale(1.2), 1.2)
  assert.equal(normalizeTextScale(7), 1)
  assert.equal(nextTextScale(1, 1), 1.1)
  assert.equal(nextTextScale(0.85, -1), 0.85)
})

'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { inspectCordisPatch } = require('../src/plugin-manager.cjs')

test('plugin diagnostics detect loader hazards without editing user configuration', () => {
  const findings = inspectCordisPatch('\ufeff- id: demo\n  name: plugin-a\n- id: demo\n  name:\n')
  assert.equal(findings.some(finding => finding.code === 'bom'), true)
  assert.equal(findings.some(finding => finding.code === 'duplicate-id'), true)
  assert.equal(findings.some(finding => finding.code === 'missing-entry'), true)
})

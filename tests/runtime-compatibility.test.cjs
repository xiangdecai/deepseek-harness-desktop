'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { assertInstallableRuntime, classifyRuntimeVersion } = require('../src/runtime-compatibility.cjs')

test('the rc.2 desktop baseline is qualified for installation', () => {
  assert.deepEqual(classifyRuntimeVersion('v0.1.1-rc.2'), {
    version: '0.1.1-rc.2',
    status: 'qualified',
    note: 'X DSH Desktop 0.3.0 验证基线',
    installable: true,
  })
  assert.doesNotThrow(() => assertInstallableRuntime('0.1.1-rc.2'))
})

test('unknown upstream releases fail loud instead of auto-activating', () => {
  const result = classifyRuntimeVersion('0.1.1-rc.3')
  assert.equal(result.status, 'unqualified')
  assert.equal(result.installable, false)
  assert.throws(() => assertInstallableRuntime('0.1.1-rc.3'), /尚未通过 X DSH Desktop 兼容性验证/u)
})

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

test('the v0.1.7-rc.1 runtime is qualified after Windows auth and UI smoke checks', () => {
  assert.deepEqual(classifyRuntimeVersion('v0.1.7-rc.1'), {
    version: '0.1.7-rc.1',
    status: 'qualified',
    note: 'Windows 启动与认证烟测通过；上游报告已安装插件可能缺少子进程 peer 依赖',
    installable: true,
  })
  assert.doesNotThrow(() => assertInstallableRuntime('0.1.7-rc.1'))
})

test('unknown upstream releases fail loud instead of auto-activating', () => {
  const result = classifyRuntimeVersion('0.1.7-rc.2')
  assert.equal(result.status, 'unqualified')
  assert.equal(result.installable, false)
  assert.throws(() => assertInstallableRuntime('0.1.7-rc.2'), /尚未通过 X DSH Desktop 兼容性验证/u)
})

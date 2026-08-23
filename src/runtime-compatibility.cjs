'use strict'

const RUNTIME_SUPPORT = Object.freeze({
  '0.1.0-rc.5': { status: 'legacy', note: '初始随附版本，仅用于回退' },
  '0.1.0-rc.6': { status: 'legacy', note: '历史更新版本' },
  '0.1.0-rc.7': { status: 'legacy', note: '历史更新版本' },
  '0.1.0-rc.8': { status: 'legacy', note: '历史更新版本' },
  '0.1.1-rc.2': { status: 'qualified', note: 'X DSH Desktop 0.3.0 验证基线' },
})

function normalizeVersion(value) {
  return String(value ?? '').trim().replace(/^v/iu, '')
}

function classifyRuntimeVersion(value) {
  const version = normalizeVersion(value)
  const support = RUNTIME_SUPPORT[version]
  if (support) return { version, ...support, installable: support.status === 'qualified' }
  return {
    version,
    status: 'unqualified',
    installable: false,
    note: '该官方版本尚未完成 Windows 桌面启动、插件与回滚验证',
  }
}

function assertInstallableRuntime(value) {
  const support = classifyRuntimeVersion(value)
  if (!support.installable) {
    throw new Error(`Harness ${support.version || '(unknown)'} 尚未通过 X DSH Desktop 兼容性验证：${support.note}`)
  }
  return support
}

module.exports = { RUNTIME_SUPPORT, assertInstallableRuntime, classifyRuntimeVersion }

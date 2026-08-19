'use strict'

const { copyFile, mkdir, readFile, readdir, stat, writeFile } = require('node:fs/promises')
const { existsSync } = require('node:fs')
const path = require('node:path')

const PLUGIN_CATEGORIES = Object.freeze([
  '界面与外观', '模型与视觉', '文件与工作区', '会话与记忆',
  '自动化与通知', '外部集成', '开发与诊断',
])

function inspectCordisPatch(source, file = 'cordis.patch.yml') {
  const findings = []
  if (source.charCodeAt(0) === 0xfeff) findings.push({ severity: 'warning', code: 'bom', file, message: '配置文件带有 UTF-8 BOM，部分插件加载器可能无法解析。' })
  const ids = new Map()
  const rows = source.split(/\r?\n/u)
  let lastId
  for (const [index, row] of rows.entries()) {
    const id = /^\s*-\s+id:\s*([^#\s]+)\s*$/u.exec(row)
    if (id) {
      lastId = id[1]
      if (ids.has(lastId)) findings.push({ severity: 'error', code: 'duplicate-id', file, line: index + 1, message: `重复 Cordis row id: ${lastId}` })
      ids.set(lastId, index + 1)
      continue
    }
    if (lastId && /^\s*name:\s*$/u.test(row)) {
      findings.push({ severity: 'error', code: 'missing-entry', file, line: index + 1, message: `Cordis row ${lastId} 缺少插件入口名。` })
    }
  }
  return findings
}

async function existingFiles(root) {
  const names = ['cordis.patch.yml', 'package.json', 'pnpm-lock.yaml']
  const found = []
  for (const name of names) {
    const source = path.join(root, name)
    if (existsSync(source)) found.push({ source, relative: name })
  }
  const profiles = path.join(root, 'profiles')
  if (existsSync(profiles)) {
    for (const entry of await readdir(profiles, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      for (const name of names) {
        const source = path.join(profiles, entry.name, name)
        if (existsSync(source)) found.push({ source, relative: path.join('profiles', entry.name, name) })
      }
    }
  }
  return found
}

class DesktopPluginManager {
  constructor(options) {
    this.dshHome = options.dshHome
    this.userData = options.userData
    this.logger = options.logger
  }

  backupDirectory() {
    return path.join(this.userData, 'plugin-backups')
  }

  async backup(reason) {
    const stamp = new Date().toISOString().replace(/[:.]/gu, '-')
    const destination = path.join(this.backupDirectory(), `${stamp}-${reason}`)
    const files = await existingFiles(this.dshHome)
    await mkdir(destination, { recursive: true })
    for (const file of files) {
      const target = path.join(destination, file.relative)
      await mkdir(path.dirname(target), { recursive: true })
      await copyFile(file.source, target)
    }
    await writeFile(path.join(destination, 'backup.json'), `${JSON.stringify({
      createdAt: new Date().toISOString(), reason, dshHome: this.dshHome, files: files.map(file => file.relative),
    }, null, 2)}\n`, 'utf8')
    this.logger?.info(`Plugin configuration backup created (${files.length} files).`, 'plugins')
    return { directory: destination, files: files.map(file => file.relative) }
  }

  async inventory({ runtimePath, runtimeVersion, deliverables } = {}) {
    const findings = []
    const files = await existingFiles(this.dshHome)
    for (const file of files.filter(entry => entry.relative.endsWith('cordis.patch.yml'))) {
      findings.push(...inspectCordisPatch(await readFile(file.source, 'utf8'), file.relative))
    }
    const packageFile = path.join(this.dshHome, 'package.json')
    let dependencies = {}
    if (existsSync(packageFile)) {
      try {
        const manifest = JSON.parse(await readFile(packageFile, 'utf8'))
        dependencies = { ...(manifest.dependencies ?? {}), ...(manifest.devDependencies ?? {}) }
      } catch {
        findings.push({ severity: 'error', code: 'manifest-invalid', file: 'package.json', message: '插件 package.json 不是有效 JSON。' })
      }
    }
    const installed = Object.entries(dependencies).map(([name, version]) => ({
      name, version, source: 'user profile', enabled: true, scope: 'DSH_HOME', compatibility: '未验证', permissions: '由插件自身声明',
    }))
    installed.unshift({
      name: '@xiangong/dsh-client-ui-deliverables',
      version: '1', source: 'desktop built-in', enabled: deliverables?.status === 'ready', scope: 'desktop runtime',
      compatibility: deliverables?.status === 'ready' ? `已验证 Harness ${runtimeVersion}` : '与当前 Harness 不兼容，已禁用',
      permissions: '仅通过 Harness host.openPath 打开本机路径；无文件写入权限',
    })
    return {
      categories: PLUGIN_CATEGORIES,
      runtime: { path: runtimePath, version: runtimeVersion },
      installed,
      findings,
      backupDirectory: this.backupDirectory(),
      protected: '桌面更新不会删除 DSH_HOME 中的插件、配置、会话、密钥或记忆。',
    }
  }
}

module.exports = { DesktopPluginManager, PLUGIN_CATEGORIES, inspectCordisPatch }

'use strict'

const tabs = [...document.querySelectorAll('.tab')]
const panels = [...document.querySelectorAll('.tab-panel')]
const notice = document.getElementById('notice')

function selectTab(name) {
  tabs.forEach(tab => {
    const active = tab.dataset.tab === name
    tab.classList.toggle('active', active)
    tab.setAttribute('aria-selected', String(active))
  })
  panels.forEach(panel => panel.classList.toggle('active', panel.id === name))
}

function text(element, value) { element.textContent = value }

function render(inventory) {
  text(document.getElementById('runtime'), `Harness ${inventory.runtime.version || '未知版本'} · ${inventory.runtime.path || '未连接'}`)
  text(document.getElementById('protected'), inventory.protected)
  const categories = document.getElementById('categories')
  categories.replaceChildren(...inventory.categories.map(category => {
    const item = document.createElement('span')
    item.textContent = category
    return item
  }))
  const plugins = document.getElementById('plugins')
  plugins.replaceChildren(...inventory.installed.map(plugin => {
    const row = document.createElement('article')
    row.className = 'plugin'
    const title = document.createElement('strong')
    title.textContent = plugin.name
    const detail = document.createElement('span')
    detail.textContent = `${plugin.version} · ${plugin.source} · ${plugin.compatibility}`
    const permission = document.createElement('small')
    permission.textContent = plugin.permissions
    row.append(title, detail, permission)
    return row
  }))
  const findings = document.getElementById('findings')
  if (inventory.findings.length === 0) {
    text(findings, '未发现已知的重复 loader、缺失入口或 BOM 配置问题。')
    return
  }
  findings.replaceChildren(...inventory.findings.map(finding => {
    const row = document.createElement('p')
    row.className = finding.severity
    row.textContent = `${finding.file}${finding.line ? `:${finding.line}` : ''} · ${finding.message}`
    return row
  }))
}

tabs.forEach(tab => tab.addEventListener('click', () => selectTab(tab.dataset.tab)))
document.getElementById('backup').addEventListener('click', async () => {
  const backup = await window.harnessDesktop.backupPluginState()
  text(notice, `已备份 ${backup.files.length} 个插件配置文件。`)
})
document.getElementById('open-backups').addEventListener('click', () => window.harnessDesktop.openPluginBackups())

void window.harnessDesktop.getPluginInventory().then(render).catch(error => text(notice, error.message))

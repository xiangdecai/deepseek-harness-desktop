'use strict'

const logs = document.getElementById('logs')
const statusLine = document.getElementById('status-line')
const statusDetail = document.getElementById('status-detail')
const serviceDetail = document.getElementById('service-detail')
const progressTrack = document.getElementById('progress-track')
const retryButton = document.getElementById('retry')
const logDrawer = document.getElementById('log-drawer')
let updateMode = false

function addLog(record) {
  const row = document.createElement('div')
  row.className = `log-line ${record.level}`
  const time = document.createElement('span')
  time.className = 'time'
  time.textContent = `${new Date(record.timestamp).toLocaleTimeString()} `
  const content = document.createElement('span')
  content.textContent = `[${record.source}] ${record.message}`
  row.append(time, content)
  logs.appendChild(row)
  logs.scrollTop = logs.scrollHeight
  if (record.level === 'error') logDrawer.open = true
  return record.message
}

function statusFromLog(message) {
  if (/Extracting Harness runtime/iu.test(message)) return '正在准备本地运行时（首次启动只需一次）'
  if (/Starting private runtime/iu.test(message)) return '正在启动私有运行时'
  if (/Detected an existing DeepSeek Harness/iu.test(message)) return '正在连接已运行的 Harness'
  if (/Harness is ready/iu.test(message)) return '本地 Harness 服务已就绪'
  return message
}

function renderStatus(service, lastMessage = '') {
  if (updateMode) return
  const isReady = service.mode === 'managed' || service.mode === 'attached'
  const isError = !isReady && /failed|error|exited|did not become ready/iu.test(lastMessage)
  progressTrack.className = `progress-track${isReady ? ' ready' : isError ? ' error' : ''}`
  retryButton.hidden = !isError
  serviceDetail.textContent = isReady ? `${service.url} · ${service.mode === 'attached' ? '外部实例' : '应用内服务'}` : ''

  if (isReady) {
    statusLine.className = 'status-line'
    statusLine.textContent = 'DeepSeek Harness 已就绪'
    statusDetail.textContent = '正在加载本地工作区'
  } else if (isError) {
    statusLine.className = 'status-line error'
    statusLine.textContent = '启动没有完成'
    statusDetail.textContent = '请查看日志后重新启动'
  } else {
    statusLine.className = 'status-line'
    statusLine.textContent = '正在启动本地 Harness 服务'
    statusDetail.textContent = statusFromLog(lastMessage) || '正在准备运行环境'
  }
}

function renderUpdateProgress(progress = {}) {
  updateMode = true
  const percent = Number.isFinite(progress.percent) ? Math.max(0, Math.min(100, progress.percent)) : undefined
  statusLine.className = 'status-line update'
  statusLine.textContent = '正在更新官方 Harness'
  statusDetail.textContent = progress.message || '正在准备更新'
  serviceDetail.textContent = percent === undefined ? '安装依赖可能需要一些时间' : `${percent}%`
  progressTrack.className = `progress-track update${progress.phase === 'complete' ? ' ready' : ''}`
  progressTrack.querySelector('span').style.width = percent === undefined ? '' : `${percent}%`
  retryButton.hidden = true
  logDrawer.open = true
}

function renderAppUpdateProgress(progress = {}) {
  if (progress.status === 'available') return
  if (progress.status === 'downloaded') {
    statusLine.className = 'status-line update'
    statusLine.textContent = '桌面应用更新已就绪'
    statusDetail.textContent = `${progress.version} 已下载，等待安装`
    progressTrack.className = 'progress-track ready'
    progressTrack.querySelector('span').style.width = '100%'
    return
  }
  if (progress.status === 'error') {
    statusLine.className = 'status-line error'
    statusLine.textContent = '桌面应用更新失败'
    statusDetail.textContent = progress.message || '当前版本保持不变'
    progressTrack.className = 'progress-track error'
    return
  }
  if (progress.status === 'downloading') {
    const percent = Number.isFinite(progress.percent) ? Math.max(0, Math.min(100, progress.percent)) : 0
    statusLine.className = 'status-line update'
    statusLine.textContent = '正在下载桌面应用更新'
    statusDetail.textContent = `${percent}%`
    progressTrack.className = 'progress-track update'
    progressTrack.querySelector('span').style.width = `${percent}%`
  }
}

async function initialize() {
  window.harnessDesktop.onUpdateProgress(renderUpdateProgress)
  window.harnessDesktop.onAppUpdateProgress(renderAppUpdateProgress)
  const state = await window.harnessDesktop.getState()
  let lastMessage = ''
  state.logs.forEach(record => { lastMessage = addLog(record) })
  renderStatus(state.service, lastMessage)
  window.harnessDesktop.onLog(record => {
    lastMessage = addLog(record)
    void window.harnessDesktop.getState().then(next => renderStatus(next.service, lastMessage))
  })
}

retryButton.addEventListener('click', async () => {
  retryButton.disabled = true
  statusLine.className = 'status-line'
  statusLine.textContent = '正在重新启动本地 Harness 服务'
  statusDetail.textContent = '正在重新准备运行环境'
  progressTrack.className = 'progress-track'
  try {
    const state = await window.harnessDesktop.restart()
    renderStatus(state)
  } finally {
    retryButton.disabled = false
  }
})

document.getElementById('view-log').addEventListener('click', () => {
  logDrawer.open = !logDrawer.open
  if (logDrawer.open) logDrawer.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
})

document.getElementById('open-logs').addEventListener('click', () => window.harnessDesktop.openLogDirectory())
document.getElementById('open-data').addEventListener('click', () => window.harnessDesktop.openDataDirectory())

void initialize()

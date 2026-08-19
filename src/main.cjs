'use strict'

const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, shell, Tray } = require('electron')
const { autoUpdater } = require('electron-updater')
const { mkdirSync } = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { AppLogger } = require('./logger.cjs')
const { HarnessServiceManager } = require('./service-manager.cjs')
const { ensureHarnessRuntime } = require('./runtime-loader.cjs')
const { HarnessRuntimeUpdater, extractNpmRuntime, runtimeVersion } = require('./runtime-updater.cjs')
const { VisionBridge } = require('./vision-bridge.cjs')
const { DesktopAppUpdater } = require('./desktop-updater.cjs')
const { applyDesktopDeliverablesPatch } = require('./desktop-deliverables.cjs')
const { DesktopPluginManager } = require('./plugin-manager.cjs')
const {
  DEFAULT_WINDOW_BOUNDS, DEFAULT_TEXT_SCALE, nextTextScale, readDisplayPreferences, writeDisplayPreferences,
} = require('./display-preferences.cjs')

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()

let mainWindow
let logWindow
let pluginWindow
let tray
let logger
let service
let vision
let visionEnabled = true
let quitting = false
let runtimeUpdater
let runtimePath
let fallbackRuntimePath
let runtimeVersionValue = ''
let updateInProgress = false
let desktopUpdater
let desktopUpdatePrompted = false
let displayPreferences = { textScale: DEFAULT_TEXT_SCALE }
let pluginManager
let deliverablesStatus
let serviceRestartPromise

function projectPath(...segments) {
  return path.join(__dirname, '..', ...segments)
}

function bundledPath(...segments) {
  return app.isPackaged
    ? path.join(process.resourcesPath, ...segments)
    : projectPath('resources', ...segments)
}

function ocrScriptPath() {
  const script = path.join(app.getAppPath(), 'src', 'windows-ocr.ps1')
  return app.isPackaged ? script.replace('app.asar', 'app.asar.unpacked') : script
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: DEFAULT_WINDOW_BOUNDS.width,
    height: DEFAULT_WINDOW_BOUNDS.height,
    minWidth: 960,
    minHeight: 680,
    show: false,
    backgroundColor: '#f7f8fa',
    icon: projectPath('assets', 'icon.png'),
    title: 'DeepSeek Harness Desktop',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  mainWindow.webContents.setZoomFactor(displayPreferences.textScale)
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('close', event => {
    if (quitting) return
    event.preventDefault()
    mainWindow?.hide()
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/iu.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('http://127.0.0.1:') || url.startsWith('file:')) return
    event.preventDefault()
    if (/^https?:/iu.test(url)) void shell.openExternal(url)
  })
}

async function setChatTextScale(textScale) {
  displayPreferences = await writeDisplayPreferences(app.getPath('userData'), { textScale })
  mainWindow?.webContents.setZoomFactor(displayPreferences.textScale)
  logger?.info(`Chat text scale set to ${Math.round(displayPreferences.textScale * 100)}%.`, 'display')
  buildMenus()
}

async function showStartupPage(target = mainWindow) {
  if (target?.isDestroyed() !== false) return
  await target.loadFile(path.join(__dirname, 'ui', 'startup.html'))
}

async function showHarness() {
  if (!mainWindow || mainWindow.isDestroyed() || !service.url) return
  const targetUrl = service.url
  if (mainWindow.webContents.getURL() !== targetUrl) {
    try {
      await mainWindow.loadURL(targetUrl)
    } catch (error) {
      // Electron reports ERR_ABORTED when the startup page navigation wins a race.
      // A single retry is enough once the service startup has settled.
      if (error.code !== 'ERR_ABORTED' || service.url !== targetUrl) throw error
      await new Promise(resolve => setTimeout(resolve, 200))
      if (mainWindow && !mainWindow.isDestroyed() && service.url === targetUrl && mainWindow.webContents.getURL() !== targetUrl) {
        await mainWindow.loadURL(targetUrl)
      }
    }
  }
  mainWindow.setTitle('DeepSeek Harness Desktop')
  mainWindow.show()
}

function createLogWindow() {
  if (logWindow && !logWindow.isDestroyed()) {
    logWindow.show()
    logWindow.focus()
    return
  }
  logWindow = new BrowserWindow({
    width: 860,
    height: 620,
    minWidth: 680,
    minHeight: 420,
    title: 'DeepSeek Harness Desktop - 启动日志',
    parent: mainWindow,
    icon: projectPath('assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  void showStartupPage(logWindow)
  logWindow.on('closed', () => { logWindow = undefined })
}

function createPluginCenter() {
  if (pluginWindow && !pluginWindow.isDestroyed()) {
    pluginWindow.show()
    pluginWindow.focus()
    return
  }
  pluginWindow = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 720,
    minHeight: 520,
    title: 'DeepSeek Harness Desktop - 插件中心',
    parent: mainWindow,
    icon: projectPath('assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  })
  void pluginWindow.loadFile(path.join(__dirname, 'ui', 'plugin-center.html'))
  pluginWindow.on('closed', () => { pluginWindow = undefined })
}

function sendLog(record) {
  for (const window of [mainWindow, logWindow]) {
    if (window && !window.isDestroyed()) window.webContents.send('desktop:log', record)
  }
}

async function restartService() {
  if (serviceRestartPromise) return await serviceRestartPromise
  const restartPromise = (async () => {
    await showStartupPage()
    try {
      await service.restart()
      await showHarness()
      buildMenus()
      return service.status
    } catch (error) {
      logger.error(`Restart failed: ${error.message}`)
      throw error
    }
  })()
  serviceRestartPromise = restartPromise
  try {
    return await restartPromise
  } finally {
    if (serviceRestartPromise === restartPromise) serviceRestartPromise = undefined
  }
}

async function installHarnessUpdate(update) {
  if (updateInProgress) return
  updateInProgress = true
  if (service.mode === 'attached') {
    updateInProgress = false
    await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '无法更新运行时',
      message: '当前连接的是外部 Harness 实例。',
      detail: '请先关闭外部实例，再从桌面应用更新官方 Harness。',
    })
    return
  }
  const previousRuntime = runtimePath
  const previousVersion = runtimeVersionValue
  let serviceStopped = false
  try {
    await pluginManager.backup('before-harness-update')
    await showStartupPage()
    mainWindow?.webContents.send('desktop:update-progress', {
      phase: 'prepare', percent: 0, message: `正在准备 Harness ${update.latestVersion} 更新`,
    })
    const installed = await runtimeUpdater.install(update, {
      onProgress: progress => mainWindow?.webContents.send('desktop:update-progress', progress),
    })
    mainWindow?.webContents.send('desktop:update-progress', {
      phase: 'restart', percent: 97, message: '正在重启 Harness 服务',
    })
    await service.stop()
    serviceStopped = true
    runtimePath = installed.path
    runtimeVersionValue = installed.version
    deliverablesStatus = await applyDesktopDeliverablesPatch(runtimePath, logger, service.dshHome)
    service.dshEntry = path.join(runtimePath, 'lib', 'bin.js')
    service.patchFiles = deliverablesStatus?.patchFile ? [deliverablesStatus.patchFile] : []
    await service.start()
    await runtimeUpdater.markHealthy(runtimePath)
    await showHarness()
    buildMenus()
    await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Harness 更新完成',
      message: `官方 Harness ${installed.version} 已启用。`,
      detail: '项目数据、会话目录和模型配置保持不变。',
    })
  } catch (error) {
    logger.error(`Harness update activation failed: ${error.message}`, 'updater')
    await runtimeUpdater.rollbackPending()
    runtimePath = previousRuntime
    runtimeVersionValue = previousVersion
    service.dshEntry = path.join(runtimePath, 'lib', 'bin.js')
    if (serviceStopped) {
      try {
        await service.start()
        await showHarness()
        buildMenus()
      } catch (rollbackError) {
        logger.error(`Harness update rollback failed: ${rollbackError.message}`, 'updater')
      }
    } else {
      await showHarness()
    }
    throw error
  } finally {
    updateInProgress = false
  }
}

async function checkHarnessUpdate() {
  if (!runtimeUpdater) return
  if (updateInProgress) return
  const result = await runtimeUpdater.check(runtimeVersionValue)
  if (result.status === 'up-to-date') {
    await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Harness 已是最新版本',
      message: `当前官方 Harness 版本：${result.currentVersion}`,
      detail: '没有发现需要安装的官方运行时更新。',
    })
    return
  }
  if (result.status === 'update-available') {
    const answer = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '发现官方 Harness 更新',
      message: `${result.currentVersion} → ${result.latestVersion}`,
      detail: '应用将下载官方 Windows runtime，完成 SHA-256 校验后重启服务。项目会话与 DSH_HOME 不会被删除。',
      buttons: ['立即更新', '稍后'],
      defaultId: 0,
      cancelId: 1,
    })
    if (answer.response !== 0) return
    try {
      await installHarnessUpdate(result)
    } catch (error) {
      await dialog.showErrorBox('Harness 更新失败', `${error.message}\n\n原运行时已保留。`)
    }
    return
  }
  const detail = result.reason ?? '官方暂未提供可安装的 Windows runtime。'
  const answer = await dialog.showMessageBox(mainWindow, {
    type: result.status === 'error' ? 'warning' : 'info',
    title: '暂时没有可安装的官方更新',
    message: detail,
    detail: `当前版本：${runtimeVersionValue}\n更新页面：${result.releaseUrl}`,
    buttons: ['打开官方 Releases', '关闭'],
    defaultId: 0,
    cancelId: 1,
  })
  if (answer.response === 0) void shell.openExternal(result.releaseUrl)
}

function publishDesktopUpdate(status) {
  if (status.status === 'downloading') {
    const fraction = Number.isFinite(status.percent) ? status.percent / 100 : 2
    mainWindow?.setProgressBar(fraction)
    mainWindow?.webContents.send('desktop:app-update-progress', status)
    return
  }
  if (status.status === 'downloaded') {
    mainWindow?.setProgressBar(-1)
    mainWindow?.webContents.send('desktop:app-update-progress', status)
    void dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '桌面应用更新已就绪',
      message: `DeepSeek Harness Desktop ${status.version} 已下载。`,
      detail: '关闭并安装不会清理 DSH_HOME 中的会话、密钥、插件或记忆。',
      buttons: ['立即安装', '下次启动时安装'],
      defaultId: 0,
      cancelId: 1,
    }).then(answer => {
      if (answer.response === 0) desktopUpdater?.install()
    })
    return
  }
  if (status.status === 'available') {
    mainWindow?.webContents.send('desktop:app-update-progress', status)
    if (!desktopUpdatePrompted) {
      desktopUpdatePrompted = true
      new Notification({
        title: 'DeepSeek Harness Desktop 有新版本',
        body: `${status.version} 已可下载。可在“帮助”中安装。`,
      }).show()
    }
    return
  }
  if (status.status === 'error') {
    mainWindow?.setProgressBar(-1)
    mainWindow?.webContents.send('desktop:app-update-progress', status)
  }
}

async function checkDesktopUpdate({ manual = true } = {}) {
  if (!desktopUpdater) return
  const result = await desktopUpdater.check({ manual })
  if (!manual) return
  if (result.status === 'portable') {
    await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '便携版需手动更新',
      message: 'Portable 版本不会自动替换正在运行的可执行文件。',
      detail: '请从 GitHub Releases 下载新版本后替换原文件；DSH_HOME 数据不会受影响。',
    })
    return
  }
  if (result.status === 'disabled') {
    await dialog.showMessageBox(mainWindow, {
      type: 'info', title: '开发模式不检查桌面更新', message: '打包后的 Setup 版本会从 GitHub Releases 检查更新。',
    })
    return
  }
  if (result.status === 'up-to-date') {
    await dialog.showMessageBox(mainWindow, {
      type: 'info', title: '桌面应用已是最新版本', message: `当前版本：${app.getVersion()}`,
    })
    return
  }
  if (result.status === 'available') {
    const answer = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '发现桌面应用更新',
      message: `${app.getVersion()} → ${result.version}`,
      detail: '下载完成后由安装程序替换应用。Harness 运行时、会话、密钥、插件和记忆保持原样。',
      buttons: ['下载更新', '稍后'],
      defaultId: 0,
      cancelId: 1,
    })
    if (answer.response === 0) await desktopUpdater.download()
    return
  }
  if (result.status === 'error') {
    await dialog.showMessageBox(mainWindow, {
      type: 'warning', title: '桌面应用更新检查失败', message: result.message, detail: '当前版本和全部用户数据已保持不变。',
    })
  }
}

function buildMenus() {
  const openBrowser = () => {
    if (service.url) void shell.openExternal(service.url)
  }
  const openData = () => void shell.openPath(service.dshHome)
  const openLogs = () => void shell.openPath(path.dirname(logger.filePath))
  const restart = () => void restartService()
  const toggleVision = item => {
    visionEnabled = item.checked
    logger.info(`Vision evidence paste mode ${visionEnabled ? 'enabled' : 'disabled'}.`, 'vision')
    buildMenus()
  }
  const serviceLabel = service.mode === 'attached'
    ? `已挂接外部 Harness (${service.port})`
    : service.mode === 'managed'
      ? `本地服务运行中 (${service.port})`
      : '服务未运行'

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: '文件',
      submenu: [
        { label: '在浏览器中打开', click: openBrowser, enabled: Boolean(service.url) },
        { label: '打开数据目录', click: openData },
        { label: '打开日志目录', click: openLogs },
        { type: 'separator' },
        { label: '退出', click: () => { quitting = true; app.quit() } },
      ],
    },
    {
      label: '服务',
      submenu: [
        { label: serviceLabel, enabled: false },
        { label: '重启 / 重新连接', click: restart },
        { label: '查看启动日志', click: createLogWindow },
        { type: 'separator' },
        { label: '粘贴图片生成视觉证据', type: 'checkbox', checked: visionEnabled, click: toggleVision },
      ],
    },
    {
      label: '插件',
      submenu: [
        { label: '插件中心', click: createPluginCenter },
        { label: '备份插件配置', click: () => void pluginManager.backup('manual') },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载界面' },
        {
          label: `聊天文字大小 (${Math.round(displayPreferences.textScale * 100)}%)`,
          submenu: [
            { label: '缩小', accelerator: 'CommandOrControl+-', click: () => void setChatTextScale(nextTextScale(displayPreferences.textScale, -1)) },
            { label: '恢复默认', accelerator: 'CommandOrControl+0', click: () => void setChatTextScale(DEFAULT_TEXT_SCALE) },
            { label: '放大', accelerator: 'CommandOrControl+=', click: () => void setChatTextScale(nextTextScale(displayPreferences.textScale, 1)) },
          ],
        },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        { label: 'DeepSeek Harness 项目', click: () => void shell.openExternal('https://github.com/deepseek-ai/deepseek-harness') },
        { label: '检查桌面应用更新', click: () => void checkDesktopUpdate({ manual: true }) },
        { label: '检查官方 Harness 更新', click: () => void checkHarnessUpdate() },
        { label: '关于', click: () => app.showAboutPanel() },
      ],
    },
  ]))

  if (!tray) return
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示窗口', click: () => { mainWindow?.show(); mainWindow?.focus() } },
    { label: serviceLabel, enabled: false },
    { type: 'separator' },
    { label: '在浏览器中打开', click: openBrowser, enabled: Boolean(service.url) },
    { label: '重启 / 重新连接', click: restart },
    { label: '查看启动日志', click: createLogWindow },
    { label: '打开数据目录', click: openData },
    { label: '打开日志目录', click: openLogs },
    { label: '粘贴图片生成视觉证据', type: 'checkbox', checked: visionEnabled, click: toggleVision },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; app.quit() } },
  ]))
}

function createTray() {
  const iconPath = projectPath('assets', 'icon.png')
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 20, height: 20 })
  tray = new Tray(icon)
  tray.setToolTip('DeepSeek Harness Desktop')
  tray.on('double-click', () => { mainWindow?.show(); mainWindow?.focus() })
  buildMenus()
}

function registerIpc() {
  ipcMain.handle('desktop:get-state', () => ({
    service: service.status,
    logs: logger.snapshot(),
    logFile: logger.filePath,
    visionEnabled,
  }))
  ipcMain.handle('desktop:restart', restartService)
  ipcMain.handle('desktop:open-browser', () => service.url ? shell.openExternal(service.url) : undefined)
  ipcMain.handle('desktop:open-data-directory', () => shell.openPath(service.dshHome))
  ipcMain.handle('desktop:open-log-directory', () => shell.openPath(path.dirname(logger.filePath)))
  ipcMain.handle('desktop:check-app-update', () => checkDesktopUpdate({ manual: true }))
  ipcMain.handle('desktop:set-chat-text-scale', (_event, textScale) => setChatTextScale(textScale))
  ipcMain.handle('desktop:get-plugin-inventory', () => pluginManager.inventory({ runtimePath, runtimeVersion: runtimeVersionValue, deliverables: deliverablesStatus }))
  ipcMain.handle('desktop:backup-plugin-state', () => pluginManager.backup('manual'))
  ipcMain.handle('desktop:open-plugin-backups', () => shell.openPath(pluginManager.backupDirectory()))
  ipcMain.handle('vision:is-enabled', () => visionEnabled)
  ipcMain.handle('vision:analyze', (_event, payload) => vision.analyze(payload))
}

async function boot() {
  app.setAppUserModelId('ai.deepseek.harness.desktop')
  app.setAboutPanelOptions({
    applicationName: 'DeepSeek Harness Desktop',
    applicationVersion: app.getVersion(),
    copyright: 'MIT licensed desktop carrier. DeepSeek Harness is an official DeepSeek project.',
  })
  const logDirectory = path.join(app.getPath('userData'), 'logs')
  const cacheDirectory = path.join(app.getPath('userData'), 'vision-cache')
  mkdirSync(logDirectory, { recursive: true })
  const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  mkdirSync(dshHome, { recursive: true })
  const nodeExecutable = !app.isPackaged && process.env.DHD_NODE_EXECUTABLE
    ? path.resolve(process.env.DHD_NODE_EXECUTABLE)
    : bundledPath('node', 'node.exe')
  const npmCli = await extractNpmRuntime(bundledPath('node', 'npm-runtime.tar.gz'), app.getPath('userData'), logger)
  const workspace = process.env.DSH_CWD ? path.resolve(process.env.DSH_CWD) : os.homedir()

  logger = new AppLogger(logDirectory)
  logger.on('record', sendLog)
  pluginManager = new DesktopPluginManager({ dshHome, userData: app.getPath('userData'), logger })
  displayPreferences = await readDisplayPreferences(app.getPath('userData'))
  desktopUpdater = new DesktopAppUpdater({
    autoUpdater,
    userData: app.getPath('userData'),
    isPackaged: app.isPackaged,
    logger,
    onStatus: publishDesktopUpdate,
  })
  desktopUpdater.configure()
  fallbackRuntimePath = await ensureHarnessRuntime({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    userData: app.getPath('userData'),
    developmentRuntime: bundledPath('harness'),
    logger,
  })
  runtimeUpdater = new HarnessRuntimeUpdater({
    userData: app.getPath('userData'), logger, nodeExecutable, npmCli,
    patchRuntime: candidate => applyDesktopDeliverablesPatch(candidate, logger, dshHome),
  })
  runtimePath = await runtimeUpdater.resolveSelected(fallbackRuntimePath, runtimeVersion(fallbackRuntimePath))
  deliverablesStatus = await applyDesktopDeliverablesPatch(runtimePath, logger, dshHome)
  if (deliverablesStatus.status === 'incompatible') logger.warn(`Clickable deliverables unavailable: ${deliverablesStatus.reason}`, 'plugins')
  runtimeVersionValue = runtimeVersion(runtimePath) || runtimeVersion(fallbackRuntimePath)
  const dshEntry = !app.isPackaged && process.env.DHD_DSH_ENTRY
    ? path.resolve(process.env.DHD_DSH_ENTRY)
    : path.join(runtimePath, 'lib', 'bin.js')
  service = new HarnessServiceManager({
    nodeExecutable, dshEntry, dshHome, cwd: workspace, logger,
    patchFiles: deliverablesStatus?.patchFile ? [deliverablesStatus.patchFile] : [],
  })
  vision = new VisionBridge({ cacheDirectory, scriptPath: ocrScriptPath(), logger })
  service.on('exit', ({ expected }) => {
    buildMenus()
    if (!expected && !quitting) void showStartupPage()
  })

  createWindow()
  createTray()
  registerIpc()
  await showStartupPage()
  logger.info(`DeepSeek Harness Desktop ${app.getVersion()} starting.`)
  setTimeout(() => { void checkDesktopUpdate({ manual: false }) }, 10_000)
  setInterval(() => { void checkDesktopUpdate({ manual: false }) }, 6 * 60 * 60 * 1000).unref()
  try {
    await service.start()
    await runtimeUpdater.markHealthy(runtimePath)
    await showHarness()
    buildMenus()
  } catch (error) {
    logger.error(`Startup failed: ${error.message}`)
    const fallback = await runtimeUpdater.rollbackPending()
    if (fallback || path.resolve(runtimePath) !== path.resolve(fallbackRuntimePath)) {
      runtimePath = fallback || fallbackRuntimePath
      runtimeVersionValue = runtimeVersion(runtimePath)
      service.dshEntry = path.join(runtimePath, 'lib', 'bin.js')
      try {
        await service.start()
        await runtimeUpdater.markHealthy(runtimePath)
        await showHarness()
      } catch (fallbackError) {
        logger.error(`Bundled Harness fallback failed: ${fallbackError.message}`)
      }
    }
    buildMenus()
  }
}

app.whenReady().then(boot)

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
})

app.on('before-quit', event => {
  if (quitting && service?.child === undefined) return
  event.preventDefault()
  quitting = true
  void service?.stop().finally(() => app.quit())
})

app.on('window-all-closed', () => {})

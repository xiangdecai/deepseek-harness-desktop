'use strict'

const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, Tray } = require('electron')
const { mkdirSync } = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { AppLogger } = require('./logger.cjs')
const { HarnessServiceManager } = require('./service-manager.cjs')
const { ensureHarnessRuntime } = require('./runtime-loader.cjs')
const { HarnessRuntimeUpdater, extractNpmRuntime, runtimeVersion } = require('./runtime-updater.cjs')
const { VisionBridge } = require('./vision-bridge.cjs')

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()

let mainWindow
let logWindow
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
    width: 1220,
    height: 820,
    minWidth: 820,
    minHeight: 600,
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

async function showStartupPage(target = mainWindow) {
  if (target?.isDestroyed() !== false) return
  await target.loadFile(path.join(__dirname, 'ui', 'startup.html'))
}

async function showHarness() {
  if (!mainWindow || mainWindow.isDestroyed() || !service.url) return
  await mainWindow.loadURL(service.url)
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

function sendLog(record) {
  for (const window of [mainWindow, logWindow]) {
    if (window && !window.isDestroyed()) window.webContents.send('desktop:log', record)
  }
}

async function restartService() {
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
    service.dshEntry = path.join(runtimePath, 'lib', 'bin.js')
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
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载界面' },
        { role: 'resetZoom', label: '重置缩放' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        { label: 'DeepSeek Harness 项目', click: () => void shell.openExternal('https://github.com/deepseek-ai/deepseek-harness') },
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
  fallbackRuntimePath = await ensureHarnessRuntime({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    userData: app.getPath('userData'),
    developmentRuntime: bundledPath('harness'),
    logger,
  })
  runtimeUpdater = new HarnessRuntimeUpdater({ userData: app.getPath('userData'), logger, nodeExecutable, npmCli })
  runtimePath = await runtimeUpdater.resolveSelected(fallbackRuntimePath, runtimeVersion(fallbackRuntimePath))
  runtimeVersionValue = runtimeVersion(runtimePath) || runtimeVersion(fallbackRuntimePath)
  const dshEntry = !app.isPackaged && process.env.DHD_DSH_ENTRY
    ? path.resolve(process.env.DHD_DSH_ENTRY)
    : path.join(runtimePath, 'lib', 'bin.js')
  service = new HarnessServiceManager({ nodeExecutable, dshEntry, dshHome, cwd: workspace, logger })
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

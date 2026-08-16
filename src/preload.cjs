'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('harnessDesktop', {
  getState: () => ipcRenderer.invoke('desktop:get-state'),
  restart: () => ipcRenderer.invoke('desktop:restart'),
  openBrowser: () => ipcRenderer.invoke('desktop:open-browser'),
  openDataDirectory: () => ipcRenderer.invoke('desktop:open-data-directory'),
  openLogDirectory: () => ipcRenderer.invoke('desktop:open-log-directory'),
  onLog: callback => {
    const listener = (_event, record) => callback(record)
    ipcRenderer.on('desktop:log', listener)
    return () => ipcRenderer.removeListener('desktop:log', listener)
  },
})

async function insertEvidence(target, evidence) {
  const text = `\n\n${JSON.stringify(evidence, null, 2)}\n`
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
    const start = target.selectionStart ?? target.value.length
    const end = target.selectionEnd ?? start
    target.setRangeText(text, start, end, 'end')
    target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
    return true
  }
  if (target instanceof HTMLElement && target.isContentEditable) {
    target.focus()
    document.execCommand('insertText', false, text)
    target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
    return true
  }
  return false
}

function showVisionStatus(message, tone = 'working') {
  let toast = document.getElementById('__dhd-vision-status')
  if (toast === null) {
    toast = document.createElement('div')
    toast.id = '__dhd-vision-status'
    Object.assign(toast.style, {
      position: 'fixed',
      top: '16px',
      right: '16px',
      zIndex: '2147483647',
      padding: '9px 12px',
      borderRadius: '6px',
      color: '#ffffff',
      font: '13px/1.4 "Segoe UI", sans-serif',
      boxShadow: '0 8px 24px rgba(0, 0, 0, .18)',
      pointerEvents: 'none',
    })
    document.documentElement.appendChild(toast)
  }
  toast.style.background = tone === 'error' ? '#b42318' : tone === 'done' ? '#16784b' : '#2557a7'
  toast.textContent = message
  toast.style.display = 'block'
  if (tone !== 'working') setTimeout(() => { toast.style.display = 'none' }, 3500)
}

window.addEventListener('DOMContentLoaded', () => {
  if (location.hostname !== '127.0.0.1') return
  document.addEventListener('paste', async event => {
    const enabled = await ipcRenderer.invoke('vision:is-enabled')
    if (!enabled) return
    const imageItem = [...(event.clipboardData?.items ?? [])].find(item => item.kind === 'file' && item.type.startsWith('image/'))
    if (imageItem === undefined) return
    const file = imageItem.getAsFile()
    if (file === null) return
    event.preventDefault()
    const target = event.target
    showVisionStatus('正在提取图片证据…')
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const evidence = await ipcRenderer.invoke('vision:analyze', { bytes, mimeType: file.type })
      const inserted = await insertEvidence(target, evidence)
      if (!inserted) await navigator.clipboard.writeText(JSON.stringify(evidence, null, 2))
      showVisionStatus(inserted ? '视觉证据已插入' : '视觉证据已复制到剪贴板', 'done')
    } catch (error) {
      showVisionStatus(`视觉证据失败：${error.message}`, 'error')
    }
  }, { capture: true })
})


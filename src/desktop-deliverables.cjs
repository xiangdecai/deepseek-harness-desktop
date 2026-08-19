'use strict'

const { existsSync } = require('node:fs')
const { mkdir, readFile, writeFile } = require('node:fs/promises')
const path = require('node:path')

const DELIVERABLES_CLIENT = path.join('node_modules', '@deepseek-ai', 'dsh-client-ui-deliverables', 'lib', 'client.js')
const DELIVERABLES_INDEX = path.join('node_modules', '@deepseek-ai', 'dsh-client-ui-deliverables', 'lib', 'index.js')
const DESKTOP_DELIVERABLES_CLIENT = path.join('node_modules', '@xiangong', 'dsh-client-ui-deliverables', 'lib', 'client.js')
const DESKTOP_DELIVERABLES_INDEX = path.join('node_modules', '@xiangong', 'dsh-client-ui-deliverables', 'lib', 'index.js')
const DESKTOP_DELIVERABLES_MANIFEST = path.join('node_modules', '@xiangong', 'dsh-client-ui-deliverables', 'package.json')
const PATCH_ID = 'xiangong-desktop-deliverables-v1'

function commonDir(paths) {
  if (!Array.isArray(paths) || paths.length === 0) return '.'
  const directories = paths.map(value => {
    const normalized = String(value ?? '').replace(/\\/gu, '/').replace(/\/+$/u, '')
    const boundary = normalized.lastIndexOf('/')
    return boundary < 0 ? '.' : normalized.slice(0, boundary + 1).replace(/\/$/u, '') || '/'
  })
  const split = directory => directory.split('/').filter((part, index) => part.length > 0 || index === 0)
  let shared = split(directories[0])
  for (const directory of directories.slice(1)) {
    const parts = split(directory)
    let count = 0
    while (count < shared.length && count < parts.length && shared[count].toLowerCase() === parts[count].toLowerCase()) count += 1
    shared = shared.slice(0, count)
  }
  if (shared.length === 0) return '.'
  const first = directories[0]
  const joined = shared.join('/')
  if (/^[A-Za-z]:$/u.test(joined)) return `${joined}/`
  if (first.startsWith('//')) return `//${joined.replace(/^\/+/, '')}`
  if (first.startsWith('/')) return `/${joined.replace(/^\/+/, '')}`
  return joined || '.'
}

function patchSource(source) {
  if (source.includes(PATCH_ID)) return { source, changed: false }
  const limitMarker = 'const SHOWN_LIMIT = 6;'
  const capabilityMarker = 'const canOpenPath = isLoopback && hostCanOpenPath;'
  const visibleMarker = 'hidden > 0 && canOpenPath && (0, react_jsx_runtime.jsx)("button", {'
  const openMarker = 'openFile(".");'
  if (!source.includes(limitMarker) || !source.includes(capabilityMarker) || !source.includes(visibleMarker) || !source.includes(openMarker)) {
    throw new Error('official ui-deliverables layout is not compatible with the desktop patch')
  }
  const helper = `\n/* ${PATCH_ID}: desktop-only presentation enhancement; Host policy still opens paths. */\nfunction desktopCommonDir(paths) {\n  if (!Array.isArray(paths) || paths.length === 0) return ".";\n  const dirs = paths.map(value => { const normalized = String(value ?? "").replace(/\\\\/g, "/").replace(/\\/+$/g, ""); const boundary = normalized.lastIndexOf("/"); return boundary < 0 ? "." : normalized.slice(0, boundary + 1).replace(/\\/$/, "") || "/"; });\n  const split = directory => directory.split("/").filter((part, index) => part.length > 0 || index === 0);\n  let shared = split(dirs[0]);\n  for (const directory of dirs.slice(1)) { const parts = split(directory); let count = 0; while (count < shared.length && count < parts.length && shared[count].toLowerCase() === parts[count].toLowerCase()) count += 1; shared = shared.slice(0, count); }\n  if (shared.length === 0) return ".";\n  const first = dirs[0]; const joined = shared.join("/");\n  if (/^[A-Za-z]:$/.test(joined)) return joined + "/";\n  if (first.startsWith("//")) return "//" + joined.replace(/^\\/+/, "");\n  if (first.startsWith("/")) return "/" + joined.replace(/^\\/+/, "");\n  return joined || ".";\n}\n`
  let next = source.replace(limitMarker, `${limitMarker}${helper}`)
  next = next.replace(capabilityMarker, `${capabilityMarker}\n\t\tconst folderPath = desktopCommonDir(paths);`)
  next = next.replace(visibleMarker, 'canOpenPath && (0, react_jsx_runtime.jsx)("button", {')
  next = next.replace(openMarker, 'openFile(folderPath);')
  return { source: next, changed: true }
}

async function applyDesktopDeliverablesPatch(runtimePath, logger, dshHome) {
  const sourceFile = path.join(runtimePath, DELIVERABLES_CLIENT)
  const sourceIndex = path.join(runtimePath, DELIVERABLES_INDEX)
  const target = path.join(runtimePath, DESKTOP_DELIVERABLES_CLIENT)
  if (!existsSync(sourceFile) || !existsSync(sourceIndex)) return { status: 'unavailable', reason: 'official ui-deliverables package is missing' }
  try {
    const source = await readFile(sourceFile, 'utf8')
    const result = patchSource(source)
    const client = result.source.replace('id: "@deepseek-ai/dsh-client-ui-deliverables"', 'id: "@xiangong/dsh-client-ui-deliverables"')
    if (!client.includes('id: "@xiangong/dsh-client-ui-deliverables"')) throw new Error('official ui-deliverables module id changed')
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, client, 'utf8')
    await writeFile(path.join(runtimePath, DESKTOP_DELIVERABLES_INDEX), await readFile(sourceIndex, 'utf8'), 'utf8')
    await writeFile(path.join(runtimePath, DESKTOP_DELIVERABLES_MANIFEST), `${JSON.stringify({
      name: '@xiangong/dsh-client-ui-deliverables', version: '1.0.0', private: true, type: 'module',
      description: 'Xiangong Desktop clickable deliverables overlay',
      main: './lib/index.js', exports: { '.': './lib/index.js', './client': './lib/client.js' },
      dsh: { client: { inject: [
        '@deepseek-ai/dsh-client-connection', '@deepseek-ai/dsh-client-locale',
        '@deepseek-ai/dsh-client-runtime', '@deepseek-ai/dsh-client-ui-conversation',
      ], platform: 'web' } },
    }, null, 2)}\n`, 'utf8')
    if (!dshHome) throw new Error('DSH_HOME is required to prepare the desktop client plugin')
    const profilePackage = path.join(dshHome, 'profiles', 'web', 'node_modules', '@xiangong', 'dsh-client-ui-deliverables')
    await mkdir(path.join(profilePackage, 'lib'), { recursive: true })
    await writeFile(path.join(profilePackage, 'lib', 'client.js'), client, 'utf8')
    await writeFile(path.join(profilePackage, 'lib', 'index.js'), await readFile(sourceIndex, 'utf8'), 'utf8')
    await writeFile(path.join(profilePackage, 'package.json'), await readFile(path.join(runtimePath, DESKTOP_DELIVERABLES_MANIFEST), 'utf8'), 'utf8')
    const patchFile = path.join(runtimePath, 'desktop-deliverables.cordis.patch.yml')
    await writeFile(patchFile, [
      '# Desktop-owned overlay. The package files live under the web profile only',
      '# so Cordis can resolve the client bundle without changing user manifests.',
      '- id: ui-deliverables',
      '  disabled: true',
      '- insert:',
      '    - id: xiangong-ui-deliverables',
      "      name: '@xiangong/dsh-client-ui-deliverables'",
      '',
    ].join('\n'), 'utf8')
    logger?.info('Desktop deliverables Cordis plugin prepared.', 'plugins')
    return { status: 'ready', changed: true, patch: PATCH_ID, package: '@xiangong/dsh-client-ui-deliverables', patchFile }
  } catch (error) {
    logger?.warn(`Desktop deliverables extension was not applied: ${error.message}`, 'plugins')
    return { status: 'incompatible', reason: error.message, patch: PATCH_ID }
  }
}

module.exports = { PATCH_ID, applyDesktopDeliverablesPatch, commonDir, patchSource }

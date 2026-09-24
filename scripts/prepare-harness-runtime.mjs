import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import https from 'node:https'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const staging = resolve(root, 'resources', 'harness')
const licenses = resolve(root, 'resources', 'licenses')
const pnpmCli = resolve(root, 'resources', 'pnpm-runtime', 'pnpm', 'bin', 'pnpm.cjs')
const harnessVersion = process.env.DHD_HARNESS_VERSION ?? '0.1.7-rc.1'
const packageName = '@deepseek-ai/dsh'

async function installedPackageManifests(nodeModules) {
  const manifests = []
  const visited = new Set()
  async function visit(directory) {
    const resolvedDirectory = resolve(directory)
    if (visited.has(resolvedDirectory) || !existsSync(resolvedDirectory)) return
    visited.add(resolvedDirectory)
    const packageDirectories = []
    for (const entry of await readdir(resolvedDirectory, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      const entryPath = join(resolvedDirectory, entry.name)
      if (!entry.name.startsWith('@')) {
        if (existsSync(join(entryPath, 'package.json'))) packageDirectories.push(entryPath)
        continue
      }
      if (!entry.isDirectory()) continue
      for (const child of await readdir(entryPath, { withFileTypes: true })) {
        const childPath = join(entryPath, child.name)
        if (existsSync(join(childPath, 'package.json'))) packageDirectories.push(childPath)
      }
    }
    for (const packageDirectory of packageDirectories) {
      manifests.push(join(packageDirectory, 'package.json'))
      await visit(join(packageDirectory, 'node_modules'))
    }
  }
  await visit(nodeModules)
  return manifests
}

function runNode(args, cwd) {
  return new Promise((resolvePromise, reject) => {
    console.log([process.execPath, ...args].join(' '))
    const child = spawn(process.execPath, args, {
      cwd,
      stdio: 'inherit',
      env: { ...process.env, CI: 'true', NPM_CONFIG_UPDATE_NOTIFIER: 'false' },
      windowsHide: true,
    })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolvePromise() : reject(new Error(`Bundled pnpm exited with code ${code}`)))
  })
}

function fetchText(url) {
  return new Promise((resolvePromise, reject) => {
    const request = https.get(url, { headers: { 'User-Agent': 'X-DSH-Desktop-Build' } }, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume()
        fetchText(response.headers.location).then(resolvePromise, reject)
        return
      }
      if ((response.statusCode ?? 500) < 200 || (response.statusCode ?? 500) >= 300) {
        response.resume()
        reject(new Error(`Download failed with HTTP ${response.statusCode}: ${url}`))
        return
      }
      let body = ''
      response.setEncoding('utf8')
      response.on('data', chunk => { body += chunk })
      response.once('end', () => resolvePromise(body))
    })
    request.once('error', reject)
    request.setTimeout(30_000, () => request.destroy(new Error(`Download timed out: ${url}`)))
  })
}

if (!existsSync(pnpmCli)) throw new Error(`Bundled pnpm is missing at ${pnpmCli}`)

await rm(staging, { recursive: true, force: true })
await mkdir(staging, { recursive: true })
await writeFile(join(staging, 'package.json'), `${JSON.stringify({
  name: 'x-dsh-desktop-bundled-runtime',
  version: '0.0.0',
  private: true,
}, null, 2)}\n`, 'utf8')

await runNode([
  pnpmCli,
  'add', '--dir', staging,
  '--prod', '--ignore-scripts', '--no-lockfile',
  '--config.node-linker=hoisted',
  `${packageName}@${harnessVersion}`,
], staging)

const packageRoot = join(staging, 'node_modules', '@deepseek-ai', 'dsh')
const packageManifestPath = join(packageRoot, 'package.json')
if (!existsSync(join(packageRoot, 'lib', 'bin.js'))) {
  throw new Error(`Official Harness ${harnessVersion} package has no lib/bin.js`)
}
const manifest = JSON.parse(await readFile(packageManifestPath, 'utf8'))
if (manifest.version !== harnessVersion) {
  throw new Error(`Expected Harness ${harnessVersion}, pnpm installed ${manifest.version}`)
}

if (existsSync(join(packageRoot, 'config'))) {
  await cp(join(packageRoot, 'config'), join(staging, 'config'), { recursive: true })
}
for (const file of ['package.json', 'README.md', 'README.zh.md', 'README.i18n.yaml', 'LICENSE']) {
  const source = join(packageRoot, file)
  if (existsSync(source)) await cp(source, join(staging, file))
}
await mkdir(join(staging, 'lib'), { recursive: true })
await writeFile(join(staging, 'lib', 'bin.js'), "import '../node_modules/@deepseek-ai/dsh/lib/bin.js'\n", 'utf8')

const required = [
  join(staging, 'lib', 'bin.js'),
  join(staging, 'node_modules', '@deepseek-ai', 'dsh-web-frontend', 'dist', 'index.html'),
]
for (const file of required) {
  if (!existsSync(file)) throw new Error(`Staged Harness runtime is incomplete: ${file}`)
}

await mkdir(licenses, { recursive: true })
await cp(join(packageRoot, 'LICENSE'), join(licenses, 'DeepSeek-Harness-LICENSE'))
let thirdPartyNotices
const explicitSource = process.env.DEEPSEEK_HARNESS_SOURCE
if (explicitSource && existsSync(join(resolve(explicitSource), 'THIRD_PARTY_NOTICES.md'))) {
  thirdPartyNotices = await readFile(join(resolve(explicitSource), 'THIRD_PARTY_NOTICES.md'), 'utf8')
} else {
  thirdPartyNotices = await fetchText(`https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/v${harnessVersion}/THIRD_PARTY_NOTICES.md`)
    .catch(() => fetchText('https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/THIRD_PARTY_NOTICES.md'))
}
await writeFile(join(licenses, 'DeepSeek-Harness-THIRD_PARTY_NOTICES.md'), thirdPartyNotices, 'utf8')
await writeFile(join(root, 'THIRD_PARTY_NOTICES.md'), thirdPartyNotices, 'utf8')
const dependencies = new Map()
for (const manifestPath of await installedPackageManifests(join(staging, 'node_modules'))) {
  const dependency = JSON.parse(await readFile(manifestPath, 'utf8'))
  const name = dependency.name ?? '(unnamed)'
  const version = dependency.version ?? '(unknown)'
  dependencies.set(`${name}@${version}`, `| ${name} | ${version} | ${dependency.license ?? 'SEE PACKAGE'} |`)
}
const dependencyRows = [...dependencies.values()]
dependencyRows.sort((left, right) => left.localeCompare(right))
await writeFile(join(licenses, `Harness-Runtime-${harnessVersion}-Dependencies.md`), [
  `# Harness runtime ${harnessVersion} installed dependency closure`,
  '',
  'Generated from the exact hoisted node_modules closure shipped by X DSH Desktop.',
  '',
  '| Package | Version | License |',
  '|---|---:|---|',
  ...dependencyRows,
  '',
].join('\n'), 'utf8')
await writeFile(join(staging, 'desktop-runtime.json'), `${JSON.stringify({
  harness_version: manifest.version,
  cordis_profile: 'official-web',
  source: 'npm:@deepseek-ai/dsh',
  built_at: new Date().toISOString(),
}, null, 2)}\n`, 'utf8')

console.log(`Prepared official Harness runtime ${manifest.version} at ${staging}`)

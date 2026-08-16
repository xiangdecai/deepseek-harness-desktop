import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const defaultSource = resolve(root, '..', '.h0', 'deepseek-harness-master', 'deepseek-harness-master')
const source = resolve(process.env.DEEPSEEK_HARNESS_SOURCE ?? defaultSource)
const staging = resolve(root, 'resources', 'harness')
const licenses = resolve(root, 'resources', 'licenses')

if (!existsSync(join(source, 'apps', 'cli', 'package.json'))) {
  throw new Error(`DeepSeek Harness source is missing at ${source}`)
}

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    console.log([command, ...args].join(' '))
    const child = spawn(command, args, {
      cwd: source,
      stdio: 'inherit',
      env: { ...process.env, CI: 'true' },
      windowsHide: true,
      shell: process.platform === 'win32',
    })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolvePromise() : reject(new Error(`${command} exited with code ${code}`)))
  })
}

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
if (process.env.DHD_SKIP_HARNESS_BUILD !== '1') {
  await run(pnpm, ['run', 'build:lib'])
  await run(pnpm, ['--filter', '@deepseek-ai/dsh-web-frontend', 'run', 'build'])
}

await rm(staging, { recursive: true, force: true })
await run(pnpm, [
  '--filter', '@deepseek-ai/dsh',
  'deploy', '--legacy', '--prod',
  '--config.node-linker=hoisted',
  '--config.auto-install-peers=false',
  '--config.link-workspace-packages=true',
  staging,
])

const manifest = JSON.parse(await readFile(join(staging, 'package.json'), 'utf8'))
const cliNodeModules = join(source, 'apps', 'cli', 'node_modules')
const rootNodeModules = join(source, 'node_modules')
const pnpmHoists = join(rootNodeModules, '.pnpm', 'node_modules')
const restored = []

async function deployedPackageDirectories() {
  const directories = []
  for (const entry of await readdir(join(staging, 'node_modules'), { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === '.pnpm' || entry.name === '.bin') continue
    const entryPath = join(staging, 'node_modules', entry.name)
    if (!entry.name.startsWith('@')) {
      directories.push(entryPath)
      continue
    }
    for (const scoped of await readdir(entryPath, { withFileTypes: true })) {
      if (scoped.isDirectory()) directories.push(join(entryPath, scoped.name))
    }
  }
  return directories
}

async function restoreDependency(dependency, required) {
  const destination = join(staging, 'node_modules', dependency)
  if (existsSync(destination)) return false
  const candidates = [
    join(cliNodeModules, dependency),
    join(rootNodeModules, dependency),
    join(pnpmHoists, dependency),
  ]
  const sourcePackage = candidates.find(candidate => existsSync(candidate))
  if (!sourcePackage) {
    if (required) throw new Error(`Deployed dependency is missing from the source workspace: ${dependency}`)
    return false
  }
  const physicalSource = await realpath(sourcePackage)
  await mkdir(dirname(destination), { recursive: true })
  const nestedNodeModules = join(physicalSource, 'node_modules')
  await cp(physicalSource, destination, {
    recursive: true,
    dereference: true,
    filter: candidate => candidate !== nestedNodeModules && !candidate.startsWith(nestedNodeModules + sep),
  })
  restored.push(dependency)
  return true
}

for (const dependency of Object.keys(manifest.dependencies ?? {}).sort()) {
  await restoreDependency(dependency, true)
}

let addedInPass = true
while (addedInPass) {
  addedInPass = false
  for (const packageDirectory of await deployedPackageDirectories()) {
    const packageJson = join(packageDirectory, 'package.json')
    if (!existsSync(packageJson)) continue
    const packageManifest = JSON.parse(await readFile(packageJson, 'utf8'))
    for (const dependency of Object.keys(packageManifest.dependencies ?? {}).sort()) {
      if (await restoreDependency(dependency, true)) addedInPass = true
    }
    for (const dependency of Object.keys(packageManifest.optionalDependencies ?? {}).sort()) {
      if (await restoreDependency(dependency, false)) addedInPass = true
    }
    for (const dependency of Object.keys(packageManifest.peerDependencies ?? {}).sort()) {
      if (await restoreDependency(dependency, false)) addedInPass = true
    }
  }
}
if (restored.length > 0) console.log(`Restored legacy hoists: ${restored.join(', ')}`)

async function findLink(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const candidate = join(directory, entry.name)
    const metadata = await lstat(candidate)
    if (metadata.isSymbolicLink()) return candidate
    if (metadata.isDirectory()) {
      const nested = await findLink(candidate)
      if (nested) return nested
    }
  }
  return undefined
}

const nodeModules = join(staging, 'node_modules')
let link = await findLink(nodeModules)
while (link) {
  const segments = link.slice(nodeModules.length + 1).split(sep)
  const binIndex = segments.lastIndexOf('.bin')
  if (binIndex >= 0) {
    await rm(join(nodeModules, ...segments.slice(0, binIndex + 1)), { recursive: true, force: true })
  } else {
    const sourcePackage = await realpath(link)
    const nestedNodeModules = join(sourcePackage, 'node_modules')
    await rm(link, { recursive: true, force: true })
    await cp(sourcePackage, link, {
      recursive: true,
      dereference: true,
      filter: candidate => candidate !== nestedNodeModules && !candidate.startsWith(nestedNodeModules + sep),
    })
  }
  link = await findLink(nodeModules)
}

const required = [
  join(staging, 'lib', 'bin.js'),
  join(staging, 'node_modules', '@deepseek-ai', 'dsh-web-frontend', 'dist', 'index.html'),
]
for (const file of required) {
  if (!existsSync(file)) throw new Error(`Staged Harness runtime is incomplete: ${file}`)
}

await mkdir(licenses, { recursive: true })
await cp(join(source, 'LICENSE'), join(licenses, 'DeepSeek-Harness-LICENSE'))
await cp(join(source, 'THIRD_PARTY_NOTICES.md'), join(licenses, 'DeepSeek-Harness-THIRD_PARTY_NOTICES.md'))
await cp(join(source, 'THIRD_PARTY_NOTICES.md'), join(root, 'THIRD_PARTY_NOTICES.md'))
await writeFile(join(staging, 'desktop-runtime.json'), `${JSON.stringify({
  harness_version: manifest.version,
  cordis_profile: 'official-web',
  source: 'deepseek-ai/deepseek-harness',
  built_at: new Date().toISOString(),
}, null, 2)}\n`)
console.log(`Prepared official Harness runtime ${manifest.version} at ${staging}`)

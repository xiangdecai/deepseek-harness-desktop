import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import extract from 'extract-zip'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const version = process.env.DHD_NODE_VERSION ?? '24.19.0'
const archiveName = `node-v${version}-win-x64.zip`
const baseUrl = `https://nodejs.org/dist/v${version}`
const destination = resolve(root, 'resources', 'node')
const downloadDirectory = resolve(root, '.downloads')
const archivePath = resolve(downloadDirectory, archiveName)
const extractDirectory = resolve(downloadDirectory, `node-v${version}-win-x64`)

if (existsSync(resolve(destination, 'node.exe'))) {
  console.log(`Bundled node.exe already exists at ${destination}; set DHD_FORCE_RUNTIME=1 to refresh.`)
  if (process.env.DHD_FORCE_RUNTIME !== '1') process.exit(0)
}

await mkdir(downloadDirectory, { recursive: true })
const [sumsResponse, archiveResponse] = await Promise.all([
  fetch(`${baseUrl}/SHASUMS256.txt`),
  fetch(`${baseUrl}/${archiveName}`),
])
if (!sumsResponse.ok) throw new Error(`Failed to download Node checksums: HTTP ${sumsResponse.status}`)
if (!archiveResponse.ok) throw new Error(`Failed to download Node archive: HTTP ${archiveResponse.status}`)
const sums = await sumsResponse.text()
const expected = sums.split(/\r?\n/u).find(line => line.endsWith(`  ${archiveName}`))?.split(/\s+/u)[0]
if (!expected) throw new Error(`Checksum for ${archiveName} is absent from SHASUMS256.txt`)
const bytes = Buffer.from(await archiveResponse.arrayBuffer())
const actual = createHash('sha256').update(bytes).digest('hex')
if (actual !== expected) throw new Error(`Node archive checksum mismatch: expected ${expected}, got ${actual}`)
await writeFile(archivePath, bytes)

await rm(extractDirectory, { recursive: true, force: true })
await extract(archivePath, { dir: downloadDirectory })
await rm(destination, { recursive: true, force: true })
await mkdir(destination, { recursive: true })
await cp(resolve(extractDirectory, 'node.exe'), resolve(destination, 'node.exe'))
await cp(resolve(extractDirectory, 'LICENSE'), resolve(destination, 'LICENSE'))
await cp(resolve(extractDirectory, 'node_modules', 'npm'), resolve(destination, 'node_modules', 'npm'), { recursive: true })
await cp(resolve(extractDirectory, 'npm.cmd'), resolve(destination, 'npm.cmd'))
await cp(resolve(extractDirectory, 'npx.cmd'), resolve(destination, 'npx.cmd'))
const npmArchive = resolve(destination, 'npm-runtime.tar.gz')
const tar = resolve(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
await new Promise((resolvePromise, reject) => {
  const child = spawn(tar, ['-czf', npmArchive, '-C', destination, 'node_modules/npm'], { windowsHide: true, stdio: 'ignore' })
  child.once('error', reject)
  child.once('exit', code => code === 0 ? resolvePromise() : reject(new Error(`npm runtime archive failed with code ${code}`)))
})
await rm(resolve(destination, 'node_modules'), { recursive: true, force: true })
await writeFile(resolve(destination, 'VERSION'), `v${version}\n`, 'utf8')
await rm(archivePath, { force: true })
await rm(extractDirectory, { recursive: true, force: true })
console.log(`Bundled Node v${version}; SHA-256 ${actual}`)

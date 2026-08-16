import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, readFile, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const harness = join(root, 'resources', 'harness')
const archive = join(root, 'resources', 'harness-runtime.tar.gz')
const sourceManifest = join(harness, 'desktop-runtime.json')
const outputManifest = join(root, 'resources', 'runtime-manifest.json')
const tar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')

for (const required of [join(harness, 'lib', 'bin.js'), sourceManifest, tar]) {
  if (!existsSync(required)) throw new Error(`Harness archive input is missing: ${required}`)
}
JSON.parse(await readFile(sourceManifest, 'utf8'))
await rm(archive, { force: true })

await new Promise((resolvePromise, reject) => {
  const child = spawn(tar, ['-czf', archive, '.'], {
    cwd: harness,
    stdio: 'inherit',
    windowsHide: true,
  })
  child.once('error', reject)
  child.once('exit', code => code === 0 ? resolvePromise() : reject(new Error(`tar exited with code ${code}`)))
})
await cp(sourceManifest, outputManifest)
console.log(`Prepared ${archive}`)

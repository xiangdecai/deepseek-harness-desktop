import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = join(root, 'resources', 'licenses')
await mkdir(output, { recursive: true })

const copies = [
  ['resources/node/LICENSE', 'Node.js-LICENSE'],
  ['node_modules/electron/dist/LICENSE', 'Electron-LICENSE'],
  ['node_modules/electron/dist/LICENSES.chromium.html', 'Electron-LICENSES.chromium.html'],
]
for (const [source, destination] of copies) {
  const sourcePath = join(root, source)
  if (!existsSync(sourcePath)) throw new Error(`License input is missing: ${sourcePath}`)
  await cp(sourcePath, join(output, destination))
}

const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const rows = []
for (const dependency of Object.keys(manifest.devDependencies ?? {}).sort()) {
  const dependencyManifestPath = join(root, 'node_modules', dependency, 'package.json')
  if (!existsSync(dependencyManifestPath)) throw new Error(`Installed manifest is missing: ${dependency}`)
  const dependencyManifest = JSON.parse(await readFile(dependencyManifestPath, 'utf8'))
  rows.push(`| ${dependencyManifest.name} | ${dependencyManifest.version} | ${dependencyManifest.license ?? 'SEE PACKAGE'} |`)
}
await writeFile(join(output, 'Desktop-Direct-Dependencies.md'), [
  '# Desktop direct dependencies',
  '',
  '| Package | Version | License |',
  '|---|---:|---|',
  ...rows,
  '',
  'The Electron distribution carries its complete Chromium notice file beside this list. DeepSeek Harness transitive dependency notices are archived separately in this directory.',
  '',
].join('\n'))
console.log(`Prepared license archive at ${output}`)


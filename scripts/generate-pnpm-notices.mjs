import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const projectRoot = path.resolve(import.meta.dirname, '..')
const pnpmRoot = path.join(projectRoot, 'resources', 'pnpm-runtime', 'pnpm')
const output = path.join(projectRoot, 'PNPM_THIRD_PARTY_NOTICES.md')
const packages = new Map()

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === '.bin') continue
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) await walk(target)
    if (entry.isFile() && entry.name === 'package.json') {
      try {
        const manifest = JSON.parse(await readFile(target, 'utf8'))
        if (!manifest.name || !manifest.version) continue
        const key = `${manifest.name}@${manifest.version}`
        packages.set(key, {
          name: manifest.name,
          version: manifest.version,
          license: typeof manifest.license === 'string' ? manifest.license : 'See package metadata',
        })
      } catch {
        // A malformed metadata file is intentionally omitted rather than guessed.
      }
    }
  }
}

await walk(pnpmRoot)
const rows = [...packages.values()]
  .sort((left, right) => left.name.localeCompare(right.name) || left.version.localeCompare(right.version))
  .map(item => `| \`${item.name}\` | ${item.version} | ${item.license.replaceAll('|', '\\|')} |`)

const content = [
  '# pnpm Runtime Third-Party Notices',
  '',
  'Generated from the package metadata included in `resources/pnpm-runtime`.',
  'The desktop carrier uses this pnpm 10.18.3 distribution only to install a user-requested official Harness runtime update.',
  '',
  '| Package | Version | Declared license |',
  '| --- | --- | --- |',
  ...rows,
  '',
].join('\n')

await writeFile(output, content, 'utf8')
console.log(`Wrote ${rows.length} pnpm runtime dependency notices to ${output}`)

import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import pngToIco from 'png-to-ico'
import sharp from 'sharp'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = (await readFile(resolve(root, 'assets', 'deepseek-fish.svg'), 'utf8'))
  .replace('fill="#000"', 'fill="#4d6bfe"')
const pngPath = resolve(root, 'assets', 'icon.png')
const icoPath = resolve(root, 'assets', 'icon.ico')

const renderIcon = size => sharp(Buffer.from(source))
  .resize(size, size)
  .png()

await renderIcon(512).toFile(pngPath)
const icoInputs = await Promise.all([16, 24, 32, 48, 64, 128, 256].map(size => (
  renderIcon(size).toBuffer()
)))
await writeFile(icoPath, await pngToIco(icoInputs))
console.log(`Created ${pngPath} and ${icoPath}`)

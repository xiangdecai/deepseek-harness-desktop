'use strict'

const assert = require('node:assert/strict')
const { mkdir, mkdtemp, rm, writeFile } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { harnessEntryPath } = require('../src/runtime-loader.cjs')

test('runtime launcher selects the official DSH entrypoint when the package is present', async () => {
  const runtime = await mkdtemp(path.join(os.tmpdir(), 'dhd-entrypoint-'))
  const officialEntry = path.join(runtime, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  const wrapperEntry = path.join(runtime, 'lib', 'bin.js')
  try {
    await mkdir(path.dirname(officialEntry), { recursive: true })
    await mkdir(path.dirname(wrapperEntry), { recursive: true })
    await writeFile(officialEntry, '', 'utf8')
    await writeFile(wrapperEntry, '', 'utf8')
    assert.equal(harnessEntryPath(runtime), officialEntry)
  } finally {
    await rm(runtime, { recursive: true, force: true })
  }
})

test('runtime launcher falls back to the desktop archive entrypoint when no package entrypoint exists', async () => {
  const runtime = await mkdtemp(path.join(os.tmpdir(), 'dhd-entrypoint-fallback-'))
  const wrapperEntry = path.join(runtime, 'lib', 'bin.js')
  try {
    await mkdir(path.dirname(wrapperEntry), { recursive: true })
    await writeFile(wrapperEntry, '', 'utf8')
    assert.equal(harnessEntryPath(runtime), wrapperEntry)
  } finally {
    await rm(runtime, { recursive: true, force: true })
  }
})

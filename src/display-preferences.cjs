'use strict'

const { mkdir, readFile, writeFile } = require('node:fs/promises')
const path = require('node:path')

const DEFAULT_WINDOW_BOUNDS = Object.freeze({ width: 1120, height: 690 })
const DEFAULT_TEXT_SCALE = 1
const TEXT_SCALES = Object.freeze([0.85, 0.95, 1, 1.1, 1.2, 1.35, 1.5])

function normalizeTextScale(value) {
  const number = Number(value)
  return TEXT_SCALES.includes(number) ? number : DEFAULT_TEXT_SCALE
}

async function readDisplayPreferences(userData) {
  try {
    const value = JSON.parse(await readFile(path.join(userData, 'display-preferences.json'), 'utf8'))
    return { textScale: normalizeTextScale(value.textScale) }
  } catch {
    return { textScale: DEFAULT_TEXT_SCALE }
  }
}

async function writeDisplayPreferences(userData, preferences) {
  await mkdir(userData, { recursive: true })
  const value = { textScale: normalizeTextScale(preferences.textScale) }
  await writeFile(path.join(userData, 'display-preferences.json'), `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  return value
}

function nextTextScale(current, direction) {
  const index = TEXT_SCALES.indexOf(normalizeTextScale(current))
  return TEXT_SCALES[Math.max(0, Math.min(TEXT_SCALES.length - 1, index + direction))]
}

module.exports = {
  DEFAULT_TEXT_SCALE,
  DEFAULT_WINDOW_BOUNDS,
  TEXT_SCALES,
  nextTextScale,
  normalizeTextScale,
  readDisplayPreferences,
  writeDisplayPreferences,
}

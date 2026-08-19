'use strict'

const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.join(__dirname, '..')

test('desktop plugin center keeps one canonical entry and five management views', () => {
  const menu = readFileSync(path.join(root, 'src', 'main.cjs'), 'utf8')
  const center = readFileSync(path.join(root, 'src', 'ui', 'plugin-center.html'), 'utf8')

  assert.match(menu, /label: '插件中心'/u)
  assert.match(menu, /label: '打开插件中心'/u)
  assert.match(center, /data-tab="installed"/u)
  assert.match(center, /data-tab="market"/u)
  assert.match(center, /data-tab="updates"/u)
  assert.match(center, /data-tab="permissions"/u)
  assert.match(center, /data-tab="diagnostics"/u)
})

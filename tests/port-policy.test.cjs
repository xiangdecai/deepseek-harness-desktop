'use strict'

const assert = require('node:assert/strict')
const http = require('node:http')
const test = require('node:test')
const { findFreePort, probePort } = require('../src/port-policy.cjs')

function listen(handler) {
  const server = http.createServer(handler)
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)))
}

test('probePort identifies the DeepSeek Harness title', async t => {
  const server = await listen((_request, response) => {
    response.end('<!doctype html><title>DeepSeek Harness</title>')
  })
  t.after(() => server.close())
  const port = server.address().port
  assert.deepEqual(await probePort(port), { kind: 'harness', port, statusCode: 200 })
})

test('probePort refuses to attach to an unrelated service', async t => {
  const server = await listen((_request, response) => response.end('<title>Other app</title>'))
  t.after(() => server.close())
  const port = server.address().port
  assert.deepEqual(await probePort(port), { kind: 'occupied', port, statusCode: 200 })
})

test('findFreePort returns a listenable loopback port', async () => {
  const port = await findFreePort(32100, 32200)
  assert.ok(port >= 32100 && port <= 32200)
})


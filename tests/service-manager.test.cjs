'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { HarnessServiceManager, managedArguments, parseHarnessWebUrl, redactSensitiveOutput } = require('../src/service-manager.cjs')

function logger() {
  return { info() {}, warn() {}, error() {} }
}

function manager(options = {}) {
  return new HarnessServiceManager({
    nodeExecutable: process.execPath,
    dshEntry: __filename,
    dshHome: process.cwd(),
    cwd: process.cwd(),
    logger: logger(),
    ...options,
  })
}

test('readiness requires consecutive Harness probes', async () => {
  const probes = [
    { kind: 'occupied' },
    { kind: 'harness' },
    { kind: 'harness' },
  ]
  let waits = 0
  const service = manager({
    probePort: async () => probes.shift(),
    wait: async () => { waits += 1 },
    requiredReadyProbes: 2,
    startupTimeoutMs: 1_000,
  })

  await service.waitUntilReady({ exitCode: null }, 3080)
  assert.equal(waits, 2)
  assert.deepEqual(probes, [])
})

test('restart joins a cold start instead of terminating it', async () => {
  const service = manager()
  const expected = { mode: 'managed', url: 'http://127.0.0.1:3080' }
  service.startPromise = Promise.resolve(expected)
  service.stop = async () => { throw new Error('restart must not stop an active cold start') }

  assert.equal(await service.restart(), expected)
})

test('managed Harness always starts headlessly with the private runtime', () => {
  const args = managedArguments('C:/private/dsh/lib/bin.js', 3081)
  assert.deepEqual(args, ['C:/private/dsh/lib/bin.js', 'web', '--port', '3081', '--no-open'])
  assert.equal(args.filter(value => value === '--no-open').length, 1)
})

test('managed Harness captures only its own loopback auth URL and redacts the token from logs', () => {
  const line = 'dsh web: http://127.0.0.1:3081/?token=smoke-test-token'
  assert.equal(parseHarnessWebUrl(line, 3081), 'http://127.0.0.1:3081/?token=smoke-test-token')
  assert.equal(parseHarnessWebUrl(line, 3080), undefined)
  assert.equal(parseHarnessWebUrl(line.replace('127.0.0.1', 'example.com'), 3081), undefined)
  assert.equal(redactSensitiveOutput(line), 'dsh web: http://127.0.0.1:3081/?token=[REDACTED]')
})

'use strict'

const http = require('node:http')
const net = require('node:net')

const HARNESS_TITLE = '<title>DeepSeek Harness</title>'

function requestBody(port, timeoutMs = 1200) {
  return new Promise((resolve, reject) => {
    const request = http.get({
      host: '127.0.0.1',
      port,
      path: '/',
      timeout: timeoutMs,
      headers: { Accept: 'text/html' },
    }, response => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', chunk => {
        if (body.length < 64 * 1024) body += chunk
      })
      response.on('end', () => resolve({ statusCode: response.statusCode ?? 0, body }))
    })
    request.once('timeout', () => request.destroy(new Error('probe timeout')))
    request.once('error', reject)
  })
}

async function probePort(port, timeoutMs = 1200) {
  try {
    const response = await requestBody(port, timeoutMs)
    const isHarness = response.statusCode >= 200
      && response.statusCode < 400
      && response.body.includes(HARNESS_TITLE)
    return {
      kind: isHarness ? 'harness' : 'occupied',
      port,
      statusCode: response.statusCode,
    }
  } catch (error) {
    const code = error && typeof error === 'object' ? error.code : undefined
    if (code === 'ECONNREFUSED' || code === 'ECONNRESET') return { kind: 'free', port }
    return { kind: 'occupied', port, error: error instanceof Error ? error.message : String(error) }
  }
}

function canListen(port) {
  return new Promise(resolve => {
    const server = net.createServer()
    server.unref()
    server.once('error', () => resolve(false))
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      server.close(() => resolve(true))
    })
  })
}

async function findFreePort(startPort = 3081, endPort = 3180) {
  for (let port = startPort; port <= endPort; port += 1) {
    if (await canListen(port)) return port
  }
  throw new Error(`No free loopback port between ${startPort} and ${endPort}`)
}

async function resolvePortPolicy(preferredPort = 3080) {
  const probe = await probePort(preferredPort)
  if (probe.kind === 'harness') {
    return { mode: 'attach', port: preferredPort, url: `http://127.0.0.1:${preferredPort}` }
  }
  if (probe.kind === 'free') {
    return { mode: 'start', port: preferredPort, url: `http://127.0.0.1:${preferredPort}` }
  }
  const port = await findFreePort(preferredPort + 1)
  return { mode: 'start', port, url: `http://127.0.0.1:${port}`, occupiedPort: preferredPort }
}

module.exports = {
  HARNESS_TITLE,
  findFreePort,
  probePort,
  resolvePortPolicy,
}


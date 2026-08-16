'use strict'

const { EventEmitter } = require('node:events')
const { existsSync, readFileSync } = require('node:fs')
const { spawn } = require('node:child_process')
const { createInterface } = require('node:readline')
const path = require('node:path')
const { probePort, resolvePortPolicy } = require('./port-policy.cjs')

const BOOTSTRAP_ENV_NAMES = new Set([
  'PATH', 'HOME', 'USERPROFILE', 'SHELL', 'NODE_OPTIONS', 'NODE_PATH',
  'DEEPSEEK_BASE_URL', 'DEEPSEEK_SEARCH_BASE_URL', 'SSL_CERT_FILE', 'SSL_CERT_DIR',
  'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'NODE_TLS_REJECT_UNAUTHORIZED',
])

function projectBootstrapEnvKeys(cwd) {
  const file = path.join(cwd, '.env')
  if (!existsSync(file)) return []
  let content
  try {
    content = readFileSync(file, 'utf8')
  } catch {
    return []
  }
  const keys = []
  for (const line of content.split(/\r?\n/u)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/u.exec(line)
    if (!match) continue
    const name = match[1].toUpperCase()
    if (BOOTSTRAP_ENV_NAMES.has(name) || name.startsWith('DSH_') || name.startsWith('XDG_')) keys.push(match[1])
  }
  return [...new Set(keys)]
}

class HarnessServiceManager extends EventEmitter {
  constructor(options) {
    super()
    this.nodeExecutable = options.nodeExecutable
    this.dshEntry = options.dshEntry
    this.dshHome = options.dshHome
    this.cwd = options.cwd
    this.logger = options.logger
    this.startupTimeoutMs = options.startupTimeoutMs ?? 45_000
    this.child = undefined
    this.url = undefined
    this.port = undefined
    this.mode = 'stopped'
    this.stopping = false
  }

  get status() {
    return {
      mode: this.mode,
      url: this.url,
      port: this.port,
      pid: this.child?.pid,
      dshHome: this.dshHome,
      cwd: this.cwd,
    }
  }

  async start() {
    if (this.child !== undefined || this.mode === 'attached') return this.status
    const bootstrapEnvKeys = projectBootstrapEnvKeys(this.cwd)
    if (bootstrapEnvKeys.length > 0) {
      const message = `Project .env contains Harness launch-only variable(s): ${bootstrapEnvKeys.join(', ')}. Remove them from ${path.join(this.cwd, '.env')} or set them in Windows environment variables before starting.`
      this.logger.error(message)
      throw new Error(message)
    }
    const policy = await resolvePortPolicy(3080)
    if (policy.mode === 'attach') {
      this.mode = 'attached'
      this.port = policy.port
      this.url = policy.url
      this.logger.info(`Detected an existing DeepSeek Harness at ${policy.url}; attached without starting a second writer.`)
      this.emit('ready', this.status)
      return this.status
    }
    if (policy.occupiedPort !== undefined) {
      this.logger.warn(`Port ${policy.occupiedPort} is occupied by a non-Harness service; selected ${policy.port}.`)
    }
    return await this.startManaged(policy.port)
  }

  async startManaged(port) {
    this.assertRuntime()
    this.stopping = false
    this.mode = 'starting'
    this.port = port
    this.url = `http://127.0.0.1:${port}`
    this.logger.info(`Starting private runtime with absolute Node path: ${this.nodeExecutable}`)
    this.logger.info(`DSH_HOME=${this.dshHome}`)
    this.logger.info(`Workspace=${this.cwd}`)

    const child = spawn(this.nodeExecutable, [this.dshEntry, 'web', '--port', String(port)], {
      cwd: this.cwd,
      env: {
        ...process.env,
        DSH_HOME: this.dshHome,
        DSH_DESKTOP: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.child = child
    this.pipeLines(child.stdout, 'harness')
    this.pipeLines(child.stderr, 'harness:error', 'warn')

    child.once('error', error => {
      this.logger.error(`Harness process failed to spawn: ${error.message}`)
    })
    child.once('exit', (code, signal) => {
      const expected = this.stopping
      this.child = undefined
      this.mode = 'stopped'
      this.logger[expected ? 'info' : 'error'](`Harness process exited (${code === null ? `signal ${signal}` : `code ${code}`}).`)
      this.emit('exit', { code, signal, expected })
    })

    await this.waitUntilReady(child, port)
    this.mode = 'managed'
    this.logger.info(`Harness is ready at ${this.url}.`)
    this.emit('ready', this.status)
    return this.status
  }

  async restart() {
    if (this.mode === 'attached') {
      const probe = await probePort(this.port)
      if (probe.kind !== 'harness') {
        this.mode = 'stopped'
        this.url = undefined
        this.port = undefined
        return await this.start()
      }
      this.logger.info('The attached Harness is externally owned; reconnected without terminating it.')
      this.emit('ready', this.status)
      return this.status
    }
    await this.stop()
    return await this.start()
  }

  async stop() {
    if (this.child === undefined) {
      if (this.mode === 'attached') this.logger.info('Detached from the externally owned Harness; its process was left running.')
      this.mode = 'stopped'
      this.url = undefined
      this.port = undefined
      return
    }
    const child = this.child
    this.stopping = true
    this.logger.info(`Stopping managed Harness process ${child.pid}.`)
    child.kill('SIGTERM')
    const exited = await Promise.race([
      new Promise(resolve => child.once('exit', () => resolve(true))),
      new Promise(resolve => setTimeout(() => resolve(false), 5000)),
    ])
    if (!exited && child.pid !== undefined) {
      this.logger.warn(`Harness process ${child.pid} did not exit in 5 seconds; terminating its process tree.`)
      await this.killWindowsTree(child.pid)
    }
    this.child = undefined
    this.mode = 'stopped'
    this.url = undefined
    this.port = undefined
  }

  assertRuntime() {
    if (!path.isAbsolute(this.nodeExecutable) || !existsSync(this.nodeExecutable)) {
      throw new Error(`Bundled node.exe is missing: ${this.nodeExecutable}`)
    }
    if (!path.isAbsolute(this.dshEntry) || !existsSync(this.dshEntry)) {
      throw new Error(`Bundled dsh entry is missing: ${this.dshEntry}`)
    }
  }

  pipeLines(stream, source, level = 'info') {
    if (stream === null) return
    const lines = createInterface({ input: stream })
    lines.on('line', line => {
      if (line.trim() !== '') this.logger[level](line, source)
    })
  }

  async waitUntilReady(child, port) {
    const startedAt = Date.now()
    while (Date.now() - startedAt < this.startupTimeoutMs) {
      if (child.exitCode !== null) throw new Error(`Harness exited before readiness with code ${child.exitCode}`)
      const probe = await probePort(port, 600)
      if (probe.kind === 'harness') return
      await new Promise(resolve => setTimeout(resolve, 180))
    }
    throw new Error(`Harness did not become ready within ${this.startupTimeoutMs} ms`)
  }

  async killWindowsTree(pid) {
    if (process.platform !== 'win32') return
    const taskkill = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe')
    await new Promise(resolve => {
      const killer = spawn(taskkill, ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      killer.once('exit', resolve)
      killer.once('error', resolve)
    })
  }
}

module.exports = { HarnessServiceManager }

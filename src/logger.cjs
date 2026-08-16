'use strict'

const { EventEmitter } = require('node:events')
const { appendFileSync, mkdirSync } = require('node:fs')
const path = require('node:path')

class AppLogger extends EventEmitter {
  constructor(logDirectory, maxBufferedLines = 500) {
    super()
    mkdirSync(logDirectory, { recursive: true })
    this.filePath = path.join(logDirectory, 'desktop.log')
    this.maxBufferedLines = maxBufferedLines
    this.lines = []
  }

  write(level, message, source = 'desktop') {
    const record = {
      timestamp: new Date().toISOString(),
      level,
      source,
      message: String(message).replace(/[\r\n]+$/u, ''),
    }
    const line = `${record.timestamp} [${record.level.toUpperCase()}] [${record.source}] ${record.message}`
    this.lines.push(record)
    if (this.lines.length > this.maxBufferedLines) this.lines.shift()
    appendFileSync(this.filePath, `${line}\n`, 'utf8')
    this.emit('record', record)
    return record
  }

  info(message, source) {
    return this.write('info', message, source)
  }

  warn(message, source) {
    return this.write('warn', message, source)
  }

  error(message, source) {
    return this.write('error', message, source)
  }

  snapshot() {
    return [...this.lines]
  }
}

module.exports = { AppLogger }


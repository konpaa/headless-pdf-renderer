import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'
import { fork } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

describe('PDF Render Service', () => {
  let serverProcess
  const PORT = 8082
  const BASE_URL = `http://localhost:${PORT}`

  before(async () => {
    // Start server in separate process
    serverProcess = fork(join(__dirname, '../src/index.js'), {
      env: { ...process.env, NODE_ENV: 'test' },
      stdio: 'pipe'
    })

    // Wait for server to start
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Server start timeout')), 30000)
      
      serverProcess.stdout.on('data', (data) => {
        if (data.toString().includes('Listening on port')) {
          clearTimeout(timeout)
          resolve()
        }
      })

      serverProcess.stderr.on('data', (data) => {
        console.error('Server error:', data.toString())
      })

      serverProcess.on('error', (err) => {
        clearTimeout(timeout)
        reject(err)
      })
    })
  })

  after(() => {
    if (serverProcess) {
      serverProcess.kill('SIGINT')
    }
  })

  it('should render simple HTML to PDF', async () => {
    const html = '<html><body><h1>Test PDF</h1><p>This is a test document.</p></body></html>'
    
    const response = await fetch(`${BASE_URL}/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html })
    })

    assert.strictEqual(response.status, 200)
    assert.ok(response.headers.get('content-type').includes('application/pdf'))

    const buffer = await response.arrayBuffer()
    const pdf = Buffer.from(buffer)

    // Check PDF magic bytes
    assert.strictEqual(pdf.slice(0, 4).toString(), '%PDF')
    assert.ok(pdf.length > 1000, 'PDF should have reasonable size')
  })

  it('should render PDF with custom scale', async () => {
    const html = '<html><body><h1>Scaled PDF</h1></body></html>'
    
    const response = await fetch(`${BASE_URL}/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html, scale_param: 1.5 })
    })

    assert.strictEqual(response.status, 200)
    const buffer = await response.arrayBuffer()
    const pdf = Buffer.from(buffer)
    assert.strictEqual(pdf.slice(0, 4).toString(), '%PDF')
  })

  it('should render PDF with custom page size', async () => {
    const html = '<html><body><h1>Custom Size PDF</h1></body></html>'
    
    const response = await fetch(`${BASE_URL}/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        html, 
        width_param: '210mm',
        height_param: '297mm'
      })
    })

    assert.strictEqual(response.status, 200)
    const buffer = await response.arrayBuffer()
    const pdf = Buffer.from(buffer)
    assert.strictEqual(pdf.slice(0, 4).toString(), '%PDF')
  })

  it('should reject empty HTML', async () => {
    const response = await fetch(`${BASE_URL}/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: '' })
    })

    assert.strictEqual(response.status, 400)
    const json = await response.json()
    assert.ok(json.error.includes('html'))
  })

  it('should reject invalid scale', async () => {
    const html = '<html><body>Test</body></html>'
    const response = await fetch(`${BASE_URL}/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html, scale_param: 5 })
    })

    assert.strictEqual(response.status, 400)
    const json = await response.json()
    assert.ok(json.error.includes('scale_param'))
  })

  it('should reject malformed JSON', async () => {
    const response = await fetch(`${BASE_URL}/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json'
    })

    assert.strictEqual(response.status, 400)
  })

  it('should render HTML with CSS and images', async () => {
    const html = `
      <html>
        <head>
          <style>
            body { font-family: Arial; background-color: #f0f0f0; }
            h1 { color: #333; }
          </style>
        </head>
        <body>
          <h1>Styled Document</h1>
          <p>This document has CSS styling.</p>
        </body>
      </html>
    `
    
    const response = await fetch(`${BASE_URL}/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html })
    })

    assert.strictEqual(response.status, 200)
    const buffer = await response.arrayBuffer()
    const pdf = Buffer.from(buffer)
    assert.strictEqual(pdf.slice(0, 4).toString(), '%PDF')
  })
})

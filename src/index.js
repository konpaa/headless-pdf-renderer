import puppeteer from 'puppeteer'
import express from 'express'
import cors from 'cors'

const PAGE_TIMEOUT_MS = parseInt(process.env.PAGE_TIMEOUT_MS || '60000', 10)
const CONCURRENCY_LIMIT = parseInt(process.env.CONCURRENCY_LIMIT || '4', 10)
const QUEUE_LIMIT = parseInt(process.env.QUEUE_LIMIT || '50', 10)
const BROWSER_MAX_RENDERS = parseInt(process.env.BROWSER_MAX_RENDERS || '200', 10)
const EXECUTABLE_PATH = process.env.PUPPETEER_EXECUTABLE_PATH
const BODY_SIZE_LIMIT = process.env.BODY_SIZE_LIMIT || '10mb'
const DISABLE_SSRF_PROTECTION = process.env.DISABLE_SSRF_PROTECTION === 'true'

// Validate configuration
if (PAGE_TIMEOUT_MS < 1000 || PAGE_TIMEOUT_MS > 300000) {
  throw new Error('PAGE_TIMEOUT_MS must be between 1000 and 300000')
}
if (CONCURRENCY_LIMIT < 1 || CONCURRENCY_LIMIT > 100) {
  throw new Error('CONCURRENCY_LIMIT must be between 1 and 100')
}
if (QUEUE_LIMIT < 1 || QUEUE_LIMIT > 1000) {
  throw new Error('QUEUE_LIMIT must be between 1 and 1000')
}

// Puppeteer accepts a page size in px, in, cm or mm (px when no unit is given)
const PAGE_SIZE_PATTERN = /^\d*\.?\d+(px|in|cm|mm)?$/i

// Private IP ranges for SSRF protection
const PRIVATE_IP_RANGES = [
  /^127\./,           // 127.0.0.0/8 (loopback)
  /^10\./,            // 10.0.0.0/8 (private)
  /^172\.(1[6-9]|2\d|3[01])\./,  // 172.16.0.0/12 (private)
  /^192\.168\./,      // 192.168.0.0/16 (private)
  /^169\.254\./,      // 169.254.0.0/16 (link-local)
  /^::1$/,            // IPv6 loopback
  /^fe80:/,           // IPv6 link-local
  /^fc00:/,           // IPv6 unique local
]

// Renders run at most CONCURRENCY_LIMIT at a time, the rest wait in a bounded queue
let activeRenders = 0
const queue = []

// One shared browser, each render gets its own incognito context.
// The browser is replaced after BROWSER_MAX_RENDERS renders to keep its memory in check.
let currentBrowser = null

let shuttingDown = false

const app = express()

app.use(cors())
app.use(express.json({ limit: BODY_SIZE_LIMIT }))

// Health check endpoint
app.get('/health', (req, res) => {
  const status = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    activeRenders,
    queueLength: queue.length,
    browserActive: currentBrowser !== null && !currentBrowser.retired,
  }
  res.json(status)
})

app.post('/render', async (req, res) => {
  try {
    const options = parseRenderOptions(req.body)
    const pdf = await enqueue(() => {
      // The client gave up while the request was waiting in the queue
      if (req.socket.destroyed) {
        throw httpError(499, 'Client closed request')
      }
      return renderPDF(options)
    })
    res.setHeader('Content-type', 'application/pdf')
    res.end(Buffer.from(pdf))
  } catch (err) {
    const status = err.status || (err.name === 'TimeoutError' ? 504 : 500)
    console.error(`Render failed (${status}): ${err.message}`)
    if (!res.headersSent) {
      res.status(status).json({ error: err.message })
    }
  }
})

// Malformed JSON, too large body and other express.json() errors
app.use((err, req, res, next) => {
  if (!res.headersSent) {
    res.status(err.status || 500).json({ error: err.message })
  }
})

const server = app.listen(8082, () => {
  console.log('Listening on port 8082')
  console.log(`Concurrency limit: ${CONCURRENCY_LIMIT}, queue limit: ${QUEUE_LIMIT}, page timeout: ${PAGE_TIMEOUT_MS}ms, browser recycled every ${BROWSER_MAX_RENDERS} renders`)
  console.log(`SSRF protection: ${DISABLE_SSRF_PROTECTION ? 'DISABLED' : 'ENABLED'}`)
  // Launch the browser up front so the first request doesn't wait for it
  currentBrowser = launchBrowser()
})

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

function shutdown(signal) {
  // A second signal forces the exit
  if (shuttingDown) {
    process.exit(1)
  }
  shuttingDown = true
  console.log(`${signal} received, waiting for ${activeRenders + queue.length} renders to finish`)
  server.close()
  const timer = setInterval(() => {
    if (activeRenders === 0 && queue.length === 0) {
      clearInterval(timer)
      // Puppeteer kills the browser on process exit
      process.exit(0)
    }
  }, 100)
}

function enqueue(task) {
  if (shuttingDown) {
    return Promise.reject(httpError(503, 'Server is shutting down'))
  }
  if (activeRenders >= CONCURRENCY_LIMIT && queue.length >= QUEUE_LIMIT) {
    return Promise.reject(httpError(503, 'Render queue is full'))
  }
  return new Promise((resolve, reject) => {
    queue.push(() => {
      activeRenders++
      Promise.resolve()
        .then(task)
        .then(resolve, reject)
        .finally(() => {
          activeRenders--
          dequeue()
        })
    })
    dequeue()
  })
}

function dequeue() {
  if (activeRenders < CONCURRENCY_LIMIT && queue.length > 0) {
    queue.shift()()
  }
}

function acquireBrowser() {
  if (currentBrowser && currentBrowser.renders >= BROWSER_MAX_RENDERS) {
    console.log(`Recycling browser after ${currentBrowser.renders} renders`)
    retireBrowser(currentBrowser)
  }
  if (!currentBrowser) {
    currentBrowser = launchBrowser()
  }
  currentBrowser.active++
  currentBrowser.renders++
  return currentBrowser
}

function releaseBrowser(entry) {
  entry.active--
  if (entry.retired && entry.active === 0) {
    closeBrowser(entry)
  }
}

function launchBrowser() {
  // Concurrent renders share this launch instead of starting their own browsers
  const entry = { active: 0, renders: 0, retired: false }
  const launchOptions = {
    headless: true,
    args: [
      '--disable-dev-shm-usage',
      // Ubuntu 24.04+ CI environments may need --no-sandbox
      ...(process.env.CI ? ['--no-sandbox', '--disable-setuid-sandbox'] : []),
    ],
    // Signals are handled by shutdown(), so in-flight renders can finish
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
  }
  
  // Only set executablePath if explicitly provided
  if (EXECUTABLE_PATH) {
    launchOptions.executablePath = EXECUTABLE_PATH
  }
  
  entry.browser = puppeteer.launch(launchOptions)
  entry.browser.then(browser => {
    console.log('Browser launched')
    browser.on('disconnected', () => {
      if (currentBrowser === entry) {
        console.error('Browser disconnected unexpectedly')
        retireBrowser(entry)
      }
    })
  }, err => {
    console.error('Browser launch failed:', err.message)
    if (currentBrowser === entry) {
      currentBrowser = null
    }
  })
  return entry
}

// Stops handing out the browser and closes it once its last render is done
function retireBrowser(entry) {
  entry.retired = true
  if (currentBrowser === entry) {
    currentBrowser = null
  }
  if (entry.active === 0) {
    closeBrowser(entry)
  }
}

function closeBrowser(entry) {
  entry.browser
    .then(browser => browser.close())
    .catch(err => console.error('Browser close failed:', err.message))
}

async function renderPDF({ html, scale, width, height }) {
  const entry = acquireBrowser()
  let context = null
  let page = null
  try {
    const browser = await entry.browser
    context = await browser.createBrowserContext()
    page = await context.newPage()
    page.setDefaultTimeout(PAGE_TIMEOUT_MS)
    
    // SSRF protection: intercept requests and block private IPs and file:// URLs
    if (!DISABLE_SSRF_PROTECTION) {
      await page.setRequestInterception(true)
      page.on('request', (request) => {
        const url = request.url()
        
        // Block file:// URLs
        if (url.startsWith('file://')) {
          request.abort('blockedbyclient')
          return
        }
        
        // Block data URLs over 1MB to prevent DoS
        if (url.startsWith('data:') && url.length > 1024 * 1024) {
          request.abort('blockedbyclient')
          return
        }
        
        // Check for private IP addresses
        try {
          const urlObj = new URL(url)
          const hostname = urlObj.hostname
          
          // Check if hostname is a private IP
          if (PRIVATE_IP_RANGES.some(pattern => pattern.test(hostname))) {
            request.abort('blockedbyclient')
            return
          }
        } catch (e) {
          // Invalid URL, let Puppeteer handle it
        }
        
        request.continue()
      })
    }
    
    await page.setContent(html, { waitUntil: 'load' })
    return await withTimeout(page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
      margin: {
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
      },
      height,
      width,
      scale,
    }), PAGE_TIMEOUT_MS)
  } finally {
    if (page) {
      await page.close().catch(err => console.error('Page close failed:', err.message))
    }
    if (context) {
      await withTimeout(context.close(), PAGE_TIMEOUT_MS).catch(err => {
        // A browser that can't close a context is in a bad state
        console.error('Context close failed:', err.message)
        retireBrowser(entry)
      })
    }
    releaseBrowser(entry)
  }
}

function parseRenderOptions(body) {
  const { html, scale_param, width_param, height_param } = body || {}
  if (typeof html !== 'string' || html === '') {
    throw httpError(400, 'html must be a non-empty string')
  }
  return {
    html,
    scale: parseScale(scale_param),
    width: parsePageSize('width_param', width_param),
    height: parsePageSize('height_param', height_param),
  }
}

function parseScale(value) {
  if (isEmpty(value)) {
    return undefined
  }
  const scale = Number(value)
  // Also rejects NaN
  if (!(scale >= 0.1 && scale <= 2)) {
    throw httpError(400, 'scale_param must be a number between 0.1 and 2')
  }
  return scale
}

function parsePageSize(name, value) {
  if (isEmpty(value)) {
    return undefined
  }
  if (!PAGE_SIZE_PATTERN.test(String(value))) {
    throw httpError(400, `${name} must be a number or a string like 210mm, 8.5in, 21cm or 800px`)
  }
  return value
}

function isEmpty(value) {
  return value === undefined || value === null || value === ''
}

function withTimeout(promise, ms) {
  let timer
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(httpError(504, `Timed out after ${ms}ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

function httpError(status, message) {
  const err = new Error(message)
  err.status = status
  return err
}

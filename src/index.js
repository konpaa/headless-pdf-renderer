import 'core-js'
import 'regenerator-runtime'
import puppeteer from 'puppeteer'
import express from 'express'
import cors from 'cors'
import bodyParser from 'body-parser'

const app = express()

app.use(cors())
app.use(bodyParser.json())

app.post('/render', async (req, res) => {
  res.setHeader('Content-type', 'application/pdf')
  res.send(await renderPDF(req.body.html, req.body.scale_param, req.body.width_param, req.body.height_param))
})

app.listen(8082, () => {
  console.log('Listening on port 8082')
})

process.on('SIGINT', function () {
  process.exit()
})

async function renderPDF(html, scale_param, width_param, height_param) {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: 'google-chrome-stable',
    args: [
      '--disable-dev-shm-usage',
    ]
  })
  const page = await browser.newPage()
  await page.setContent(html, {waitUntil: 'networkidle0'})
  const pdf = await page.pdf({
    printBackground: true,
    preferCSSPageSize: true,
    margin: {
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
    },
    height: height_param,
    width: width_param,
    scale: scale_param
  })

  await browser.close()

  return pdf
}
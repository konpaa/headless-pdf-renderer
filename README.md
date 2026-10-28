# headless-pdf-renderer

A lightweight HTTP service that renders HTML to PDF using headless Chrome via Puppeteer.

## Quick Start

Using Docker (recommended):

```bash
docker run -p 8082:8082 konpaa/headless-pdf-renderer:latest
```

Available tags: `latest`, version tags (e.g., `v1.0.0`). Multi-arch support: `linux/amd64`, `linux/arm64`.

## API Reference

### `POST /render`

Render HTML to PDF.

**Request body** (JSON):

| Field          | Type   | Required | Description                                           |
|----------------|--------|----------|-------------------------------------------------------|
| `html`         | string | yes      | HTML content to render                                |
| `scale_param`  | number | no       | Page scale between 0.1 and 2                          |
| `width_param`  | string | no       | Page width, e.g., `210mm`, `8.5in`, `800px`           |
| `height_param` | string | no       | Page height, e.g., `297mm`, `11in`, `1200px`          |

**Response:**
- Success (200): PDF binary
- Error (4xx/5xx): `{"error": "message"}`

**Status codes:**
- `400` - Invalid parameters
- `503` - Queue full or server shutting down
- `504` - Timeout (HTML didn't load or PDF generation took too long)
- `500` - Internal error

**Example:**

```bash
curl -X POST http://localhost:8082/render \
  -H "Content-Type: application/json" \
  -d '{
    "html": "<html><body><h1>Hello PDF</h1></body></html>",
    "width_param": "210mm",
    "height_param": "297mm"
  }' \
  --output document.pdf
```

### `GET /health`

Health check endpoint. Returns **200** only when Chrome is ready; otherwise **503** (`status: "unhealthy"`) — including launch failure and shutdown. Docker `HEALTHCHECK` relies on this.

**Response** (JSON, healthy):

```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "activeRenders": 0,
  "queueLength": 0,
  "browserActive": true
}
```

**Example:**

```bash
curl http://localhost:8082/health
```

## Configuration

Configure the service with environment variables:

| Variable                    | Default  | Description                                                   |
|-----------------------------|----------|---------------------------------------------------------------|
| `CONCURRENCY_LIMIT`         | `4`      | Max concurrent renders (about one per CPU works best)         |
| `QUEUE_LIMIT`               | `50`     | Max requests waiting in queue before 503 is returned          |
| `PAGE_TIMEOUT_MS`           | `60000`  | Timeout (ms) for loading HTML and generating PDF              |
| `BROWSER_MAX_RENDERS`       | `200`    | Browser is restarted after this many renders                  |
| `BODY_SIZE_LIMIT`           | `10mb`   | Max request body size (e.g., `10mb`, `50mb`)                  |
| `PUPPETEER_EXECUTABLE_PATH` | (Docker: `/usr/bin/google-chrome-stable`) | Browser binary; required in the image because Chrome is not bundled |
| `DISABLE_SSRF_PROTECTION`   | `false`  | Set to `true` to disable SSRF protection (not recommended)    |

**Resource planning:** One shared browser uses ~250–400 MB, plus ~50–90 MB per concurrent render.

**Graceful shutdown:** On SIGINT/SIGTERM, the server stops accepting new requests and waits for in-flight renders to complete. Give containers a stop timeout of at least `PAGE_TIMEOUT_MS` (e.g., `docker stop -t 60`).

**Example:**

```bash
docker run -p 8082:8082 \
  -e CONCURRENCY_LIMIT=8 \
  -e BODY_SIZE_LIMIT=50mb \
  konpaa/headless-pdf-renderer:latest
```

## Security

### SSRF Protection

Enabled by default to prevent Server-Side Request Forgery attacks:

- ❌ Blocks `file://` URLs (local file access)
- ❌ Blocks private IP ranges: `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`
- ❌ Blocks IPv6 loopback and link-local addresses
- ❌ Limits `data:` URLs to 1MB (DoS prevention)
- ✅ Allows external resources (CDNs, public images, fonts)

Disable with `DISABLE_SSRF_PROTECTION=true` only if you control all input HTML.

### Production Recommendations

- Run in an isolated network segment
- Use firewall rules to restrict outbound connections
- Implement rate limiting at the reverse proxy level
- Don't expose directly to untrusted users
- Keep images and dependencies up to date

## Local Development

**Requirements:**
- Node.js 22.12+ (or 24+)
- Yarn

**Install dependencies:**

```bash
yarn install
```

**Run the server:**

```bash
yarn dev
```

**Run tests:**

```bash
yarn test
```

**Build Docker image:**

```bash
docker build -t headless-pdf-renderer .
```

## License

MIT

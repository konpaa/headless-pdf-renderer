# headless-pdf-renderer

This is a simple HTTP server that offers an endpoint to render
HTML to PDF using Google Chrome with Puppeteer.

## Requirements

- Node.js 22.12+ (recommended: Node.js 24)
- Google Chrome or Chromium

## Installation

```bash
yarn install
```

### Usage

The default Dockerfile installs all dependencies and runs as
an unprivileged user with Chrome in sandboxed mode.
You can reach the API at `/render` on port 8082.

The image builds for both amd64 (Google Chrome) and arm64 (Debian Chromium).

### Request

`POST /render` with a JSON body:

| Field          | Required | Description                                           |
|----------------|----------|-------------------------------------------------------|
| `html`         | yes      | HTML to render                                        |
| `scale_param`  | no       | Scale between 0.1 and 2                               |
| `width_param`  | no       | Page width: a number in px or a string like `210mm`   |
| `height_param` | no       | Page height: a number in px or a string like `297mm`  |

On success the response is the PDF. Errors come back as JSON `{"error": "..."}`:
400 for invalid parameters, 503 when the render queue is full or the server is
shutting down, 504 when the page doesn't load within `PAGE_TIMEOUT_MS`, 500 otherwise.

### Configuration

| Variable                    | Default                 | Description                                                   |
|-----------------------------|-------------------------|---------------------------------------------------------------|
| `CONCURRENCY_LIMIT`         | `4`                     | Renders running at the same time, about one per CPU works best |
| `QUEUE_LIMIT`               | `50`                    | Requests waiting for a free slot before 503 is returned       |
| `PAGE_TIMEOUT_MS`           | `60000`                 | Timeout for loading the HTML and for printing the PDF         |
| `BROWSER_MAX_RENDERS`       | `200`                   | The browser is restarted after this many renders              |
| `PUPPETEER_EXECUTABLE_PATH` | (auto)                  | Browser binary (optional, uses bundled Chrome by default)     |
| `BODY_SIZE_LIMIT`           | `10mb`                  | Maximum size for request body (supports values like '10mb', '1gb') |
| `DISABLE_SSRF_PROTECTION`   | `false`                 | Set to `true` to disable SSRF protection (not recommended)    |

One browser is shared by all requests, each render gets its own browser context.
Plan for roughly 250–400 MB for the browser plus 50–90 MB per concurrent render.

On SIGINT/SIGTERM the server stops accepting requests and waits for the running
renders, so give the container a stop timeout of at least `PAGE_TIMEOUT_MS`
(`docker stop -t`, `stop_grace_period` in Compose).

## API Endpoints

### `POST /render`

Render HTML to PDF. See the Request section above for parameters.

### `GET /health`

Health check endpoint that returns:
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "activeRenders": 0,
  "queueLength": 0,
  "browserActive": true
}
```

## Testing

Run the test suite:

```bash
yarn test
```

## Docker

Build and run the Docker image:

```bash
docker build -t headless-pdf-renderer .
docker run -p 8082:8082 headless-pdf-renderer
```

### Pre-built Images

Pre-built multi-architecture Docker images are available on Docker Hub:

```bash
docker pull konpaa/headless-pdf-renderer:latest
docker run -p 8082:8082 konpaa/headless-pdf-renderer:latest
```

Supported architectures: `linux/amd64`, `linux/arm64`

Available tags:
- `latest` - latest build from main branch
- `v1.0.0` - semantic version tags
- `abc1234` - short commit SHA tags

### CI/CD and Docker Hub Publishing

The project uses GitHub Actions to automatically build and publish Docker images to Docker Hub.

**Required GitHub Repository Secrets:**

To enable Docker Hub publishing, add the following secrets to your GitHub repository (Settings → Secrets and variables → Actions → New repository secret):

1. **DOCKERHUB_USERNAME**: Your Docker Hub username
2. **DOCKERHUB_TOKEN**: Docker Hub access token (see below how to create)

**How to create a Docker Hub access token:**

1. Log in to [Docker Hub](https://hub.docker.com/)
2. Click on your username in the top right → **Account Settings**
3. Go to **Security** tab
4. Click **New Access Token**
5. Enter a description (e.g., "GitHub Actions")
6. Select permissions: **Read, Write, Delete** (or **Read & Write** minimum)
7. Click **Generate**
8. Copy the token immediately (it won't be shown again)
9. Add it to GitHub repository secrets as `DOCKERHUB_TOKEN`

**CI/CD Workflow:**

- **Pull Requests**: Build multi-arch images (test only, no push)
- **Push to main**: Build, test, and push images with `latest` tag and commit SHA
- **Version tags** (e.g., `v1.0.0`): Build, test, and push with semantic version tags

All images are built for both `linux/amd64` and `linux/arm64` platforms.

## Security Considerations

### SSRF Protection (Enabled by Default)

This service implements SSRF (Server-Side Request Forgery) protection by default:
- Blocks `file://` URLs to prevent local file access
- Blocks requests to private IP ranges (127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16)
- Blocks IPv6 loopback and link-local addresses
- Limits data URLs to 1MB to prevent DoS attacks

**To disable SSRF protection** (not recommended in production), set `DISABLE_SSRF_PROTECTION=true`.

External resources (CDNs, public images, fonts) are allowed by default.

### Additional Security Recommendations

In production environments, consider:
- Running in an isolated network segment
- Using firewall rules to restrict outbound connections
- Implementing rate limiting at the reverse proxy level
- Not exposing this service directly to untrusted users
- Regular security updates of base images and dependencies

## Development

Start the development server:

```bash
yarn dev
```

See my blog post for more usage information: https://blog.timo.page/rendering-html-to-pdf-in-laravel-and-docker

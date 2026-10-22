# headless-pdf-renderer

This is a simple HTTP server that offers an endpoint to render
HTML to PDF using Google Chrome with Puppeteer.

## Requirements

- Node.js 20+ (recommended: Node.js 22)
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
| `PUPPETEER_EXECUTABLE_PATH` | `google-chrome-stable`  | Browser binary                                                |
| `BODY_SIZE_LIMIT`           | `10mb`                  | Maximum size for request body (supports values like '10mb', '1gb') |

One browser is shared by all requests, each render gets its own browser context.
Plan for roughly 250–400 MB for the browser plus 50–90 MB per concurrent render.

On SIGINT/SIGTERM the server stops accepting requests and waits for the running
renders, so give the container a stop timeout of at least `PAGE_TIMEOUT_MS`
(`docker stop -t`, `stop_grace_period` in Compose).

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

## Security Considerations

**SSRF Warning**: This service renders arbitrary HTML, which may include external resources.
In production environments, consider:
- Running in an isolated network segment
- Using firewall rules to restrict outbound connections
- Implementing request filtering/validation at the application level
- Not exposing this service directly to untrusted users

## Development

Start the development server:

```bash
yarn dev
```

See my blog post for more usage information: https://blog.timo.page/rendering-html-to-pdf-in-laravel-and-docker

FROM node:24-bookworm-slim AS build

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

WORKDIR /app
COPY package.json yarn.lock /app/
RUN yarn install --frozen-lockfile
COPY babel.config.js /app/
COPY src /app/src
RUN yarn run build


FROM node:24-bookworm-slim AS deps

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

WORKDIR /app
COPY package.json yarn.lock /app/
RUN yarn install --frozen-lockfile --production


FROM node:24-bookworm-slim

ARG TARGETARCH
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Google Chrome has no Linux arm64 build, so arm64 uses Debian's Chromium.
# Puppeteer 5 on arm64 always launches /usr/bin/chromium-browser and ignores executablePath.
RUN FONTS="fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf" \
    && apt-get update \
    && if [ "$TARGETARCH" = "arm64" ]; then \
      apt-get install -y chromium tini $FONTS --no-install-recommends \
      && ln -s /usr/bin/chromium /usr/bin/google-chrome-stable \
      && ln -s /usr/bin/chromium /usr/bin/chromium-browser; \
    else \
      apt-get install -y wget gnupg ca-certificates --no-install-recommends \
      && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg \
      && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google.list \
      && apt-get update \
      && apt-get install -y google-chrome-stable tini $FONTS --no-install-recommends; \
    fi \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -r pptruser && useradd -r -g pptruser -G audio,video pptruser \
    && mkdir -p /home/pptruser/Downloads \
    && chown -R pptruser:pptruser /home/pptruser

WORKDIR /app
VOLUME /app/storage
COPY --from=deps --chown=pptruser:pptruser /app/node_modules/ /app/node_modules/
COPY --from=build --chown=pptruser:pptruser /app/dist/ /app/

STOPSIGNAL SIGINT

USER pptruser

# tini reaps zombie Chrome processes and forwards signals to node
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "index.js"]

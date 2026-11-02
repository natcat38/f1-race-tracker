# Multi-stage image for the single Go binary: builds the React SPA, embeds it,
# and ships the gateway/replay server.

# Build the React SPA
FROM node:24@sha256:be23f54a88d34e8824c741b19b91064094f92c1c97b194144bfc8b50d67258e2 AS web
WORKDIR /web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build   # outputs web/dist

# Build the Go server, embedding the SPA
FROM golang:1.27.3@sha256:2920bb124f1a2e12a1d39f0cab756ae0068441ee1da7655dec7f5e374944095b AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=web /web/dist ./web/dist
RUN CGO_ENABLED=0 go build -o /server ./cmd/server

# Minimal runtime image — :nonroot runs as an unprivileged UID by default
FROM gcr.io/distroless/static-debian12:nonroot@sha256:afa5c872c891853ca7fcf1f12c3edb23f7eeef36189728842dd51042ff57f7ab
COPY --from=build /server /server
COPY --from=build /src/data /data
ENV CLIP_FILE=/data/replays/monza-2024-race.jsonl
EXPOSE 8080
ENTRYPOINT ["/server"]

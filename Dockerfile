# Multi-stage image for the single Go binary: builds the React SPA, embeds it,
# and ships the gateway/replay server.

# Build the React SPA
FROM node:26@sha256:f5d1cc40abc10c2843339a2134d07817cf33c405cb16bfd052b0ed790254c3a3 AS web
WORKDIR /web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build   # outputs web/dist

# Build the Go server, embedding the SPA
FROM golang:1.26@sha256:9d2f36f06329b2a141b9db99ffa32765cf695ee57b813ca29e245e8670bcbfff AS build
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

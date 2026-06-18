# Build the React SPA
FROM node:24 AS web
WORKDIR /web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build   # outputs web/dist

# Build the Go server, embedding the SPA
FROM golang:1.26 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=web /web/dist ./web/dist
RUN CGO_ENABLED=0 go build -o /server ./cmd/server

# Minimal runtime image
FROM gcr.io/distroless/static-debian12
COPY --from=build /server /server
COPY --from=build /src/data /data
ENV CLIP_FILE=/data/replays/monza-2024-race.jsonl
EXPOSE 8080
ENTRYPOINT ["/server"]

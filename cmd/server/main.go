package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/natcat38/f1-race-tracker/internal/app"
	"github.com/natcat38/f1-race-tracker/internal/bus"
	"github.com/natcat38/f1-race-tracker/internal/config"
	"github.com/natcat38/f1-race-tracker/internal/feed/replay"
	"github.com/natcat38/f1-race-tracker/web"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	cfg := config.Load()

	opt, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		logger.Error("bad REDIS_URL", "err", err)
		os.Exit(1)
	}
	b := bus.New(redis.NewClient(opt))

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	switch cfg.Role {
	case "replay":
		src, err := replay.Load(cfg.ClipFile, cfg.Speed)
		if err != nil {
			logger.Error("load clip", "err", err)
			os.Exit(1)
		}
		logger.Info("replay writer starting", "session", cfg.Session, "label", src.Label())
		if err := app.NewWriter(b, src, logger).Run(ctx, cfg.Session); err != nil && ctx.Err() == nil {
			logger.Error("writer stopped", "err", err)
			os.Exit(1)
		}
	case "gateway":
		gw, err := app.NewGateway(ctx, b, cfg.Session, logger)
		if err != nil {
			logger.Error("gateway init", "err", err)
			os.Exit(1)
		}
		mux := http.NewServeMux()
		gw.Mount(mux, http.FileServer(http.FS(web.FS())))
		srv := &http.Server{Addr: cfg.Addr, Handler: mux}
		go func() {
			<-ctx.Done()
			sh, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			_ = srv.Shutdown(sh)
		}()
		logger.Info("gateway listening", "addr", cfg.Addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("server error", "err", err)
			os.Exit(1)
		}
	default:
		logger.Error("unknown ROLE (want replay|gateway)", "role", cfg.Role)
		os.Exit(1)
	}
}

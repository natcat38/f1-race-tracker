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
	if err := cfg.Validate(); err != nil {
		logger.Error(err.Error())
		os.Exit(1)
	}

	opt, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		logger.Error("bad REDIS_URL", "err", err)
		os.Exit(1)
	}
	b := bus.New(redis.NewClient(opt))

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	switch cfg.Role {
	case config.RoleReplay:
		src, err := replay.Load(cfg.ClipFile, cfg.Speed)
		if err != nil {
			logger.Error("load clip", "err", err)
			os.Exit(1)
		}
		src.SetWallclockPhase(cfg.PhaseWallclock)
		logger.Info("replay writer starting", "session", cfg.Session, "label", src.Label(), "wallclock", cfg.PhaseWallclock)
		if err := app.NewWriter(b, src, logger).Run(ctx, cfg.Session); err != nil && ctx.Err() == nil {
			logger.Error("writer stopped", "err", err)
			os.Exit(1)
		}
	case config.RoleGateway:
		gw, err := app.NewGateway(ctx, b, cfg.Session, logger, cfg.AllowedOrigins...)
		if err != nil {
			logger.Error("gateway init", "err", err)
			os.Exit(1)
		}
		mux := http.NewServeMux()
		gw.Mount(mux, http.FileServer(http.FS(web.FS())))
		// ReadHeaderTimeout guards against slow-header (Slowloris) requests; no WriteTimeout
		// because WebSocket connections are long-lived. IdleTimeout only bounds the
		// plain-HTTP surface (static SPA, /healthz, /control/source) between keep-alive
		// requests — a WebSocket conn is hijacked out of net/http's control once
		// upgraded, so this doesn't affect (and can't wrongly reap) an open WS client.
		srv := &http.Server{Addr: cfg.Addr, Handler: mux, ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 120 * time.Second}
		go func() {
			<-ctx.Done()
			sh, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if err := srv.Shutdown(sh); err != nil {
				logger.Warn("graceful shutdown did not complete cleanly", "err", err)
			}
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

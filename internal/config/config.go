package config

import (
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"strings"
)

// Role selects which process this binary runs as (see cmd/server/main.go).
type Role string

const (
	RoleGateway Role = "gateway"
	RoleReplay  Role = "replay"
)

func (r Role) Valid() bool { return r == RoleGateway || r == RoleReplay }

type Config struct {
	Role           Role
	RedisURL       string
	Session        string
	ClipFile       string
	Speed          float64
	Addr           string
	PhaseWallclock bool
	AllowedOrigins []string // WebSocket origin allowlist (coder/websocket OriginPatterns)
}

// Validate reports an error for an unusable config. Call before any side effects
// (e.g. dialing Redis) so a bad ROLE fails at the boundary, not after setup.
func (c Config) Validate() error {
	if !c.Role.Valid() {
		return fmt.Errorf("config: invalid ROLE %q (want %q or %q)", c.Role, RoleGateway, RoleReplay)
	}
	return nil
}

func Load() Config {
	return Config{
		Role:           Role(env("ROLE", string(RoleGateway))),
		RedisURL:       env("REDIS_URL", "redis://localhost:6379"),
		Session:        env("SESSION_KEY", "demo"),
		ClipFile:       env("CLIP_FILE", "data/replays/monza-2024-race.jsonl"),
		Speed:          envFloat("SPEED", 1),
		Addr:           env("ADDR", ":8080"),
		PhaseWallclock: env("PHASE_WALLCLOCK", "") != "",
		AllowedOrigins: allowedOrigins(),
	}
}

// allowedOrigins reads ALLOWED_ORIGINS (comma-separated) for the WebSocket origin allowlist,
// defaulting to localhost so both local dev (vite :5173) and local prod (:8080) work while
// external origins are rejected. In real deployments set ALLOWED_ORIGINS to the served host.
func allowedOrigins() []string {
	if v := os.Getenv("ALLOWED_ORIGINS"); v != "" {
		var out []string
		for _, p := range strings.Split(v, ",") {
			if p = strings.TrimSpace(p); p != "" {
				out = append(out, p)
			}
		}
		return out
	}
	return []string{"localhost:*", "127.0.0.1:*"}
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

// envFloat reads a float64 env var, falling back to def when unset or unparseable.
func envFloat(k string, def float64) float64 {
	if v := os.Getenv(k); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil {
			return f
		}
		slog.Warn("unparseable env value, using default", "key", k, "value", v, "default", def)
	}
	return def
}

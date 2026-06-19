package config

import "os"

type Config struct {
	Role           string
	RedisURL       string
	Session        string
	ClipFile       string
	Speed          float64
	Addr           string
	PhaseWallclock bool
}

func Load() Config {
	return Config{
		Role:           env("ROLE", "gateway"),
		RedisURL:       env("REDIS_URL", "redis://localhost:6379"),
		Session:        env("SESSION_KEY", "demo"),
		ClipFile:       env("CLIP_FILE", "data/replays/monza-2024-race.jsonl"),
		Speed:          1,
		Addr:           env("ADDR", ":8080"),
		PhaseWallclock: env("PHASE_WALLCLOCK", "") != "",
	}
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

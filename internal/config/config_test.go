package config

import "testing"

func TestLoad_Defaults(t *testing.T) {
	// Empty means "unset" to env(), so this exercises every default path.
	for _, k := range []string{"ROLE", "REDIS_URL", "SESSION_KEY", "CLIP_FILE", "SPEED", "ADDR", "PHASE_WALLCLOCK", "ALLOWED_ORIGINS"} {
		t.Setenv(k, "")
	}
	cfg := Load()
	if cfg.Role != "gateway" || cfg.RedisURL != "redis://localhost:6379" || cfg.Session != "demo" {
		t.Errorf("defaults wrong: %+v", cfg)
	}
	if len(cfg.AllowedOrigins) != 2 {
		t.Errorf("AllowedOrigins default = %v, want 2 localhost patterns", cfg.AllowedOrigins)
	}
	if cfg.Speed != 1 {
		t.Errorf("Speed default = %v, want 1", cfg.Speed)
	}
	if cfg.PhaseWallclock {
		t.Error("PhaseWallclock should default false when unset")
	}
}

func TestLoad_SpeedFromEnv(t *testing.T) {
	t.Setenv("SPEED", "2.5")
	if got := Load().Speed; got != 2.5 {
		t.Errorf("Speed = %v, want 2.5", got)
	}
	t.Setenv("SPEED", "not-a-number")
	if got := Load().Speed; got != 1 {
		t.Errorf("unparseable SPEED should fall back to 1, got %v", got)
	}
}

// PHASE_WALLCLOCK enables on ANY non-empty value — including the string "false".
// Lock in that footgun so nobody silently "fixes" it into a truthy-string parse.
func TestLoad_PhaseWallclockIsPresenceNotTruthiness(t *testing.T) {
	t.Setenv("PHASE_WALLCLOCK", "false")
	if !Load().PhaseWallclock {
		t.Error(`PHASE_WALLCLOCK="false" still enables the flag (presence check) — expected true`)
	}
}

func TestValidate_AcceptsKnownRoles(t *testing.T) {
	for _, r := range []Role{RoleGateway, RoleReplay} {
		if err := (Config{Role: r}).Validate(); err != nil {
			t.Errorf("Role %q should be valid, got err: %v", r, err)
		}
	}
}

func TestValidate_RejectsUnknownRole(t *testing.T) {
	if err := (Config{Role: "bogus"}).Validate(); err == nil {
		t.Error("expected an error for an unknown ROLE, got nil")
	}
}

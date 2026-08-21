// Tests for environment loading: defaults, overrides, and validation of every
// configurable knob.

package config

import "testing"

func TestLoad_Defaults(t *testing.T) {
	// Empty means "unset" to env(), so this exercises every default path.
	for _, k := range []string{"ROLE", "REDIS_URL", "SESSION_KEY", "CLIP_FILE", "SPEED", "ADDR", "PHASE_WALLCLOCK", "ALLOWED_ORIGINS", "ALLOWED_SESSIONS"} {
		t.Setenv(k, "")
	}
	cfg := Load()
	if cfg.Role != "gateway" || cfg.RedisURL != "redis://localhost:6379" || cfg.Session != "demo" {
		t.Errorf("defaults wrong: %+v", cfg)
	}
	if len(cfg.AllowedOrigins) != 2 {
		t.Errorf("AllowedOrigins default = %v, want 2 localhost patterns", cfg.AllowedOrigins)
	}
	if len(cfg.AllowedSessions) != 0 {
		t.Errorf("AllowedSessions default = %v, want empty (gateway compare-lane default applies)", cfg.AllowedSessions)
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

func TestLoad_AllowedSessionsFromEnv(t *testing.T) {
	t.Setenv("ALLOWED_SESSIONS", " compare-monza-2024 , compare-spa-2025 ")
	got := Load().AllowedSessions
	if len(got) != 2 || got[0] != "compare-monza-2024" || got[1] != "compare-spa-2025" {
		t.Errorf("AllowedSessions = %v, want [compare-monza-2024 compare-spa-2025] trimmed", got)
	}
	t.Setenv("ALLOWED_SESSIONS", "")
	if got := Load().AllowedSessions; len(got) != 0 {
		t.Errorf("AllowedSessions with blank env = %v, want empty (gateway default applies)", got)
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

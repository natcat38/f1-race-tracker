// Package web embeds the built React SPA for same-origin serving.
package web

import (
	"embed"
	"io/fs"
)

// The all: prefix includes dotfiles, so a clean checkout (where dist holds only
// .gitkeep, the built SPA being gitignored) still compiles. Docker builds the real
// SPA into dist before `go build`, so production embeds the actual assets.
//go:embed all:dist
var dist embed.FS

// FS returns the built SPA as a filesystem rooted at dist/.
func FS() fs.FS {
	sub, err := fs.Sub(dist, "dist")
	if err != nil {
		panic(err)
	}
	return sub
}

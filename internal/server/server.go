// Package server wires the Attribute Lab HTTP routes: the static frontend
// and the htmx fragment endpoints the demo presets call.
package server

import (
	"io/fs"
	"net/http"
)

// New builds the top-level router for the application, serving static from
// the given filesystem (the project's static/ directory).
func New(static fs.FS) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /healthz", handleHealthz)
	mux.HandleFunc("GET /api/demo", handleDemo)
	mux.Handle("GET /", http.FileServer(http.FS(static)))

	return mux
}

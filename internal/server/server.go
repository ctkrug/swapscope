// Package server wires the Attribute Lab HTTP routes: the static frontend
// and the htmx fragment endpoints the demo presets call.
package server

import (
	"net/http"
)

// New builds the top-level router for the application.
func New() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /healthz", handleHealthz)

	return mux
}

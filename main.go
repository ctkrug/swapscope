// Command attribute-lab runs the Attribute Lab demo server: it serves the
// static frontend and the htmx fragment endpoints the frontend calls.
package main

import (
	"embed"
	"io/fs"
	"log"
	"net/http"
	"os"

	"github.com/ctkrug/attribute-lab/internal/server"
)

//go:embed static
var staticFS embed.FS

func main() {
	addr := ":" + envOr("PORT", "8080")

	static, err := fs.Sub(staticFS, "static")
	if err != nil {
		log.Fatal(err)
	}

	mux := server.New(static)

	log.Printf("attribute-lab listening on %s", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatal(err)
	}
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

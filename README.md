# Attribute Lab

[![CI](https://github.com/ctkrug/attribute-lab/actions/workflows/ci.yml/badge.svg)](https://github.com/ctkrug/attribute-lab/actions/workflows/ci.yml)

Click an `hx-*` attribute preset on a live demo element and watch the actual network
request and the resulting DOM patch animate **in sync, side by side**. Not a cheat sheet
you read — a machine you watch run.

## Why

htmx's whole pitch is "attributes drive behavior," but every reference for it is static
prose: a table of attribute names next to a one-line description. You end up reading about
`hx-swap="outerHTML"` without ever *seeing* what "outer" actually replaces versus
`innerHTML`. Attribute Lab closes that gap — pick a preset, watch the wire, watch the DOM.

## The wow moment

Toggle `hx-swap` from `innerHTML` to `outerHTML` on a live button. The request panel fires
the real HTTP call htmx made (method, headers, response body). At the same instant, the
exact DOM node(s) that got replaced flash-highlight in the live element pane — so the
difference between "replace what's inside" and "replace the whole element" is something
you *see happen*, not something you infer from a paragraph.

## How it works

- A small **Go** server exposes a handful of demo endpoints that return htmx-flavored HTML
  fragments (the same kind of responses a real htmx backend would send).
- The frontend is plain **HTMX** wired to a live demo element. A lightweight instrumentation
  layer taps `htmx:beforeRequest` / `htmx:afterRequest` / `htmx:beforeSwap` /
  `htmx:afterSwap` to drive two synced panels:
  - **Network panel** — method, URL, request headers, response status, response body.
  - **DOM patch panel** — the live element, with swapped nodes flash-highlighted the
    instant the swap lands.
- Presets are just attribute combinations (`hx-get` + `hx-trigger` + `hx-swap` + `hx-target`,
  etc.) applied to the demo element via a dropdown/toggle UI — no code editing required.

## Planned features

- [ ] Preset picker covering the core `hx-*` surface: `hx-get`/`hx-post`, `hx-trigger`,
      `hx-swap` (all swap strategies), `hx-target`, `hx-select`, `hx-indicator`.
- [ ] Live network panel: real request/response, not a mock — driven by htmx's own events.
- [ ] Live DOM patch panel: flash-highlight of exactly the nodes htmx swapped.
- [ ] Side-by-side sync: request fires and patch highlight land within the same visible beat.
- [ ] Swap-strategy comparison mode: fire the same trigger against two swap strategies at once.
- [ ] Shareable preset links (state encoded in the URL).

## Stack

- **Backend:** Go (`net/http`, stdlib only where practical) serving htmx fragment endpoints
  and the static frontend.
- **Frontend:** HTMX + vanilla JS/CSS — no framework, no build step required to run.
- **Tests:** Go's built-in `testing` package for handler/fragment behavior.

## Status

Early scaffold — see [`docs/VISION.md`](docs/VISION.md) for the full design,
[`docs/DESIGN.md`](docs/DESIGN.md) for the visual direction, and
[`docs/BACKLOG.md`](docs/BACKLOG.md) for the build plan.

## License

MIT — see [`LICENSE`](LICENSE).

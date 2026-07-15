# Architecture

A concise map of the codebase for anyone picking this project up cold. See
`docs/VISION.md` for why it exists and `docs/DESIGN.md` for the visual system.

## Layout

```
main.go                        entrypoint: embeds static/, builds the mux, listens on $PORT
internal/server/
  server.go                    routes: GET /healthz, GET /api/demo, GET / (static file server)
  health.go                    liveness check
  fragments.go                 the demo endpoint — the whole product's credibility hinges on this
  *_test.go                    handler tests (net/http/httptest, no server process needed)
static/
  index.html                   the single page: preset bar (5 groups), live element + external
                                target, network + patch panels
  css/style.css                docs/DESIGN.md tokens and the blueprint visual system
  js/
    lab-core.mjs                pure logic: preset URL/trigger-attribute building, status
                                bucketing, header parsing, escaping, and the gen-scoped
                                highlight splitter — zero DOM access
    lab-core.test.mjs           node --test coverage for the above
    app.js                      DOM glue: htmx event listeners, preset wiring, connector lines
```

## The preset surface

Five preset groups in the preset bar, each backed by a field on `app.js`'s `presetState`:

| Group | Values | Drives |
|---|---|---|
| `hx-swap` | `innerHTML`, `outerHTML` | `hx-swap` attribute + fragment shape |
| `hx-trigger` | `click`, `revealed`, `delay` | `hx-trigger` via `lab-core.mjs: triggerAttrForPreset` |
| `hx-target` | `self`, `external` | `hx-target` — `#demo-el` vs `#demo-target-external` |
| `hx-select` | on/off | `hx-select="[data-fragment-content]"` |
| `hx-indicator` | on/off | `hx-indicator="#demo-indicator"` + backend delay |

`app.js: syncDemoElAttributes` is the single place that turns `presetState` into the demo
button's `hx-*` attributes, and `lab-core.mjs: demoUrl(state)` turns it into the `/api/demo`
query string (`swap`, `target`, `select=1`, `indicator=1`).

## Request/response flow (the wow moment)

1. Clicking a preset control updates `presetState` and calls `app.js: applyPreset`, which
   rebuilds every `hx-*` attribute on `#demo-el` via `syncDemoElAttributes` and calls
   `htmx.process(target)` — **required**, because htmx resolves and caches an element's
   verb/path/trigger the first time it binds the element, so mutating those attributes
   afterward is invisible until the element is reprocessed.
2. Clicking `#demo-el` fires the real htmx request. `htmx:configRequest` is used to read the
   verb/path/headers actually being sent (network panel's "request" side).
3. `internal/server/fragments.go: handleDemo` renders a fragment shaped by the query string:
   - `swap=innerHTML` → only the replacement content (a `<span data-gen="N">`).
   - `swap=outerHTML` + `target=self` → the *whole* replacement element, re-declaring
     `hx-get`/`hx-target`/`hx-swap` — outerHTML swaps replace the triggering element itself, so
     if the response didn't restate those attributes, the demo would go dead after one click.
     This is a real htmx gotcha, shown live rather than described. `target=external` never needs
     this: the trigger button lives outside the swapped subtree.
   - `select=1` wraps the payload in `wrapWithSelectNoise`, stamping the real payload's root
     with `data-fragment-content` so the frontend's `hx-select="[data-fragment-content]"` filters
     the noise out before swap — the network panel still shows the full, unfiltered body.
   - `indicator=1` sleeps `demoIndicatorDelay` (600ms) before responding, long enough for the
     `hx-indicator`-driven loading chip to actually be visible.
   Every fragment is stamped with a process-wide, monotonically increasing `data-gen` counter.
4. `htmx:afterRequest` populates the network panel's response side (status, body) straight from
   the XHR — nothing here is synthesized.
5. `htmx:afterSettle` (not `afterSwap`) triggers `app.js: renderPatchPanel`, which reads the
   active target's (`#demo-el` or `#demo-target-external`, per `lastRequestState.target`)
   *current* `outerHTML` from the live DOM and runs it through `lab-core.mjs:
   splitHighlightSegments` with the latest `data-gen`. That function finds the element(s) whose
   opening tag carries the matching `data-gen` and returns highlighted/non-highlighted text
   segments; nested matches (e.g. the outerHTML wrapper and its inner span sharing a gen)
   collapse to the outer boundary. The result is escaped and re-assembled with real `<mark>`
   tags for the patch panel.

   **Why `afterSettle`, not `afterSwap`:** for an outerHTML swap, htmx captures the newly
   inserted element's class list right after insertion and re-applies that captured string once
   settling finishes, to strip its own transitional `htmx-swapping`/`htmx-added`/`htmx-settling`
   classes. A class mutation made during `afterSwap` (e.g. the flash-highlight) races that
   capture and can be silently discarded; `afterSettle` guarantees htmx's own cleanup already
   happened. The external target's "is the active target" emphasis avoids the race entirely by
   living on a stable `.external-target-wrap` that htmx never swaps, rather than on
   `#demo-target-external` itself.
6. Connector lines (`app.js: positionConnectors`/`fireConnectors`) are measured against the
   actual zone bounding boxes and given a `stroke-dasharray` equal to their own length, so the
   `stroke-dashoffset` CSS animation reads as the line drawing itself rather than marching dashes.
   Below ~1024px the diagonal lines are hidden in favor of `.rig-pulse`, a simple vertical bar.

The preset bar's "copy link" control (`app.js`, wired to `[data-copy-link]`) just makes this
existing behavior discoverable — it copies `window.location.href` via the Clipboard API and
shows a transient "copied!"/"copy failed" state, falling back to the failure state rather
than a silent no-op when the API is unavailable.

## Accessibility

The three `.preset-toggle` groups are real ARIA radiogroups, not just visually-grouped
buttons: `app.js: setActiveToggleOption` gives only the checked option `tabindex="0"`
(the rest get `-1`), and `handleRadiogroupKeydown` (backed by the pure `lab-core.mjs:
nextRadioIndex`) handles Left/Right/Up/Down/Home/End to move and select within the group.
This is the standard WAI-ARIA roving-tabindex pattern — Tab enters/exits each group in a
single stop, matching what the `role="radiogroup"`/`role="radio"` markup already promised
(before this, every individual radio button was its own Tab stop, which contradicts the
announced role).

A screen-reader-only `[data-field="status-announcer"]` region (`aria-live="polite"`,
`.visually-hidden`) is updated once per request/patch cycle by `app.js:
announceRequestOutcome`, via the pure `lab-core.mjs: describeRequestOutcome`. It's
deliberately a short summary sentence rather than the raw response body or patch markup —
a live region re-reads its entire content on every change, so dumping verbose HTML into it
would be unusable with a screen reader.

## Shareable preset links

`presetState` is seeded on load from `window.location.search` via `lab-core.mjs:
decodePresetState`, and `app.js: applyPreset` rewrites the URL (via `history.replaceState`,
never `pushState` — clicking through presets shouldn't spam browser history) to
`encodePresetState(presetState)` after every change. The two are inverses, so copying the
address bar at any point reproduces the exact demo on screen. `decodePresetState` validates
each field independently against the known preset lists and falls back to
`DEFAULT_PRESET_STATE` per-field, so a hand-edited or stale URL degrades to the default demo
instead of crashing. `app.js: hydrateControlsFromState` reconciles the visible toggle/switch
chips with the seeded state at load — `applyPreset` alone only drives the demo element's
attributes, not the picker's own chip styling.

## Why the highlight logic lives in a separate pure module

`lab-core.mjs` has no DOM access, which is what makes it runnable directly under
`node --test` (see `static/js/lab-core.test.mjs`) without a browser or jsdom. `app.js` is the
thin, harder-to-unit-test DOM glue layer; keeping the parsing/formatting logic out of it is
what makes the interesting bug classes (gen-matching, header parsing, highlight splitting)
testable in isolation.

## Subpath deployment

The project is deployed at `apps.charliekrug.com/attribute-lab/`, a subpath, not a domain
root. Every asset reference (`css/style.css`, `js/app.js`) and the demo fragment endpoint
(`api/demo`) is relative (no leading slash), and `<base href="./">` in `index.html` makes that
resolution correct even if the deployed URL is visited without a trailing slash.

There's no separate static export step: `make build` produces one self-contained binary
(`bin/attribute-lab`) with `static/` embedded via `//go:embed`, and that binary serves both
the frontend and the `/api/demo`/`/healthz` endpoints itself. The reverse proxy in front of
it strips the `/attribute-lab` prefix before forwarding to the binary's own root-relative
routes (e.g. nginx `location /attribute-lab/ { proxy_pass http://127.0.0.1:<port>/; }`) —
this was verified locally by fronting a running instance with a prefix-stripping proxy and
confirming every asset request and the `/api/demo` fetch resolve with no 404s.

## Running it

```
make build    # go build -o bin/attribute-lab .
make run      # build + run, PORT env var overrides the default :8080
make test     # go test ./... && node --test static/js/*.test.mjs
make vet
make fmt      # gofmt -l . (lists files needing formatting)
```

`main.go` embeds `static/` at compile time (`//go:embed static`), so changes to any file under
`static/` require a rebuild to take effect when running the compiled binary.

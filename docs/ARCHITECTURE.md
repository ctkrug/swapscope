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
  sw.js                        service worker: answers api/demo in-browser on static hosts
                                (no Go runtime) via the JS fragment port — see Deployment
  js/
    lab-core.mjs                pure logic: preset URL/trigger-attribute building, status
                                bucketing, header parsing, escaping, comparison-lab config
                                derivation, and the gen-scoped highlight splitter — zero DOM
    lab-core.test.mjs           node --test coverage for the above
    lab-core.property.test.mjs  fast-check property tests (round-trip, escaping, highlight)
    demo-fragment.mjs           byte-for-byte JS port of fragments.go + the stateful api/demo
                                responder (gen counter, indicator delay) the worker installs
    demo-fragment.test.mjs      golden-manifest parity test (JS render == Go bytes) + parsing
    demo-responder.test.mjs     responder unit tests (gen, delay, validate-before-effects)
    sw.integration.test.mjs     drives sw.js's real listeners under a stubbed worker self
    app.js                      DOM glue: single-view htmx event listeners, preset wiring,
                                connector lines, the compare-mode toggle, and SW registration
    compare.mjs                 DOM glue: the two-lab comparison rig — per-lab htmx event
                                routing, post-swap attribute re-assertion, patch rendering
    compare.smoke.test.mjs      jsdom smoke coverage for app.js + compare.mjs wiring
testdata/
  fragments.golden.json        Go-authored fragment bytes both backends assert against
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
3. The `api/demo` request is answered by whichever backend the deploy has: the Go
   `internal/server/fragments.go: handleDemo` for `make run`/self-host, or the service worker
   (`static/sw.js` + `static/js/demo-fragment.mjs`) on the static CDN, which have no Go runtime.
   Both produce **byte-identical** fragments (pinned by the golden manifest — see Deployment),
   so this description holds regardless of which one served the bytes. The fragment is shaped by
   the query string:
   - `swap=innerHTML` → only the replacement content (a `<span data-gen="N">`).
   - `swap=outerHTML` + `target=self` → the *whole* replacement element, re-declaring
     `hx-get`/`hx-target`/`hx-swap` — outerHTML swaps replace the triggering element itself, so
     if the response didn't restate those attributes, the demo would go dead after one click.
     This is a real htmx gotcha, shown live rather than described. `target=external` never needs
     this: the trigger button lives outside the swapped subtree.
   - `select=1` wraps the payload in `wrapWithSelectNoise`, stamping the real payload's root
     with `data-fragment-content` so the frontend's `hx-select="[data-fragment-content]"` filters
     the noise out before swap — the network panel still shows the full, unfiltered body. Only
     the swap root is marked, never a node nested inside it: htmx resolves `hx-select` via
     `querySelectorAll` and `appendChild`-moves each match, so a second, nested match would be
     hoisted out of its wrapper and duplicated.
   - `indicator=1` sleeps `demoIndicatorDelay` (600ms) before responding, long enough for the
     `hx-indicator`-driven loading chip to actually be visible.
   Every fragment is stamped with a process-wide, monotonically increasing `data-gen` counter.
4. `htmx:afterRequest` populates the network panel's response side (status, headers, body)
   straight from the XHR — nothing here is synthesized. Response headers come from
   `lab-core.mjs: parseResponseHeaders(xhr.getAllResponseHeaders())`.
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

## Comparison mode (`compare.mjs`)

The preset bar's **"compare swaps" mode toggle** (`[data-compare-toggle]`, backed by
`presetState.compare`, also URL-encoded so it's shareable) swaps the single rig for the
`#compare-rig`: two labs side by side, one `hx-swap="innerHTML"`, one `hx-swap="outerHTML"`,
holding every other axis fixed. `app.js: applyCompareMode` toggles which rig is visible and
disables the presets that no longer apply while comparing (swap is the compared axis, trigger
is the shared button, target is pinned to self via `lab-core.mjs: comparisonLabConfigs`).

- **One shared trigger.** Both lab elements carry `hx-trigger="click from:#compare-fire"`, so
  the single "Fire both" button fires both real requests at once — no JS request dispatch.
- **Per-lab instrumentation, one event stream.** htmx events all fire on `document.body`, so
  `compare.mjs` routes each to the lab whose `.compare-lab` root `contains(evt.detail.elt)`,
  and the single-view handlers in `app.js` early-return on any event inside `#compare-rig`
  (`isCompareEvent`). The two views never cross-drive.
- **Surviving the outerHTML swap.** The `outerHTML` fragment comes back re-declaring
  `id="demo-el"` (fragments.go restates the single view's identity), so after every settle
  `compare.mjs: syncLab` re-stamps the lab's own id (`cmp-outer-el`) and re-asserts its full
  `hx-*` set + `htmx.process` — the comparison-mode analogue of `syncDemoElAttributes`, and
  the reason both labs keep firing off the shared button after the first outerHTML swap.
- **Layout.** Two graph-paper zones in a `1fr/1fr` grid on the blueprint tokens; at ≤1023px
  the grid collapses to one column in fire order and "Fire both" goes full width. A "hidden"
  rig is pinned to `display:none` (`.rig[hidden]`/`.compare-rig[hidden]`) because `.rig`'s
  explicit `display:grid` (author origin) would otherwise beat the UA `[hidden]` rule.

The DOM glue in `app.js`/`compare.mjs` sits outside the DOM-free `lab-core` tests, so
`compare.smoke.test.mjs` drives the real modules against a jsdom document with a stubbed
htmx to cover the toggle, per-lab routing, id re-stamping, and the hidden-rig cascade.

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

## Deployment (two backends, one fragment contract)

The project is published as **static files to a CDN** (`apps.charliekrug.com/attribute-lab/`, a
subpath, not a domain root) — there is no Go runtime in production. That's the whole reason the
service worker exists: a static host would 404 every `api/demo` fetch, killing the entire demo.
So the fragment logic has two backends behind one byte-for-byte contract:

- **Static CDN (production).** `static/sw.js` is a module service worker scoped to the app root
  (it lives at the site root, not `js/`, because a worker can only control URLs under its own
  directory). It intercepts *only* `api/demo` and synthesizes the response in the browser via
  `demo-fragment.mjs`'s renderer + stateful responder; every other request (page, CSS, JS,
  fonts) falls through to the network untouched, so there's no asset cache to go stale. htmx
  still issues a real request and reads real response headers off it — only the byte *source*
  moves from the Go process to the worker, preserving VISION's "real requests, not mocked."
- **`make run` / self-host.** The Go binary (`main.go`, `static/` embedded via `//go:embed`)
  serves the frontend and answers `api/demo`/`healthz` itself. The worker registers here too and
  is a harmless, identical shim.

**The contract.** `internal/server/golden_test.go` renders every swap × target × select
fragment with Go into `testdata/fragments.golden.json`; both the Go renderer and the JS port
(`demo-fragment.test.mjs`) assert against that one file, so any drift between the two backends
fails a test. Regenerate after an intentional fragment change with
`UPDATE_GOLDEN=1 go test ./internal/server -run TestFragmentGolden`.

**Subpath resolution.** Every asset reference and the `api/demo` endpoint is relative (no leading
slash), and `<base href="./">` in `index.html` makes that correct even when the deployed URL is
visited without a trailing slash. The worker's registration path (`sw.js`) and its own import
(`./js/demo-fragment.mjs`) are likewise relative, so the same files work at a subpath or the
domain root with no build-time rewriting.

**First-visit note.** `skipWaiting` + `clients.claim()` let the worker take control of the
already-open page shortly after a fresh first load — well before a human clicks a preset. On the
rare race where the very first fire beats activation, that one request hits the network; a
reload (by which point the worker controls the page) resolves it.

## Test coverage and hardening notes

`internal/server` is at 100% line coverage and `static/js/lab-core.mjs` at 100% line / ~96%
branch coverage (`node --test --experimental-test-coverage`). A few non-obvious things the
test suite pins down, worth knowing before "simplifying" the code they cover:

- **`handleDemo`'s own `r.Method != http.MethodGet` check is reachable only via HEAD.** The
  route is registered as `"GET /api/demo"`, so Go's `net/http.ServeMux` (1.22+) rejects every
  other verb with its own 405 before `handleDemo` ever runs — except HEAD, which the mux
  routes to the GET handler per net/http's documented "GET matches HEAD too" behavior. See
  `TestDemoFragmentRejectsHeadRequest`.
- **The demo gen counter is `-race`-clean under real concurrency**, not just sequentially
  incrementing (`TestDemoFragmentGenerationIsUniqueUnderConcurrentRequests`, 50 concurrent
  requests). CI and `make test-go` both run `go test -race`.
- **`splitHighlightSegments`/`findMatchingTagEnd` degrade to "no highlight" rather than
  throwing** on truncated/malformed markup (a response cut off mid-stream) and correctly
  depth-track a tag nested inside another tag of the *same* name, even though no current
  fragment shape actually produces that nesting.
- **`decodePresetState` was fuzzed with script-shaped and emoji query values** (encoded
  `<script>` tags, unicode) and repeated keys — falls back to `DEFAULT_PRESET_STATE`
  per-field rather than partially trusting the input.

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

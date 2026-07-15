# Backlog

Epics are ordered so the wow moment ships first — everything after Epic 1 is coverage and
polish on top of a working demo, not a prerequisite to it.

## Epic 1 — Core swap visualization (the wow moment)

- [x] **1.1 — Swap-strategy toggle fires a synced request + DOM patch (WOW MOMENT)**
  The live demo element has an `hx-swap` toggle (innerHTML ⇄ outerHTML). Toggling it and
  clicking the trigger fires a real htmx request against the Go backend and visibly patches
  the DOM within the same second.
  - Toggling from innerHTML to outerHTML and firing the trigger shows a real HTTP request
    (visible in the network panel) with `hx-swap: outerHTML` reflected in the request.
  - The DOM patch panel highlights the swapped node(s), and the highlighted node set
    differs between innerHTML and outerHTML runs (outerHTML includes the element itself;
    innerHTML does not).
  - End-to-end latency from click to patch-highlight is under 1 second on localhost.

- [x] **1.2 — Network panel shows the real request and response**
  A panel renders the actual HTTP transaction htmx just performed, sourced from htmx
  lifecycle events, not a simulated readout.
  - Panel displays method, URL, request headers, response status, and response body for
    the most recent request.
  - Values match what the Go backend actually sent/received (verified by comparing panel
    output to a `curl` of the same endpoint).

- [x] **1.3 — DOM patch panel flash-highlights swapped nodes**
  The panel renders the live element's current markup and flashes exactly the node(s)
  htmx swapped on the most recent request.
  - Flash-highlight is scoped to the actual swapped node(s), not the whole panel.
  - `htmx:afterSwap` is the trigger for the highlight — verified by firing two different
    presets in a row and confirming the highlight target changes each time.

- [x] **1.4 — Design polish: blueprint layout for the core view**
  The Epic 1 view matches `docs/DESIGN.md`: blueprint tokens, graph-paper background
  treatment, and the animated dashed connector lines from demo element to both panels.
  - Colors, fonts, and spacing match the token table in `docs/DESIGN.md`.
  - Connector lines animate via `stroke-dashoffset` on fire and are skipped (instant
    reveal) when `prefers-reduced-motion` is set.

## Epic 2 — Full preset coverage

- [x] **2.1 — hx-trigger presets (click, revealed, delay)**
  Preset picker includes trigger variants beyond click.
  - Selecting "revealed" fires the request only when the demo element scrolls into view.
  - Selecting "delay:500ms" fires the request 500ms after the interaction, and the network
    panel timestamp reflects the delay.

- [x] **2.2 — hx-target presets (self vs. external target)**
  Preset picker includes a target selector distinguishing swapping the trigger element
  itself vs. an external target element.
  - With an external target selected, the DOM patch panel highlights the external
    element, not the trigger element.
  - Switching back to self-target correctly redirects the highlight to the trigger element
    on the next fire.

- [x] **2.3 — hx-select and hx-indicator presets**
  Preset picker includes `hx-select` (partial response extraction) and `hx-indicator`
  (loading state).
  - With `hx-select` active, the DOM patch panel shows only the selected fragment of the
    response body, not the full response.
  - With `hx-indicator` active, a loading state is visibly shown between request fire and
    response landing (verified against an artificially delayed demo endpoint).

- [x] **2.4 — Design polish: preset picker interaction states**
  Every preset control (chips/toggles/selects) has themed hover, focus-visible, active,
  and disabled states per `docs/DESIGN.md` — no naked native form controls.
  - Tabbing through the preset picker shows a visible focus ring on every control.
  - No unstyled native `<select>` or `<button>` remains in the preset picker.

## Epic 3 — Comparison mode and sharing

- [ ] **3.1 — Side-by-side swap-strategy comparison mode**
  A comparison mode fires the same trigger against two swap strategies at once, each with
  its own network + DOM patch panel pair.
  - Firing the shared trigger updates both panel pairs, and the two DOM patch highlights
    are visibly different when the strategies differ (e.g. innerHTML vs outerHTML).
  - Comparison mode is reachable from the main view via a single control, not a separate
    page reload.

- [x] **3.2 — Shareable preset links**
  The full preset state (swap/trigger/target/select/indicator, and comparison mode if
  active) is encoded in the URL.
  - Copying the current URL, opening it in a new tab, reproduces the identical preset
    selection without manual re-selection.
  - Invalid or malformed state in the URL falls back to the default preset instead of
    crashing the page.

- [ ] **3.3 — Design polish: comparison mode layout**
  Comparison mode matches `docs/DESIGN.md` at both panel-pair widths without becoming
  cramped.
  - At 1440px, both panel pairs are simultaneously legible without horizontal scroll.
  - At 390px, panel pairs stack vertically in fire-order with no overlap.

## Epic 4 — Deploy and accessibility

- [x] **4.1 — Responsive composition at phone, tablet, and desktop**
  The full app (preset picker, demo element, both panels) is usable and composed with no
  dead space at 390×844, 768×1024, and 1440×900.
  - No horizontal scroll and no element overlap at any of the three widths.
  - The demo element + panels occupy the majority of the viewport at all three widths
    (no small fixed-pixel box adrift in empty background).

- [x] **4.2 — Accessibility pass**
  Keyboard and screen-reader users can operate every preset and read panel updates.
  - Every preset control is reachable and operable via keyboard alone (Tab + Enter/Space).
  - Panel updates (network result, patch highlight) are announced via an `aria-live`
    region.

- [x] **4.3 — Static build for subpath deployment**
  The frontend builds into a single self-contained directory usable at
  `apps.charliekrug.com/attribute-lab` (a subpath, not the domain root).
  - All asset references (CSS, JS, fonts) are relative, not root-absolute — verified by
    serving the build output from a non-root path locally and confirming no 404s.
  - `site_build_dir` and `build_cmd` are documented and accurate in the project's STATUS
    reporting.

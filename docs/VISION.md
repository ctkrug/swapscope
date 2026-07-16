# Vision

## The problem

htmx's central idea — attributes drive behavior — is genuinely simple, but every existing
resource for learning it is static prose: a table with `hx-swap` in the left column and
"specifies how the response will be swapped in" in the right column. That tells you the
*name* of the concept, not the *shape* of it. New users copy an example, run it, and are
left reverse-engineering what actually happened in the browser. Experienced users evaluating
htmx for a project face the same gap when they need to explain a subtlety (e.g. "why does
`hx-swap-oob` need a matching id?") to a teammate — there's no page you can point at that
just *shows* it.

The htmx docs are a reference. `htmx.org/examples` is a sandbox you have to read code in.
Neither lets you click one preset and watch the request and the DOM patch happen, side by
side, in under a second.

## Who it's for

- Developers evaluating or learning htmx who want to understand swap/trigger/target
  semantics by watching them, not by inferring them from prose.
- Teams who use htmx already and want a fast way to explain a specific attribute's behavior
  to a new hire or a skeptical teammate ("here, watch what `outerHTML` actually does").
- Conference-talk / blog-post authors who want a link that demonstrates a concept live
  instead of a static GIF.

## The core idea

One live demo element. A preset picker sets the `hx-*` attributes on that element (swap
strategy, trigger, target, request method). Pressing the trigger fires the real htmx
request against a real Go backend — no mocking — and two panels update in sync:

1. **Network panel** — the actual request (method, URL, headers) and response (status,
   headers, body) htmx just sent and received.
2. **DOM patch panel** — the live element itself, with the exact nodes htmx swapped
   flash-highlighted the instant the swap lands.

Because both panels are driven by htmx's own lifecycle events (`htmx:beforeRequest` →
`htmx:afterRequest` → `htmx:beforeSwap` → `htmx:afterSwap`), what you see is never a
staged animation — it's instrumentation on the real thing.

## Key design decisions

- **Real requests, not mocked JSON.** The Go backend serves genuine htmx-fragment
  responses so the network panel shows headers and bodies htmx actually produced, not a
  simulated read-out. This is the credibility of the whole tool — a mocked panel would be
  just another diagram.
- **Instrumentation via htmx events, not a forked htmx.** Tapping `htmx:before*`/`after*`
  events keeps the demo on stock htmx, so what's shown is what any htmx app does, not a
  Attribute-Lab-specific behavior.
- **One demo element, many presets** — not one page per attribute. Switching presets on
  the same element is what makes the *comparison* (innerHTML vs outerHTML, click vs
  revealed) legible; separate pages would lose the side-by-side.
- **Static, self-contained deployment.** The Go server has no database and no external
  services — it's stdlib `net/http` serving embedded static assets plus a handful of
  fragment endpoints. This keeps it trivially deployable to `apps.charliekrug.com`.
- **No framework on the frontend.** Vanilla JS + htmx keeps the instrumentation layer
  legible as an example in itself — a visitor should be able to view-source the
  instrumentation and understand it in a few minutes.

## What "v1 done" looks like

- The full core `hx-*` surface is covered by presets: `hx-get`/`hx-post`, `hx-trigger`
  (click, revealed, delay), `hx-swap` (all swap strategies), `hx-target`, `hx-select`,
  `hx-indicator`.
- Selecting any preset and firing it shows the real request in the network panel and the
  flash-highlighted patch in the DOM panel within the same visible beat (sub-second,
  matching the wow moment).
- A side-by-side swap-strategy comparison mode exists so the innerHTML-vs-outerHTML
  distinction (the flagship demo) is directly comparable, not just sequential.
- The page is fully responsive (phone through desktop), passes the project's design
  standard (see `docs/DESIGN.md`), and is deployed at
  `apps.charliekrug.com/attribute-lab`.
- Preset state is shareable via URL, so a specific demo can be linked directly.

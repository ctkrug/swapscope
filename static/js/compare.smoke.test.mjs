// Smoke coverage for the comparison-mode DOM glue (app.js + compare.mjs),
// which the pure lab-core tests can't reach. jsdom stands in for the browser
// and a tiny htmx stub stands in for the real library — enough to assert the
// wiring: the mode toggle swaps rigs and disables the single-view presets, each
// lab's element carries the right hx-* attributes, and a per-lab htmx event
// lands in that lab's readout only (never the sibling lab or the single view).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { JSDOM } from "jsdom";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");
const css = readFileSync(join(here, "..", "css", "style.css"), "utf8");

// Boots the real app.js against a jsdom document with a stubbed htmx, seeded
// from `search` (e.g. "?compare=1"). Returns the window plus the recorded
// htmx.process() targets so tests can assert reprocessing happened.
async function boot(search = "") {
  const dom = new JSDOM(html, { url: `https://x/attribute-lab/${search}`, pretendToBeVisual: true });
  const processed = [];
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.htmx = { process: (el) => processed.push(el) };
  // A fresh module specifier per boot dodges the ESM import cache so each test
  // wires a clean document rather than re-running against a stale one.
  await import(`./app.js?boot=${search || "none"}-${processed.length}-${Math.random()}`);
  return { dom, window: dom.window, document: dom.window.document, processed };
}

function fireHtmxEvent(document, type, detail) {
  const evt = new document.defaultView.Event(type, { bubbles: false });
  evt.detail = detail;
  document.body.dispatchEvent(evt);
}

test("a hidden rig computes to display:none despite .rig's explicit display", () => {
  // Guards the author-vs-UA cascade fix: .rig sets display:grid, which would
  // otherwise beat the UA [hidden]{display:none} rule and leave a "hidden" rig
  // on screen. Asserts the real stylesheet, not just the .hidden property.
  const dom = new JSDOM(
    `<!doctype html><html><head><style>${css}</style></head><body>` +
      `<div class="rig" hidden></div><div class="rig"></div>` +
      `<div class="compare-rig" hidden></div></body></html>`
  );
  const { window } = dom;
  const rigs = window.document.querySelectorAll(".rig");
  assert.equal(window.getComputedStyle(rigs[0]).display, "none");
  assert.equal(window.getComputedStyle(rigs[1]).display, "grid");
  assert.equal(window.getComputedStyle(window.document.querySelector(".compare-rig")).display, "none");
});

test("comparison rig is hidden and the single rig shown by default", async () => {
  const { document } = await boot("");
  assert.equal(document.getElementById("compare-rig").hidden, true);
  assert.equal(document.querySelector(".rig").hidden, false);
});

test("toggling compare mode swaps the visible rig and disables single-view presets", async () => {
  const { document } = await boot("");
  document.querySelector("[data-compare-toggle]").click();

  assert.equal(document.getElementById("compare-rig").hidden, false);
  assert.equal(document.querySelector(".rig").hidden, true);
  assert.equal(document.querySelector("[data-compare-toggle]").getAttribute("aria-checked"), "true");

  for (const preset of ["swap", "trigger", "target"]) {
    const opts = document.querySelectorAll(`.preset-toggle[data-preset="${preset}"] .preset-toggle__option`);
    assert.ok(opts.length > 0);
    opts.forEach((btn) => assert.equal(btn.disabled, true));
  }
});

test("leaving comparison mode restores the single view and re-enables presets", async () => {
  const { document } = await boot("");
  const toggle = document.querySelector("[data-compare-toggle]");
  toggle.click(); // enter
  toggle.click(); // leave

  assert.equal(document.getElementById("compare-rig").hidden, true);
  assert.equal(document.querySelector(".rig").hidden, false);
  assert.equal(toggle.getAttribute("aria-checked"), "false");
  document
    .querySelectorAll('.preset-toggle[data-preset="swap"] .preset-toggle__option')
    .forEach((btn) => assert.equal(btn.disabled, false));
});

test("toggling hx-select while comparing re-syncs both labs' URLs", async () => {
  const { document } = await boot("?compare=1");
  document.querySelector('[data-preset-switch="select"]').click();

  for (const id of ["cmp-inner-el", "cmp-outer-el"]) {
    assert.match(document.getElementById(id).getAttribute("hx-get"), /select=1/);
    assert.equal(document.getElementById(id).getAttribute("hx-select"), "[data-fragment-content]");
  }
  // The shared URL reflects compare mode for a copyable link.
  assert.match(document.defaultView.location.search, /compare=1/);
});

test("each lab element carries its own swap strategy, target, and shared trigger", async () => {
  const { document } = await boot("?compare=1");

  const inner = document.getElementById("cmp-inner-el");
  const outer = document.getElementById("cmp-outer-el");

  assert.equal(inner.getAttribute("hx-swap"), "innerHTML");
  assert.equal(inner.getAttribute("hx-target"), "#cmp-inner-el");
  assert.equal(inner.getAttribute("hx-get"), "api/demo?swap=innerHTML&target=self");
  assert.equal(inner.getAttribute("hx-trigger"), "click from:#compare-fire");

  assert.equal(outer.getAttribute("hx-swap"), "outerHTML");
  assert.equal(outer.getAttribute("hx-target"), "#cmp-outer-el");
  assert.equal(outer.getAttribute("hx-get"), "api/demo?swap=outerHTML&target=self");
  assert.equal(outer.getAttribute("hx-trigger"), "click from:#compare-fire");
});

test("a per-lab afterRequest lands only in that lab's readout", async () => {
  const { document } = await boot("?compare=1");
  const inner = document.getElementById("cmp-inner-el");

  fireHtmxEvent(document, "htmx:afterRequest", {
    elt: inner,
    xhr: { status: 200, responseText: "<span data-gen=\"7\">ok</span>", getAllResponseHeaders: () => "" },
  });

  const innerLab = document.querySelector('.compare-lab[data-lab-swap="innerHTML"]');
  const outerLab = document.querySelector('.compare-lab[data-lab-swap="outerHTML"]');
  assert.equal(innerLab.querySelector('[data-field="status"]').textContent, "200");
  assert.equal(outerLab.querySelector('[data-field="status"]').textContent, "—");
  // The single-view network panel (first in document order) must be untouched.
  assert.equal(document.querySelector('.zone--network [data-field="status"]').textContent, "—");
});

test("hx-indicator applies to both labs and settling announces the outcome", async () => {
  const { document } = await boot("?compare=1&indicator=1");

  for (const id of ["cmp-inner-el", "cmp-outer-el"]) {
    assert.equal(document.getElementById(id).getAttribute("hx-indicator"), `#${id.replace("-el", "-indicator")}`);
  }

  const inner = document.getElementById("cmp-inner-el");
  fireHtmxEvent(document, "htmx:afterRequest", {
    elt: inner,
    xhr: { status: 200, responseText: "<span data-gen=\"4\">ok</span>", getAllResponseHeaders: () => "" },
  });
  fireHtmxEvent(document, "htmx:afterSettle", { elt: inner });

  const announced = document.querySelector('[data-field="status-announcer"]').textContent;
  assert.match(announced, /Response 200/);
  assert.match(announced, /innerHTML/);
});

test("outerHTML lab re-stamps its own id after a swap replaces the element", async () => {
  const { document, processed } = await boot("?compare=1");
  const outerLab = document.querySelector('.compare-lab[data-lab-swap="outerHTML"]');

  // Simulate htmx's outerHTML swap: the backend fragment restates id="demo-el"
  // (see fragments.go), so the lab's element is replaced by one carrying the
  // single-view id — exactly the collision syncLab must correct.
  const swapped = document.getElementById("cmp-outer-el");
  swapped.outerHTML =
    '<button id="demo-el" class="demo-el" data-gen="9" hx-get="api/demo?swap=outerHTML&amp;target=self" ' +
    'hx-target="#demo-el" hx-swap="outerHTML"><span class="demo-el__label" data-gen="9">Request #9</span></button>';

  fireHtmxEvent(document, "htmx:afterSettle", { elt: outerLab.querySelector(".demo-el") });

  const corrected = outerLab.querySelector(".demo-el");
  assert.equal(corrected.id, "cmp-outer-el");
  assert.equal(corrected.getAttribute("hx-trigger"), "click from:#compare-fire");
  assert.equal(document.getElementById("cmp-outer-el"), corrected);
  assert.ok(processed.includes(corrected), "the corrected element was reprocessed by htmx");
  // The DOM patch panel highlights the swapped node (its data-gen="9").
  assert.match(outerLab.querySelector('[data-field="patch-markup"]').innerHTML, /<mark/);
});

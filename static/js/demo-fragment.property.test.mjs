// Property-based invariants for the fragment renderer, generalized over
// arbitrary generation counters (the golden manifest only pins gens 1–8).
// These guard the JS port against the same fragment-shape gotchas the Go
// handler tests pin — most importantly that exactly one node ever carries the
// hx-select marker.
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { renderDemoFragment, wrapWithSelectNoise } from "./demo-fragment.mjs";

const SWAPS = ["innerHTML", "outerHTML"];
const TARGETS = ["self", "external"];
const gen = () => fc.integer({ min: 1, max: 4_000_000_000 });
const combo = () => fc.record({ swap: fc.constantFrom(...SWAPS), target: fc.constantFrom(...TARGETS) });

function render(swap, target, g, selectable) {
  const body = renderDemoFragment(swap, target, g, selectable);
  return selectable ? wrapWithSelectNoise(body) : body;
}

function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}

test("a selectable fragment marks exactly one swap root, whatever the shape", () => {
  fc.assert(
    fc.property(combo(), gen(), ({ swap, target }, g) => {
      const body = render(swap, target, g, true);
      // htmx moves every hx-select match with appendChild; a second nested
      // match would be hoisted out of its wrapper and duplicated.
      assert.equal(count(body, "data-fragment-content"), 1);
    })
  );
});

test("no marker appears unless select is requested", () => {
  fc.assert(
    fc.property(combo(), gen(), ({ swap, target }, g) => {
      assert.equal(count(render(swap, target, g, false), "data-fragment-content"), 0);
    })
  );
});

test("the body always stamps the exact generation it was given", () => {
  fc.assert(
    fc.property(combo(), gen(), fc.boolean(), ({ swap, target }, g, sel) => {
      const body = render(swap, target, g, sel);
      assert.ok(body.includes(`data-gen="${g}"`), "carries the gen marker");
      assert.ok(body.includes(`Request #${g} `), "labels the request with the gen");
    })
  );
});

test("innerHTML never wraps a replacement element; outerHTML/self restates its own hx-*", () => {
  fc.assert(
    fc.property(fc.constantFrom(...TARGETS), gen(), fc.boolean(), (target, g, sel) => {
      const inner = render("innerHTML", target, g, sel);
      assert.ok(!inner.includes("<button"), "innerHTML must not include a wrapping button");
      assert.ok(!inner.includes('id="demo-target-external"'), "innerHTML must not include the external wrapper");

      const outerSelf = render("outerHTML", "self", g, sel);
      assert.ok(outerSelf.includes('hx-swap="outerHTML"'), "outerHTML self restates hx-swap");
      assert.ok(outerSelf.includes('hx-target="#demo-el"'), "outerHTML self restates hx-target");
    })
  );
});

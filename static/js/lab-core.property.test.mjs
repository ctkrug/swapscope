// Property-based coverage for lab-core.mjs, complementing the example-based
// tests in lab-core.test.mjs. These generate hundreds of random inputs per
// run to find edge cases hand-written examples miss (see docs/ARCHITECTURE.md
// for which specific edge cases this already turned up).
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import {
  SWAP_STYLES,
  TARGET_PRESETS,
  TRIGGER_PRESETS,
  demoUrl,
  encodePresetState,
  decodePresetState,
  escapeHtml,
  splitHighlightSegments,
  nextRadioIndex,
} from "./lab-core.mjs";

const presetStateArb = fc.record({
  swap: fc.constantFrom(...SWAP_STYLES),
  trigger: fc.constantFrom(...TRIGGER_PRESETS),
  target: fc.constantFrom(...TARGET_PRESETS),
  select: fc.boolean(),
  indicator: fc.boolean(),
  compare: fc.boolean(),
});

test("property: encodePresetState/decodePresetState round-trip for any valid preset state", () => {
  fc.assert(
    fc.property(presetStateArb, (state) => {
      // Spread to a plain object first: fast-check's fc.record() values carry
      // a null prototype, which assert.deepEqual (strict) treats as
      // unequal to decodePresetState's plain-object-literal return even when
      // every field matches.
      assert.deepEqual(decodePresetState(encodePresetState(state)), { ...state });
    })
  );
});

test("property: demoUrl always starts with api/demo? and carries swap+target for any valid combination", () => {
  fc.assert(
    fc.property(
      fc.constantFrom(...SWAP_STYLES),
      fc.constantFrom(...TARGET_PRESETS),
      fc.boolean(),
      fc.boolean(),
      (swap, target, select, indicator) => {
        const url = demoUrl({ swap, target, select, indicator });
        assert.match(url, /^api\/demo\?/);
        assert.match(url, new RegExp(`swap=${swap}`));
        assert.match(url, new RegExp(`target=${target}`));
      }
    )
  );
});

test("property: escapeHtml output never contains a raw < or > for any input", () => {
  fc.assert(
    fc.property(fc.string(), (input) => {
      const escaped = escapeHtml(input);
      assert.equal(escaped.includes("<"), false);
      assert.equal(escaped.includes(">"), false);
    })
  );
});

// fc.string() alone is a near-vacuous generator here: a random string almost
// never contains a `data-gen="N"`-shaped substring, so it only ever exercises
// splitHighlightSegments' no-match fallback path. This builds small,
// realistic nested-tag fragments (with data-gen markers, including repeated
// tag names and repeated gen values) so the matching/depth-tracking logic in
// findGenRanges/findMatchingTagEnd is actually under test, not just skipped.
const TAGS = ["span", "div", "button"];
const GENS = [1, 2, 3];
const textArb = fc.string({ maxLength: 6 }).map((s) => s.replace(/[<>]/g, "_"));
const leafArb = textArb.map((text) => ({ kind: "text", text }));
const genArb = fc.option(fc.constantFrom(...GENS), { nil: undefined });

const innerTagArb = fc.record({
  kind: fc.constant("tag"),
  tag: fc.constantFrom(...TAGS),
  gen: genArb,
  children: fc.array(leafArb, { maxLength: 2 }),
});
const outerNodeArb = fc.oneof(
  leafArb,
  fc.record({
    kind: fc.constant("tag"),
    tag: fc.constantFrom(...TAGS),
    gen: genArb,
    children: fc.array(fc.oneof(leafArb, innerTagArb), { maxLength: 3 }),
  })
);

function renderNode(node) {
  if (node.kind === "text") return node.text;
  const attr = node.gen === undefined ? "" : ` data-gen="${node.gen}"`;
  return `<${node.tag}${attr}>${node.children.map(renderNode).join("")}</${node.tag}>`;
}

const markupArb = fc.array(outerNodeArb, { maxLength: 4 }).map((nodes) => nodes.map(renderNode).join(""));

test("property: splitHighlightSegments segments always reconstruct the original markup exactly", () => {
  fc.assert(
    fc.property(markupArb, fc.constantFrom(...GENS), (markup, gen) => {
      const segments = splitHighlightSegments(markup, gen);
      const rebuilt = segments.map((s) => s.text).join("");
      assert.equal(rebuilt, markup);
    })
  );
});

test("property: every highlighted segment contains the gen marker it was matched on", () => {
  // Reconstruction proves the segments *cover* the input; this proves they're
  // the *right* ones — a highlight can only cover an element whose opening tag
  // carries data-gen="<gen>", so that exact marker must fall inside every
  // highlighted slice. Catches a mis-scoped range that reconstructs fine but
  // highlights the wrong bytes.
  fc.assert(
    fc.property(markupArb, fc.constantFrom(...GENS), (markup, gen) => {
      for (const seg of splitHighlightSegments(markup, gen)) {
        if (seg.highlighted) {
          assert.ok(
            seg.text.includes(`data-gen="${gen}"`),
            `highlighted segment ${JSON.stringify(seg.text)} lacks data-gen="${gen}"`
          );
        }
      }
    })
  );
});

test("property: nextRadioIndex always returns an in-range index for a positive count", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 32 }),
      fc.integer({ min: 0, max: 31 }),
      fc.constantFrom("ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End", "Enter", "a"),
      (count, rawIndex, key) => {
        const currentIndex = rawIndex % count;
        const next = nextRadioIndex(currentIndex, key, count);
        assert.ok(next >= 0 && next < count, `next=${next} out of range for count=${count}`);
      }
    )
  );
});

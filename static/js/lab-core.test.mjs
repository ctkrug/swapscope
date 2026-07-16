import { test } from "node:test";
import assert from "node:assert/strict";
import {
  demoUrl,
  triggerAttrForPreset,
  statusClass,
  parseResponseHeaders,
  escapeHtml,
  splitHighlightSegments,
  encodePresetState,
  decodePresetState,
  DEFAULT_PRESET_STATE,
  nextRadioIndex,
  describeRequestOutcome,
} from "./lab-core.mjs";

test("demoUrl builds a relative, subpath-safe URL defaulting target to self", () => {
  assert.equal(demoUrl({ swap: "innerHTML" }), "api/demo?swap=innerHTML&target=self");
  assert.equal(demoUrl({ swap: "outerHTML" }), "api/demo?swap=outerHTML&target=self");
});

test("demoUrl includes an explicit external target", () => {
  assert.equal(
    demoUrl({ swap: "innerHTML", target: "external" }),
    "api/demo?swap=innerHTML&target=external"
  );
});

test("demoUrl appends select and indicator only when truthy", () => {
  assert.equal(
    demoUrl({ swap: "innerHTML", select: true }),
    "api/demo?swap=innerHTML&target=self&select=1"
  );
  assert.equal(
    demoUrl({ swap: "innerHTML", indicator: true }),
    "api/demo?swap=innerHTML&target=self&indicator=1"
  );
  assert.equal(
    demoUrl({ swap: "innerHTML", select: true, indicator: true }),
    "api/demo?swap=innerHTML&target=self&select=1&indicator=1"
  );
});

test("demoUrl omits select/indicator identically whether false or absent", () => {
  assert.equal(
    demoUrl({ swap: "innerHTML", select: false, indicator: false }),
    demoUrl({ swap: "innerHTML" })
  );
});

test("demoUrl rejects unknown swap styles and target presets", () => {
  assert.throws(() => demoUrl({ swap: "bogus" }), RangeError);
  assert.throws(() => demoUrl({ swap: "" }), RangeError);
  assert.throws(() => demoUrl({ swap: "innerHTML", target: "bogus" }), RangeError);
});

test("triggerAttrForPreset maps click, revealed, and delay presets", () => {
  assert.equal(triggerAttrForPreset("click"), "click");
  assert.equal(triggerAttrForPreset("revealed"), "revealed");
  assert.equal(triggerAttrForPreset("delay"), "click delay:500ms");
});

test("triggerAttrForPreset rejects unknown presets", () => {
  assert.throws(() => triggerAttrForPreset("bogus"), RangeError);
  assert.throws(() => triggerAttrForPreset(""), RangeError);
});

test("statusClass buckets 2xx as success and 4xx/5xx as error", () => {
  assert.equal(statusClass(200), "is-success");
  assert.equal(statusClass(299), "is-success");
  assert.equal(statusClass(404), "is-error");
  assert.equal(statusClass(500), "is-error");
  assert.equal(statusClass(599), "is-error");
});

test("statusClass returns empty string for anything else", () => {
  assert.equal(statusClass(0), "");
  assert.equal(statusClass(101), "");
  assert.equal(statusClass(302), "");
});

test("statusClass returns empty string for negative numbers and NaN without throwing", () => {
  assert.equal(statusClass(-1), "");
  assert.equal(statusClass(NaN), "");
});

test("parseResponseHeaders parses the raw XHR header block", () => {
  const raw = "Content-Type: text/html; charset=utf-8\r\nX-Gen: 3\r\n";
  assert.deepEqual(parseResponseHeaders(raw), [
    ["Content-Type", "text/html; charset=utf-8"],
    ["X-Gen", "3"],
  ]);
});

test("parseResponseHeaders handles empty input", () => {
  assert.deepEqual(parseResponseHeaders(""), []);
  assert.deepEqual(parseResponseHeaders(null), []);
});

test("parseResponseHeaders tolerates a header with no colon", () => {
  assert.deepEqual(parseResponseHeaders("malformed-line\r\n"), [["malformed-line", ""]]);
});

test("parseResponseHeaders splits only on the first colon, keeping colons in the value", () => {
  const raw = "Date: Thu, 16 Jul 2026 04:54:07 GMT\r\n";
  assert.deepEqual(parseResponseHeaders(raw), [["Date", "Thu, 16 Jul 2026 04:54:07 GMT"]]);
});

test("parseResponseHeaders drops blank lines and trims trailing whitespace", () => {
  const raw = "Content-Length: 267\r\n\r\nContent-Type: text/html \r\n";
  assert.deepEqual(parseResponseHeaders(raw), [
    ["Content-Length", "267"],
    ["Content-Type", "text/html"],
  ]);
});

test("escapeHtml escapes all five reserved characters", () => {
  assert.equal(escapeHtml(`<a href="x" b='y'>&</a>`), "&lt;a href=&quot;x&quot; b=&#39;y&#39;&gt;&amp;&lt;/a&gt;");
});

test("escapeHtml leaves plain text untouched", () => {
  assert.equal(escapeHtml("Request #3 handled by outerHTML"), "Request #3 handled by outerHTML");
});

test("escapeHtml passes unicode and emoji through unmodified", () => {
  const text = "Requête n°3 réussie 🎉 — 素晴らしい";
  assert.equal(escapeHtml(text), text);
});

test("escapeHtml handles an empty string", () => {
  assert.equal(escapeHtml(""), "");
});

test("splitHighlightSegments highlights the whole outer element when outer and inner share a gen", () => {
  const markup = '<button id="demo-el" data-gen="5"><span data-gen="5">hi</span></button>';
  const segments = splitHighlightSegments(markup, 5);
  assert.deepEqual(segments, [{ text: markup, highlighted: true }]);
});

test("splitHighlightSegments highlights only the inner span for an innerHTML fragment", () => {
  const markup = '<button id="demo-el"><span data-gen="7">hi</span></button>';
  const segments = splitHighlightSegments(markup, 7);
  assert.deepEqual(segments, [
    { text: '<button id="demo-el">', highlighted: false },
    { text: '<span data-gen="7">hi</span>', highlighted: true },
    { text: "</button>", highlighted: false },
  ]);
});

test("splitHighlightSegments returns the whole string unhighlighted when gen is absent", () => {
  const markup = '<span data-gen="1">hi</span>';
  assert.deepEqual(splitHighlightSegments(markup, 2), [{ text: markup, highlighted: false }]);
});

test("splitHighlightSegments handles an empty markup string", () => {
  assert.deepEqual(splitHighlightSegments("", 1), [{ text: "", highlighted: false }]);
});

test("splitHighlightSegments degrades to unhighlighted when the matching tag is never closed", () => {
  const markup = '<span data-gen="3">unclosed and truncated mid-response';
  assert.deepEqual(splitHighlightSegments(markup, 3), [{ text: markup, highlighted: false }]);
});

test("splitHighlightSegments ignores a data-gen marker with no opening angle bracket before it", () => {
  const markup = 'data-gen="4">stray marker with no tag';
  assert.deepEqual(splitHighlightSegments(markup, 4), [{ text: markup, highlighted: false }]);
});

test("splitHighlightSegments matches the outer boundary across same-tag-name nesting", () => {
  const markup = '<span data-gen="9">before<span>inner</span>after</span>';
  assert.deepEqual(splitHighlightSegments(markup, 9), [{ text: markup, highlighted: true }]);
});

test("splitHighlightSegments highlights multiple separate matches", () => {
  const markup = '<span data-gen="2">a</span><i>gap</i><span data-gen="2">b</span>';
  const segments = splitHighlightSegments(markup, 2);
  assert.deepEqual(segments, [
    { text: '<span data-gen="2">a</span>', highlighted: true },
    { text: "<i>gap</i>", highlighted: false },
    { text: '<span data-gen="2">b</span>', highlighted: true },
  ]);
});

test("encodePresetState produces a stable, fully-specified query string", () => {
  assert.equal(
    encodePresetState({ swap: "outerHTML", trigger: "delay", target: "external", select: true, indicator: false }),
    "swap=outerHTML&trigger=delay&target=external&select=1&indicator=0"
  );
});

test("encodePresetState round-trips through decodePresetState", () => {
  const state = { swap: "outerHTML", trigger: "revealed", target: "external", select: true, indicator: true };
  assert.deepEqual(decodePresetState(encodePresetState(state)), state);
});

test("decodePresetState falls back to defaults for a missing query string", () => {
  assert.deepEqual(decodePresetState(""), DEFAULT_PRESET_STATE);
  assert.deepEqual(decodePresetState("?"), DEFAULT_PRESET_STATE);
});

test("decodePresetState falls back per-field for unknown or malformed values", () => {
  assert.deepEqual(decodePresetState("swap=bogus&trigger=click&target=external"), {
    ...DEFAULT_PRESET_STATE,
    trigger: "click",
    target: "external",
  });
  assert.deepEqual(decodePresetState("swap=;&garbage=1"), DEFAULT_PRESET_STATE);
});

test("decodePresetState treats select/indicator as boolean flags, not just any truthy value", () => {
  assert.equal(decodePresetState("select=true").select, false);
  assert.equal(decodePresetState("select=1").select, true);
  assert.equal(decodePresetState("indicator=0").indicator, false);
});

test("decodePresetState uses the first value when a key repeats", () => {
  assert.deepEqual(decodePresetState("swap=outerHTML&swap=innerHTML"), {
    ...DEFAULT_PRESET_STATE,
    swap: "outerHTML",
  });
});

test("decodePresetState tolerates unicode and script-shaped values by falling back to defaults", () => {
  const search = "swap=" + encodeURIComponent("<script>alert(1)</script>") + "&target=" + encodeURIComponent("💥");
  assert.deepEqual(decodePresetState(search), DEFAULT_PRESET_STATE);
});

test("nextRadioIndex moves forward on ArrowRight/ArrowDown and wraps at the end", () => {
  assert.equal(nextRadioIndex(0, "ArrowRight", 3), 1);
  assert.equal(nextRadioIndex(2, "ArrowRight", 3), 0);
  assert.equal(nextRadioIndex(0, "ArrowDown", 3), 1);
});

test("nextRadioIndex moves backward on ArrowLeft/ArrowUp and wraps at the start", () => {
  assert.equal(nextRadioIndex(1, "ArrowLeft", 3), 0);
  assert.equal(nextRadioIndex(0, "ArrowLeft", 3), 2);
  assert.equal(nextRadioIndex(0, "ArrowUp", 3), 2);
});

test("nextRadioIndex jumps to the ends on Home/End", () => {
  assert.equal(nextRadioIndex(1, "Home", 3), 0);
  assert.equal(nextRadioIndex(1, "End", 3), 2);
});

test("nextRadioIndex leaves the index unchanged for keys it doesn't handle", () => {
  assert.equal(nextRadioIndex(1, "Enter", 3), 1);
  assert.equal(nextRadioIndex(1, "a", 3), 1);
});

test("nextRadioIndex is a no-op for a single-option group and for an empty group", () => {
  assert.equal(nextRadioIndex(0, "ArrowRight", 1), 0);
  assert.equal(nextRadioIndex(0, "ArrowLeft", 1), 0);
  assert.equal(nextRadioIndex(0, "ArrowRight", 0), 0);
});

test("describeRequestOutcome describes a successful self-target patch", () => {
  assert.equal(
    describeRequestOutcome({ status: 200, swap: "innerHTML", target: "self" }),
    "Response 200 — patched the live element via innerHTML."
  );
});

test("describeRequestOutcome describes an external-target patch", () => {
  assert.equal(
    describeRequestOutcome({ status: 200, swap: "outerHTML", target: "external" }),
    "Response 200 — patched the external target via outerHTML."
  );
});

test("describeRequestOutcome reports an error status without special-casing it", () => {
  assert.equal(
    describeRequestOutcome({ status: 500, swap: "innerHTML", target: "self" }),
    "Response 500 — patched the live element via innerHTML."
  );
});

test("describeRequestOutcome reports a failed request when status is falsy", () => {
  assert.equal(
    describeRequestOutcome({ status: 0, swap: "innerHTML", target: "self" }),
    "Request failed — no response received."
  );
});

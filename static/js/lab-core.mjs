// Pure logic for Attribute Lab's instrumentation panels. No DOM access here
// on purpose — it's what makes this module runnable directly under
// `node --test`, independent of a browser.

export const SWAP_STYLES = ["innerHTML", "outerHTML"];
export const TARGET_PRESETS = ["self", "external"];
export const TRIGGER_PRESETS = ["click", "revealed", "delay"];

export const DEFAULT_PRESET_STATE = {
  swap: "innerHTML",
  trigger: "click",
  target: "self",
  select: false,
  indicator: false,
  compare: false,
};

/**
 * Builds the demo endpoint URL for a given preset combination. Relative (no
 * leading slash) so it resolves correctly under a subpath deployment.
 */
export function demoUrl({ swap, target = "self", select = false, indicator = false }) {
  if (!SWAP_STYLES.includes(swap)) {
    throw new RangeError(`unsupported swap style: ${swap}`);
  }
  if (!TARGET_PRESETS.includes(target)) {
    throw new RangeError(`unsupported target preset: ${target}`);
  }
  const params = new URLSearchParams({ swap, target });
  if (select) params.set("select", "1");
  if (indicator) params.set("indicator", "1");
  return `api/demo?${params.toString()}`;
}

/**
 * Encodes a full preset state into a URL query string (no leading "?") so
 * the current demo configuration is shareable as a link. Field order is
 * fixed for stable, diffable URLs across saves.
 */
export function encodePresetState(state) {
  const params = new URLSearchParams();
  params.set("swap", state.swap);
  params.set("trigger", state.trigger);
  params.set("target", state.target);
  params.set("select", state.select ? "1" : "0");
  params.set("indicator", state.indicator ? "1" : "0");
  params.set("compare", state.compare ? "1" : "0");
  return params.toString();
}

/**
 * Decodes a URL query string back into a preset state, falling back to
 * `DEFAULT_PRESET_STATE` field-by-field for any value that's missing or not
 * one of the known presets — a malformed or hand-edited URL degrades to the
 * default demo instead of producing a broken or crashing page.
 */
export function decodePresetState(search) {
  const params = new URLSearchParams(search);
  const swap = params.get("swap");
  const trigger = params.get("trigger");
  const target = params.get("target");
  return {
    swap: SWAP_STYLES.includes(swap) ? swap : DEFAULT_PRESET_STATE.swap,
    trigger: TRIGGER_PRESETS.includes(trigger) ? trigger : DEFAULT_PRESET_STATE.trigger,
    target: TARGET_PRESETS.includes(target) ? target : DEFAULT_PRESET_STATE.target,
    select: params.get("select") === "1",
    indicator: params.get("indicator") === "1",
    compare: params.get("compare") === "1",
  };
}

/**
 * Derives the two per-lab preset configs for comparison mode from a base
 * preset state. Comparison mode holds every axis fixed except hx-swap and
 * fires both strategies at once, so the two configs differ only in `swap`
 * (one per entry of SWAP_STYLES, in order) and share the base's select /
 * indicator flags. Target is pinned to "self": the comparison the vision
 * centers on is innerHTML vs. outerHTML against the element itself, and an
 * external target would need its own destination node per lab. Pure so the
 * frontend's per-lab wiring has a single, testable source of truth for what
 * each side's URL and swap attribute should be.
 */
export function comparisonLabConfigs({ select = false, indicator = false } = {}) {
  return SWAP_STYLES.map((swap) => ({
    swap,
    target: "self",
    select,
    indicator,
  }));
}

/**
 * Builds the concise, screen-reader-friendly sentence announced by the
 * status-announcer live region after each request/patch cycle. The network
 * and DOM patch panels are visually rich but too verbose to dump into an
 * aria-live region wholesale (a live region re-reads its entire content on
 * every change) — this is the summary a sighted user gets for free just by
 * glancing at both panels at once.
 */
export function describeRequestOutcome({ status, swap, target }) {
  const targetLabel = target === "external" ? "the external target" : "the live element";
  if (!status) {
    return "Request failed — no response received.";
  }
  return `Response ${status} — patched ${targetLabel} via ${swap}.`;
}

/**
 * Computes the next focused index for an ARIA `radiogroup` of `count`
 * options given the currently-focused index and a keydown key name, per the
 * WAI-ARIA roving-tabindex pattern (Right/Down moves forward, Left/Up moves
 * backward, both wrapping; Home/End jump to the ends). Any other key leaves
 * the index unchanged so callers can pass every keydown through without
 * pre-filtering. Pure and DOM-free so the wrap-around/no-op edges are
 * testable without a browser.
 */
export function nextRadioIndex(currentIndex, key, count) {
  if (count <= 0) return currentIndex;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (currentIndex + 1) % count;
    case "ArrowLeft":
    case "ArrowUp":
      return (currentIndex - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return currentIndex;
  }
}

/**
 * Builds the hx-trigger attribute value for a given trigger preset. "delay"
 * still fires on click, just 500ms after it — hx-trigger's modifier syntax
 * is a single space-separated string, so this is the whole reason the
 * preset needs its own builder rather than a 1:1 attribute value.
 */
export function triggerAttrForPreset(preset) {
  switch (preset) {
    case "click":
      return "click";
    case "revealed":
      return "revealed";
    case "delay":
      return "click delay:500ms";
    default:
      throw new RangeError(`unsupported trigger preset: ${preset}`);
  }
}

/**
 * Classifies an HTTP status code for the network panel's status chip.
 */
export function statusClass(status) {
  if (status >= 200 && status < 300) return "is-success";
  if (status >= 400 && status < 600) return "is-error";
  return "";
}

/**
 * Parses the raw string XHR.getAllResponseHeaders() returns into an
 * ordered list of [name, value] pairs (headers are case-insensitive and can
 * repeat, so a plain object would be lossy).
 */
export function parseResponseHeaders(raw) {
  if (!raw) return [];
  return raw
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const idx = line.indexOf(":");
      if (idx === -1) return [line.trim(), ""];
      return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()];
    });
}

/**
 * Escapes text for safe insertion into HTML via innerHTML.
 */
export function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Splits `markup` into segments, marking as highlighted the element(s)
 * whose opening tag carries `data-gen="<gen>"`. Matches nested inside an
 * already-highlighted range are absorbed rather than double-wrapped, so an
 * outerHTML swap (where the outer element and its inner content share the
 * same generation stamp) highlights just the outer boundary.
 *
 * Returns an array of { text, highlighted } segments covering the whole
 * input string in order — callers escape each segment themselves before
 * rendering, keeping this function free of any HTML-generation concerns.
 */
export function splitHighlightSegments(markup, gen) {
  const ranges = findGenRanges(markup, gen);
  if (ranges.length === 0) {
    return [{ text: markup, highlighted: false }];
  }

  const segments = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start > cursor) {
      segments.push({ text: markup.slice(cursor, start), highlighted: false });
    }
    segments.push({ text: markup.slice(start, end), highlighted: true });
    cursor = end;
  }
  if (cursor < markup.length) {
    segments.push({ text: markup.slice(cursor), highlighted: false });
  }
  return segments;
}

function findGenRanges(markup, gen) {
  const marker = `data-gen="${gen}"`;
  const matches = [];
  let searchFrom = 0;

  while (true) {
    const idx = markup.indexOf(marker, searchFrom);
    if (idx === -1) break;
    searchFrom = idx + marker.length;

    const tagStart = markup.lastIndexOf("<", idx);
    if (tagStart === -1) continue;

    const tagNameMatch = /^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(markup.slice(tagStart));
    if (!tagNameMatch) continue;

    const tagEnd = findMatchingTagEnd(markup, tagStart, tagNameMatch[1]);
    if (tagEnd !== -1) {
      matches.push([tagStart, tagEnd]);
    }
  }

  matches.sort((a, b) => a[0] - b[0]);

  const kept = [];
  for (const range of matches) {
    const prev = kept[kept.length - 1];
    if (prev && range[0] < prev[1]) continue; // nested inside a kept range
    kept.push(range);
  }
  return kept;
}

/**
 * Finds the end index (exclusive) of the closing tag matching the opening
 * tag at `tagStart`, accounting for same-name nesting.
 */
function findMatchingTagEnd(markup, tagStart, tagName) {
  const openTagClose = markup.indexOf(">", tagStart);
  if (openTagClose === -1) return -1;

  const openToken = `<${tagName}`;
  const closeToken = `</${tagName}>`;

  let depth = 1;
  let pos = openTagClose + 1;

  while (depth > 0) {
    const nextOpen = markup.indexOf(openToken, pos);
    const nextClose = markup.indexOf(closeToken, pos);
    if (nextClose === -1) return -1;

    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      pos = markup.indexOf(">", nextOpen) + 1;
    } else {
      depth--;
      pos = nextClose + closeToken.length;
    }
  }

  return pos;
}

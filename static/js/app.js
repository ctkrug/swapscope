// Instrumentation layer: taps htmx's own lifecycle events to drive the
// network panel and the DOM patch panel. Nothing here simulates a request —
// every value shown comes from the real XHR htmx just made.
import {
  demoUrl,
  triggerAttrForPreset,
  statusClass,
  parseResponseHeaders,
  escapeHtml,
  splitHighlightSegments,
  encodePresetState,
  decodePresetState,
  nextRadioIndex,
  describeRequestOutcome,
} from "./lab-core.mjs";

const fields = {
  method: document.querySelector('[data-field="method"]'),
  url: document.querySelector('[data-field="url"]'),
  status: document.querySelector('[data-field="status"]'),
  requestHeaders: document.querySelector('[data-field="request-headers"]'),
  responseBody: document.querySelector('[data-field="response-body"]'),
  patchMarkup: document.querySelector('[data-field="patch-markup"]'),
  statusAnnouncer: document.querySelector('[data-field="status-announcer"]'),
};
const connectorNetwork = document.querySelector(".connector--network");
const connectorPatch = document.querySelector(".connector--patch");
const rigPulse = document.querySelector(".rig-pulse");

// The full preset picker's state. Each field is driven by one preset group
// in the toolbar and, together, they determine every hx-* attribute on the
// demo element — see syncDemoElAttributes(). Seeded from the URL so a shared
// link reproduces the exact demo it was copied from; decodePresetState
// falls back to DEFAULT_PRESET_STATE field-by-field for anything missing or
// malformed, so a bad URL never crashes the page.
const presetState = { ...decodePresetState(window.location.search) };

// Captured at request time (rather than read fresh at afterSwap) so a
// preset change mid-flight can't misattribute which target/swap the
// in-flight response actually belongs to.
let lastRequestState = { swap: presetState.swap, target: presetState.target };
let lastResponseStatus = null;

document.querySelectorAll(".preset-toggle").forEach((group) => {
  const presetKey = group.dataset.preset;
  group.addEventListener("click", (evt) => {
    const btn = evt.target.closest(".preset-toggle__option");
    if (!btn || btn.disabled) return;
    presetState[presetKey] = btn.dataset.value;
    setActiveToggleOption(group, btn.dataset.value);
    applyPreset();
  });
  group.addEventListener("keydown", (evt) => handleRadiogroupKeydown(evt, group, presetKey));
});

document.querySelectorAll(".preset-switch").forEach((btn) => {
  const presetKey = btn.dataset.presetSwitch;
  btn.addEventListener("click", () => {
    presetState[presetKey] = !presetState[presetKey];
    setSwitchState(btn, presetState[presetKey]);
    applyPreset();
  });
});

function setActiveToggleOption(group, value) {
  group.querySelectorAll(".preset-toggle__option").forEach((btn) => {
    const isActive = btn.dataset.value === value;
    btn.classList.toggle("is-active", isActive);
    btn.setAttribute("aria-checked", String(isActive));
    // Roving tabindex: only the checked radio is a Tab stop, matching the
    // WAI-ARIA radiogroup pattern — Tab enters/exits the group in one stop,
    // arrow keys (handleRadiogroupKeydown) move the checked option within it.
    btn.tabIndex = isActive ? 0 : -1;
  });
}

// WAI-ARIA radiogroup keyboard pattern: arrow keys move and select the next
// option (no separate "focus vs. select" step, matching native <input
// type=radio> groups); Enter/Space aren't handled here because the buttons'
// own click behavior already covers them.
function handleRadiogroupKeydown(evt, group, presetKey) {
  const options = Array.from(group.querySelectorAll(".preset-toggle__option")).filter(
    (btn) => !btn.disabled
  );
  const currentIndex = options.findIndex((btn) => btn.dataset.value === presetState[presetKey]);
  const nextIndex = nextRadioIndex(currentIndex, evt.key, options.length);
  if (nextIndex === currentIndex) return;

  evt.preventDefault();
  const nextBtn = options[nextIndex];
  presetState[presetKey] = nextBtn.dataset.value;
  setActiveToggleOption(group, nextBtn.dataset.value);
  nextBtn.focus();
  applyPreset();
}

function setSwitchState(btn, isOn) {
  btn.classList.toggle("is-on", isOn);
  btn.setAttribute("aria-checked", String(isOn));
  btn.querySelector(".preset-switch__state").textContent = isOn ? "on" : "off";
}

// Reconciles the preset bar's visible controls with presetState as seeded
// from the URL — without this, a shared link would drive the demo element
// correctly (applyPreset runs regardless) but the toggle/switch chips would
// still show the hardcoded HTML defaults instead of the state actually in
// effect.
function hydrateControlsFromState() {
  document.querySelectorAll(".preset-toggle").forEach((group) => {
    setActiveToggleOption(group, presetState[group.dataset.preset]);
  });
  document.querySelectorAll(".preset-switch").forEach((btn) => {
    setSwitchState(btn, presetState[btn.dataset.presetSwitch]);
  });
}

// Applies the current presetState to the live demo element and its
// surrounding chrome. Called both when a preset control is clicked and
// after every swap, because an outerHTML self-swap replaces #demo-el with
// whatever the backend echoed back — and the backend only restates
// hx-get/hx-target/hx-swap (see fragments.go), not hx-trigger/hx-select/
// hx-indicator. Re-asserting the full state here is what keeps a trigger
// (e.g. "revealed") or a switch (e.g. hx-select) from silently reverting to
// its default after the very first outerHTML fire.
function applyPreset() {
  syncDemoElAttributes();
  updateExternalTargetEmphasis();
  syncUrlToPresetState();
}

// Keeps the address bar's query string equal to encodePresetState(presetState)
// at all times, via replaceState (not pushState) so clicking through presets
// doesn't spam browser history — the URL only needs to be *current* for
// copying, not itself a navigable trail.
function syncUrlToPresetState() {
  const url = new URL(window.location.href);
  url.search = encodePresetState(presetState);
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
}

// Toggled on the stable .external-target-wrap, not #demo-target-external
// itself: an outerHTML swap replaces that inner node wholesale (see
// fragments.go), so a class placed on it would vanish along with it.
function updateExternalTargetEmphasis() {
  const wrap = document.querySelector(".external-target-wrap");
  if (wrap) {
    wrap.classList.toggle("is-active-target", presetState.target === "external");
  }
}

function syncDemoElAttributes() {
  const target = document.getElementById("demo-el");
  if (!target) return;

  target.setAttribute("hx-get", demoUrl(presetState));
  target.setAttribute("hx-swap", presetState.swap);
  target.setAttribute("hx-target", presetState.target === "external" ? "#demo-target-external" : "#demo-el");
  target.setAttribute("hx-trigger", triggerAttrForPreset(presetState.trigger));

  if (presetState.select) {
    target.setAttribute("hx-select", "[data-fragment-content]");
  } else {
    target.removeAttribute("hx-select");
  }

  if (presetState.indicator) {
    target.setAttribute("hx-indicator", "#demo-indicator");
  } else {
    target.removeAttribute("hx-indicator");
  }

  // htmx resolves and caches an element's verb/path/trigger the first time
  // it processes it; changing these attributes afterward is invisible until
  // the element is reprocessed.
  htmx.process(target);
}

document.body.addEventListener("htmx:configRequest", (evt) => {
  lastRequestState = { swap: presetState.swap, target: presetState.target };
  fields.method.textContent = evt.detail.verb.toUpperCase();
  fields.url.textContent = evt.detail.path;
  fields.requestHeaders.textContent = Object.entries(evt.detail.headers)
    .map(([name, value]) => `${name}: ${value}`)
    .join("\n");
});

document.body.addEventListener("htmx:afterRequest", (evt) => {
  const xhr = evt.detail.xhr;
  const status = xhr.status;
  lastResponseStatus = status;

  fields.status.textContent = String(status);
  fields.status.className = `status-chip ${statusClass(status)}`.trim();
  fields.responseBody.textContent = xhr.responseText;

  void parseResponseHeaders(xhr.getAllResponseHeaders());
  fireConnectors();
});

document.body.addEventListener("htmx:afterSwap", () => {
  syncDemoElAttributes();
});

// htmx:afterSettle (not afterSwap) is where class-list changes on the
// swapped element belong: for an outerHTML swap, htmx captures the newly
// inserted element's class list right after insertion and re-applies that
// captured string once settling finishes, to strip its own transitional
// htmx-swapping/htmx-added/htmx-settling classes. A class change made
// during afterSwap races that capture and gets silently discarded; waiting
// for afterSettle guarantees htmx's own cleanup has already happened.
// (updateExternalTargetEmphasis doesn't need this treatment since it now
// targets the stable .external-target-wrap, never the swapped node.)
document.body.addEventListener("htmx:afterSettle", () => {
  renderPatchPanel();
  announceRequestOutcome();
});

// A concise sentence for screen-reader users, in place of dumping the raw
// (and often long) response body or patch markup into a live region —
// see lab-core.mjs: describeRequestOutcome.
function announceRequestOutcome() {
  if (!fields.statusAnnouncer) return;
  fields.statusAnnouncer.textContent = describeRequestOutcome({
    status: lastResponseStatus,
    swap: lastRequestState.swap,
    target: lastRequestState.target,
  });
}

function renderPatchPanel() {
  const carrierRoot =
    lastRequestState.target === "external"
      ? document.getElementById("demo-target-external")
      : document.getElementById("demo-el");
  if (!carrierRoot) return;

  const markup = carrierRoot.outerHTML;
  const gen = currentGen(carrierRoot, lastRequestState.swap);

  const html = splitHighlightSegments(markup, gen)
    .map((seg) =>
      seg.highlighted
        ? `<mark class="is-flashing">${escapeHtml(seg.text)}</mark>`
        : escapeHtml(seg.text)
    )
    .join("");

  fields.patchMarkup.innerHTML = html;
  flashLiveElement(carrierRoot);
}

function currentGen(carrierRoot, swap) {
  const carrier = swap === "outerHTML" ? carrierRoot : carrierRoot.querySelector("[data-gen]");
  return carrier ? carrier.getAttribute("data-gen") : null;
}

function flashLiveElement(carrierRoot) {
  carrierRoot.classList.remove("is-flashing");
  // Force reflow so re-adding the class restarts the CSS animation even if
  // the previous flash hasn't finished (rapid repeated clicks).
  void carrierRoot.offsetWidth;
  carrierRoot.classList.add("is-flashing");
}

function fireConnectors() {
  positionConnectors();
  [connectorNetwork, connectorPatch, rigPulse].forEach((el) => {
    if (!el) return;
    el.classList.remove("is-firing");
    void el.offsetWidth;
    el.classList.add("is-firing");
  });
}

// Draws each connector as a line from the live element's edge to its panel,
// sized so a single dash spans the whole path — see the CSS comment on
// .connector for why that's what makes the dashoffset animation read as a
// self-drawing line rather than marching dashes.
function positionConnectors() {
  const svg = document.querySelector(".connectors");
  const stage = document.querySelector(".zone--stage");
  const networkZone = document.querySelector(".zone--network");
  const patchZone = document.querySelector(".zone--patch");
  if (!svg || !stage || !networkZone || !patchZone) return;

  const rigRect = svg.getBoundingClientRect();
  setLine(connectorNetwork, stage.getBoundingClientRect(), networkZone.getBoundingClientRect(), rigRect);
  setLine(connectorPatch, stage.getBoundingClientRect(), patchZone.getBoundingClientRect(), rigRect);
}

function setLine(line, fromRect, toRect, rigRect) {
  if (!line) return;

  const x1 = fromRect.right - rigRect.left;
  const y1 = fromRect.top + fromRect.height / 2 - rigRect.top;
  const x2 = toRect.left - rigRect.left;
  const y2 = toRect.top + toRect.height / 2 - rigRect.top;

  line.setAttribute("x1", x1);
  line.setAttribute("y1", y1);
  line.setAttribute("x2", x2);
  line.setAttribute("y2", y2);

  const length = Math.hypot(x2 - x1, y2 - y1) || 1;
  line.style.setProperty("--connector-length", length);
  line.setAttribute("stroke-dasharray", `${length} ${length}`);
}

const copyLinkBtn = document.querySelector("[data-copy-link]");
const copyLinkLabel = document.querySelector('[data-field="copy-link-label"]');
let copyLinkResetTimer = null;

// The URL is already kept current by syncUrlToPresetState on every preset
// change; this button just makes that fact discoverable instead of relying
// on visitors to notice the address bar updating on its own. Falls back to
// selecting the button's accessible text when the Clipboard API is
// unavailable (older browsers, non-HTTPS contexts) rather than failing
// silently.
if (copyLinkBtn) {
  copyLinkBtn.addEventListener("click", async () => {
    const url = window.location.href;
    let copied = false;
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(url);
        copied = true;
      } catch {
        copied = false;
      }
    }
    showCopyLinkFeedback(copied);
  });
}

function showCopyLinkFeedback(copied) {
  if (!copyLinkBtn || !copyLinkLabel) return;

  copyLinkBtn.classList.toggle("is-copied", copied);
  copyLinkLabel.textContent = copied ? "copied!" : "copy failed";

  window.clearTimeout(copyLinkResetTimer);
  copyLinkResetTimer = window.setTimeout(() => {
    copyLinkBtn.classList.remove("is-copied");
    copyLinkLabel.textContent = "copy link";
  }, 1800);
}

window.addEventListener("resize", positionConnectors);
hydrateControlsFromState();
applyPreset();
positionConnectors();

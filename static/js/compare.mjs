// Comparison mode: fires one shared trigger against two hx-swap strategies at
// once (innerHTML vs outerHTML) and instruments each independently, so the two
// DOM patches sit side by side. It reuses the same real-htmx-events approach as
// the single-element view (see app.js) — nothing here is simulated — but scopes
// every readout to the lab whose element the event actually came from, keyed by
// DOM ancestry so it survives the outerHTML swap replacing the element wholesale.
import {
  demoUrl,
  statusClass,
  escapeHtml,
  splitHighlightSegments,
  describeRequestOutcome,
  comparisonLabConfigs,
} from "./lab-core.mjs";

// The two labs are identified by hx-swap; these are their stable element ids.
// An outerHTML self-swap comes back from the backend re-declaring id="demo-el"
// (the fragment restates the single-view element's identity — see
// fragments.go), so after every swap syncLab re-stamps the lab's own id back
// onto the replacement, exactly as the single view re-asserts #demo-el's
// attributes in its afterSwap handler.
const LAB_EL_ID = { innerHTML: "cmp-inner-el", outerHTML: "cmp-outer-el" };
const LAB_INDICATOR_ID = { innerHTML: "cmp-inner-indicator", outerHTML: "cmp-outer-indicator" };

export function setupCompareMode() {
  const rig = document.getElementById("compare-rig");
  const singleRig = document.querySelector(".rig");
  const announcer = document.querySelector('[data-field="status-announcer"]');
  if (!rig) {
    return { setActive() {}, sync() {}, isActive: () => false };
  }

  const labs = Array.from(rig.querySelectorAll(".compare-lab")).map((root) => ({
    root,
    swap: root.dataset.labSwap,
    fields: {
      status: root.querySelector('[data-field="status"]'),
      responseBody: root.querySelector('[data-field="response-body"]'),
      patchMarkup: root.querySelector('[data-field="patch-markup"]'),
    },
    lastStatus: null,
  }));

  // The select/indicator flags shared by both labs, captured on each sync so
  // the post-swap re-assertion in afterSettle rebuilds the same URL the fire
  // was issued with rather than reverting to defaults.
  let base = { select: false, indicator: false };
  let active = false;

  function labForEvent(evt) {
    const elt = evt.detail && evt.detail.elt;
    if (!elt) return null;
    return labs.find((lab) => lab.root.contains(elt)) || null;
  }

  function currentEl(lab) {
    return lab.root.querySelector(".demo-el");
  }

  // Re-applies the lab's full hx-* attribute set to its (possibly just
  // replaced) element and reprocesses it — the compare-mode equivalent of the
  // single view's syncDemoElAttributes, and for the same reason: htmx caches an
  // element's verb/path/trigger on first process, and an outerHTML swap drops
  // everything the fragment didn't restate (hx-trigger, hx-select, hx-indicator).
  function syncLab(lab) {
    const el = currentEl(lab);
    if (!el) return;

    const cfg = comparisonLabConfigs(base).find((c) => c.swap === lab.swap);
    const id = LAB_EL_ID[lab.swap];

    el.id = id;
    el.setAttribute("data-lab-el", "");
    el.classList.add("demo-el", "demo-el--compare");
    el.setAttribute("hx-get", demoUrl(cfg));
    el.setAttribute("hx-target", `#${id}`);
    el.setAttribute("hx-swap", lab.swap);
    el.setAttribute("hx-trigger", "click from:#compare-fire");

    if (cfg.select) {
      el.setAttribute("hx-select", "[data-fragment-content]");
    } else {
      el.removeAttribute("hx-select");
    }
    if (cfg.indicator) {
      el.setAttribute("hx-indicator", `#${LAB_INDICATOR_ID[lab.swap]}`);
    } else {
      el.removeAttribute("hx-indicator");
    }

    htmx.process(el);
  }

  function renderLabPatch(lab) {
    const el = currentEl(lab);
    if (!el) return;

    const markup = el.outerHTML;
    const carrier = lab.swap === "outerHTML" ? el : el.querySelector("[data-gen]");
    const gen = carrier ? carrier.getAttribute("data-gen") : null;

    lab.fields.patchMarkup.innerHTML = splitHighlightSegments(markup, gen)
      .map((seg) =>
        seg.highlighted
          ? `<mark class="is-flashing">${escapeHtml(seg.text)}</mark>`
          : escapeHtml(seg.text)
      )
      .join("");

    // Force reflow so the flash animation restarts on a repeated fire.
    el.classList.remove("is-flashing");
    void el.offsetWidth;
    el.classList.add("is-flashing");
  }

  // Announces only labs that have settled at least once this session, so the
  // first of the two near-simultaneous settles doesn't briefly announce a
  // false "request failed" for the sibling lab that hasn't landed yet.
  function announce() {
    if (!announcer) return;
    const settled = labs.filter((lab) => lab.lastStatus !== null);
    if (!settled.length) return;
    announcer.textContent = settled
      .map((lab) => describeRequestOutcome({ status: lab.lastStatus, swap: lab.swap, target: "self" }))
      .join(" ");
  }

  document.body.addEventListener("htmx:afterRequest", (evt) => {
    if (!active) return;
    const lab = labForEvent(evt);
    if (!lab) return;

    const xhr = evt.detail.xhr;
    lab.lastStatus = xhr.status;
    lab.fields.status.textContent = String(xhr.status);
    lab.fields.status.className = `status-chip ${statusClass(xhr.status)}`.trim();
    lab.fields.responseBody.textContent = xhr.responseText;
  });

  document.body.addEventListener("htmx:afterSettle", (evt) => {
    if (!active) return;
    const lab = labForEvent(evt);
    if (!lab) return;

    // Re-assert identity/attributes first so the patch panel renders the
    // element under its own id, then highlight the swapped node(s).
    syncLab(lab);
    renderLabPatch(lab);
    announce();
  });

  function sync(state) {
    base = { select: !!state.select, indicator: !!state.indicator };
    labs.forEach(syncLab);
  }

  function setActive(on) {
    active = on;
    rig.hidden = !on;
    if (singleRig) singleRig.hidden = on;
  }

  return { setActive, sync, isActive: () => active };
}

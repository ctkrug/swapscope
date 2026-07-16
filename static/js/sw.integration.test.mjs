// Drives the real service worker (static/sw.js) by standing up a fake worker
// global, so its fetch routing is covered directly: only same-origin api/demo
// is intercepted, everything else falls through to the network, and the
// install/activate lifecycle claims control. node --test isolates each test
// file in its own process, so assigning globalThis.self here is contained.
import { test } from "node:test";
import assert from "node:assert/strict";

const handlers = {};
let skipWaitingCalled = false;
let claimCalled = false;

globalThis.self = {
  location: { origin: "https://host" },
  addEventListener: (type, fn) => {
    handlers[type] = fn;
  },
  skipWaiting: () => {
    skipWaitingCalled = true;
  },
  clients: {
    claim: () => {
      claimCalled = true;
      return Promise.resolve();
    },
  },
};

// Importing the worker registers its listeners against the fake self above.
await import("../sw.js");

function fetchEvent(url, method = "GET") {
  let responded = null;
  const event = {
    request: { url, method },
    respondWith: (promise) => {
      responded = promise;
    },
  };
  return { event, responded: () => responded };
}

test("the worker registers install, activate, and fetch listeners", () => {
  for (const type of ["install", "activate", "fetch"]) {
    assert.equal(typeof handlers[type], "function", `missing ${type} listener`);
  }
});

test("install skips waiting and activate claims clients", () => {
  handlers.install();
  assert.equal(skipWaitingCalled, true);

  let waited = null;
  handlers.activate({ waitUntil: (p) => (waited = p) });
  assert.equal(claimCalled, true);
  assert.ok(waited instanceof Promise);
});

test("a same-origin api/demo GET is answered with a real fragment response", async () => {
  const { event, responded } = fetchEvent("https://host/attribute-lab/api/demo?swap=outerHTML");
  handlers.fetch(event);

  const res = await responded();
  assert.ok(res, "respondWith should have been called");
  assert.equal(res.status, 200);
  assert.match(await res.text(), /id="demo-el"/);
});

test("api/demo works at the site root too (local `make run` base path)", async () => {
  const { event, responded } = fetchEvent("https://host/api/demo");
  handlers.fetch(event);

  const res = await responded();
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Request #/);
});

test("a non-demo asset request falls through to the network untouched", () => {
  const { event, responded } = fetchEvent("https://host/attribute-lab/css/style.css");
  handlers.fetch(event);
  assert.equal(responded(), null, "respondWith must not be called for assets");
});

test("a cross-origin api/demo request is not intercepted", () => {
  const { event, responded } = fetchEvent("https://cdn.example/attribute-lab/api/demo");
  handlers.fetch(event);
  assert.equal(responded(), null, "only same-origin requests are handled");
});

test("a path that merely contains 'api/demo' mid-segment is ignored", () => {
  // endsWith('/api/demo') anchors on a full path segment, so this decoy misses.
  const { event, responded } = fetchEvent("https://host/attribute-lab/api/demo-notes");
  handlers.fetch(event);
  assert.equal(responded(), null);
});

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const riderSource = fs.readFileSync(path.join(__dirname, "..", "rider.js"), "utf8");

function makeHarness(initialRpcResult) {
  const elements = new Map();
  let authListener = null;
  let rpcResult = initialRpcResult;
  let intervalId = 0;
  let locationWatchId = 0;
  const locationWatches = new Map();
  const clearedLocationWatches = [];
  const locationRpcCalls = [];

  function element(selector) {
    if (elements.has(selector)) return elements.get(selector);
    const classes = new Set();
    const node = {
      selector,
      hidden: selector === "#rider-dashboard" || selector === "#approval-panel",
      disabled: false,
      textContent: "",
      innerHTML: "",
      className: "",
      style: {},
      attributes: {},
      listeners: {},
      classList: {
        toggle(name, force) {
          if (force === undefined) force = !classes.has(name);
          if (force) classes.add(name);
          else classes.delete(name);
          return force;
        },
        add(name) { classes.add(name); },
        remove(name) { classes.delete(name); },
        contains(name) { return classes.has(name); }
      },
      addEventListener(type, handler) { this.listeners[type] = handler; },
      setAttribute(name, value) { this.attributes[name] = String(value); },
      replaceChildren() { this.innerHTML = ""; },
      focus() {},
      reset() {},
      elements: {
        email: { value: "rider@example.com" },
        password: { value: "password123" },
        fullName: { value: "Test Rider" }
      }
    };
    elements.set(selector, node);
    return node;
  }

  const db = {
    auth: {
      async getSession() { return { data: { session: null }, error: null }; },
      onAuthStateChange(callback) { authListener = callback; return { data: { subscription: { unsubscribe() {} } } }; },
      async signOut() { return { error: null }; },
      async signInWithPassword() { return { data: { session: null }, error: null }; },
      async signUp() { return { data: { user: { identities: [{}] }, session: null }, error: null }; }
    },
    async rpc(name, args) {
      if (name === "get_my_delivery_orders") {
        return typeof rpcResult === "function" ? rpcResult() : rpcResult;
      }
      if (name === "update_my_delivery_location") {
        locationRpcCalls.push(args);
        return { data: { ok: true }, error: null };
      }
      assert.fail("Unexpected rider RPC: " + name);
    }
  };

  const document = {
    visibilityState: "visible",
    querySelector: element,
    addEventListener(type, handler) { element("document").listeners[type] = handler; }
  };
  const navigator = {
    onLine: true,
    vibrate() {},
    geolocation: {
      watchPosition(success, error, options) {
        const id = ++locationWatchId;
        locationWatches.set(id, { success, error, options });
        return id;
      },
      clearWatch(id) {
        clearedLocationWatches.push(id);
        locationWatches.delete(id);
      },
      getCurrentPosition(success) {
        success({ coords: { latitude: 5.6, longitude: -0.2, accuracy: 8, heading: 90, speed: 4 } });
      }
    }
  };
  const window = {
    AL_SHAMI_CONFIG: {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_ANON_KEY: "public-test-key"
    },
    supabase: { createClient() { return db; } },
    addEventListener(type, handler) { element("window").listeners[type] = handler; },
    setTimeout(callback) { return setTimeout(callback, 0); },
    setInterval(callback) { intervalId += 1; element("interval-" + intervalId).callback = callback; return intervalId; },
    clearInterval() {},
    location: { origin: "https://example.test", pathname: "/rider.html" }
  };

  vm.runInNewContext(riderSource, { window, document, navigator, console, setTimeout, clearTimeout, Promise, Set, Map, Date, Math, Number, String, Array, Object, RegExp, Error, encodeURIComponent });
  return {
    element,
    emitSession(session) {
      assert.equal(typeof authListener, "function", "auth listener should be registered");
      authListener(session ? "SIGNED_IN" : "SIGNED_OUT", session);
    },
    setRpcResult(result) { rpcResult = result; },
    getLocationWatchCount() { return locationWatchId; },
    getActiveLocationWatchCount() { return locationWatches.size; },
    getClearedLocationWatches() { return clearedLocationWatches.slice(); },
    getLocationRpcCalls() { return locationRpcCalls.slice(); },
    triggerLocation(position, id = 1) { locationWatches.get(id)?.success(position); },
    async settle() { await new Promise(resolve => setTimeout(resolve, 30)); }
  };
}

test("unapproved rider stays on approval screen and cannot see delivery dashboard", async () => {
  const harness = makeHarness({ data: null, error: { message: "This account is not an active AL SHAMI delivery rider" } });
  await harness.settle();
  harness.emitSession({ user: { id: "pending-user-id", email: "rider@example.com" } });
  await harness.settle();

  assert.equal(harness.element("#approval-panel").hidden, false);
  assert.equal(harness.element("#rider-dashboard").hidden, true);
  assert.equal(harness.element("#login-panel").hidden, true);
  assert.match(harness.element("#approval-title").textContent, /awaiting approval/i);
  assert.match(harness.element("#approval-message").textContent, /management must link/i);
});

test("approved rider can open dashboard even when no delivery has been assigned yet", async () => {
  const harness = makeHarness({ data: [], error: null });
  await harness.settle();
  harness.emitSession({ user: { id: "approved-user-id", email: "rider@example.com" } });
  await harness.settle();

  assert.equal(harness.element("#approval-panel").hidden, true);
  assert.equal(harness.element("#rider-dashboard").hidden, false);
  assert.equal(harness.element("#login-panel").hidden, true);
});

test("revoked rider access hides the dashboard on the next refresh", async () => {
  const harness = makeHarness({ data: [], error: null });
  await harness.settle();
  harness.emitSession({ user: { id: "approved-user-id", email: "rider@example.com" } });
  await harness.settle();
  assert.equal(harness.element("#rider-dashboard").hidden, false);

  harness.setRpcResult({ data: null, error: { message: "This account is not an active AL SHAMI delivery rider" } });
  const refresh = harness.element("#refresh-button").listeners.click;
  assert.equal(typeof refresh, "function", "refresh button handler should be bound");
  refresh();
  await harness.settle();

  assert.equal(harness.element("#approval-panel").hidden, false);
  assert.equal(harness.element("#rider-dashboard").hidden, true);
  assert.match(harness.element("#approval-title").textContent, /awaiting approval/i);
});

test("rider location starts automatically only when an assigned delivery is Out for delivery and stops afterward", async () => {
  const order = {
    id: "delivery-1",
    order_number: "1001",
    order_type: "delivery",
    status: "accepted",
    created_at: "2026-10-24T00:00:00Z",
    items: []
  };
  const harness = makeHarness({ data: [order], error: null });
  await harness.settle();
  harness.emitSession({ user: { id: "approved-user-id", email: "rider@example.com" } });
  await harness.settle();

  assert.equal(harness.getLocationWatchCount(), 0, "accepted orders must not start GPS sharing");
  assert.equal(harness.element("#location-toggle").disabled, true);

  harness.setRpcResult({ data: [{ ...order, status: "out_for_delivery" }], error: null });
  harness.element("#refresh-button").listeners.click();
  await harness.settle();

  assert.equal(harness.getLocationWatchCount(), 1, "Out for delivery should start GPS automatically");
  assert.equal(harness.element("#location-toggle").disabled, true, "automatic sharing should stay enabled while delivery is active");
  harness.triggerLocation({
    coords: { latitude: 5.6037, longitude: -0.187, accuracy: 8, heading: 90, speed: 4 }
  });
  await harness.settle();

  const locationCalls = harness.getLocationRpcCalls();
  assert.equal(locationCalls.length, 1, "the first GPS fix should be sent to Supabase");
  assert.equal(locationCalls[0].p_latitude, 5.6037);
  assert.equal(locationCalls[0].p_longitude, -0.187);

  harness.setRpcResult({ data: [], error: null });
  harness.element("#refresh-button").listeners.click();
  await harness.settle();

  assert.equal(harness.getActiveLocationWatchCount(), 0, "GPS watch should stop when no delivery is out");
  assert.deepEqual(harness.getClearedLocationWatches(), [1]);
  assert.equal(harness.element("#location-summary-value").textContent, "Off");
});

"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const workflow = require("../order-workflow.js");

const makeOrder = (order_type, status) => ({ order_type, status });

test("new orders can only be accepted or rejected", () => {
  const order = makeOrder("delivery", "new");
  assert.deepEqual(workflow.nextStatuses(order), ["accepted", "rejected"]);
  assert.equal(workflow.canTransition(order, "accepted"), true);
  assert.equal(workflow.canTransition(order, "preparing"), false);
  assert.equal(workflow.canTransition(order, "out_for_delivery"), false);
});

test("pickup orders follow preparation and require receipt authorization to complete", () => {
  assert.deepEqual(workflow.nextStatuses(makeOrder("pickup", "accepted")), ["preparing"]);
  assert.deepEqual(workflow.nextStatuses(makeOrder("pickup", "preparing")), ["ready"]);
  assert.deepEqual(workflow.nextStatuses(makeOrder("pickup", "ready")), []);
  assert.equal(workflow.canTransition(makeOrder("pickup", "ready"), "completed"), false);
  assert.equal(workflow.canTransition(makeOrder("pickup", "ready"), "completed", { receiptAuthorized: true }), true);
});

test("delivery orders must be marked ready before dispatch and receipt confirmation", () => {
  const ready = makeOrder("delivery", "ready");
  assert.deepEqual(workflow.nextStatuses(ready), ["out_for_delivery"]);
  assert.equal(workflow.canTransition(ready, "out_for_delivery"), true);
  assert.equal(workflow.canTransition(ready, "completed", { receiptAuthorized: true }), false);
  assert.equal(workflow.canTransition(makeOrder("delivery", "out_for_delivery"), "completed", { receiptAuthorized: true }), true);
});

test("invalid types, statuses, and skipped stages are rejected", () => {
  assert.deepEqual(workflow.nextStatuses(null), []);
  assert.deepEqual(workflow.nextStatuses(makeOrder("delivery", "unknown")), []);
  assert.equal(workflow.canTransition(makeOrder("delivery", "new"), "completed", { receiptAuthorized: true }), false);
  assert.equal(workflow.canTransition(makeOrder("pickup", "ready"), "out_for_delivery"), false);
});

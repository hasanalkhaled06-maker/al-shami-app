"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const customer = fs.readFileSync(path.resolve(__dirname, "../customer.js"), "utf8");

test("empty tracking responses retain the token and render a retryable active order", () => {
  assert.match(
    customer,
    /if\s*\(!data\)\s*return\s*\{\s*entry,\s*failed:true,\s*unavailable:true\s*\};/
  );
  assert.match(customer, /const validResults = results;/);
  assert.doesNotMatch(customer, /missingTokens|missingSet/);
  assert.match(
    customer,
    /const currentResults = validResults\.filter\(result =>\s*result\.failed \|\| currentStatuses\.has/
  );
  assert.match(customer, /const message = tr\("couldNotLoadTrackedOrder"\);/);
  assert.match(customer, /db\.rpc\("get_customer_order_tracking", \{ p_tracking_token: entry\.token \}\)/);
  assert.match(
    customer,
    /window\.setInterval\(\(\) => \{\s*if \(document\.visibilityState === "visible"\) void refreshCustomerOrderHistory\(\);/
  );
});

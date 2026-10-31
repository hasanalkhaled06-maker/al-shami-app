"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const source = fs.readFileSync(path.resolve(__dirname, "../customer.js"), "utf8");
const comparatorSource = source.match(/function compareMenuPopularity\(a, b, ranks\) \{[\s\S]*?\n    \}/);
assert.ok(comparatorSource, "customer menu popularity comparator should exist");
const compareMenuPopularity = vm.runInNewContext(`(${comparatorSource[0]})`);

test("popular menu sorting puts the best server rank first and unranked items last", () => {
  const ranks = new Map([["best", 1], ["next", 2]]);
  const items = [
    { id: "unranked", sort_order: 1 },
    { id: "next", sort_order: 2 },
    { id: "best", sort_order: 3 }
  ];
  items.sort((a, b) => compareMenuPopularity(a, b, ranks));
  assert.deepEqual(items.map(item => item.id), ["best", "next", "unranked"]);
});

test("popular menu sorting keeps local popularity fallback descending", () => {
  const items = [
    { id: "less-popular", popularity: 3 },
    { id: "more-popular", popularity: 12 }
  ];
  items.sort((a, b) => compareMenuPopularity(a, b, new Map()));
  assert.deepEqual(items.map(item => item.id), ["more-popular", "less-popular"]);
});

test("popular ranking release refreshes customer and order-history script caches", () => {
  const pages = ["index.html", "history.html"];
  for (const page of pages) {
    const html = fs.readFileSync(path.resolve(__dirname, "../" + page), "utf8");
    assert.ok(html.includes("customer.js?v=popular-rank-20261031a"), page + " must load the current popularity fix");
  }
  const serviceWorker = fs.readFileSync(path.resolve(__dirname, "../service-worker.js"), "utf8");
  assert.ok(serviceWorker.includes('"./customer.js?v=popular-rank-20261031a"'));
  assert.ok(serviceWorker.includes('CACHE_PREFIX + "v160"'));
});

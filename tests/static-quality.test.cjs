"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const PAGES = ["index.html", "history.html", "admin.html", "rider.html"];
const MANIFESTS = ["manifest.webmanifest", "admin.webmanifest", "rider.webmanifest"];

function source(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function tags(html, tagName) {
  const expression = new RegExp("<" + tagName + "\\b[^>]*>", "gi");
  return [...html.matchAll(expression)].map(match => match[0]);
}

function attribute(tag, name) {
  const expression = new RegExp(
    "\\s+" + name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))",
    "i"
  );
  const match = tag.match(expression);
  return match ? (match[1] ?? match[2] ?? match[3] ?? "") : null;
}

function localPath(reference) {
  const value = String(reference || "").trim();
  if (
    !value ||
    value.startsWith("#") ||
    value.startsWith("//") ||
    /^(?:https?:|data:|mailto:|tel:|javascript:|blob:|about:)/i.test(value)
  ) return null;

  let pathname = value.split(/[?#]/, 1)[0];
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    // Keep malformed encoding so the existence check fails visibly.
  }
  pathname = pathname.replace(/^\/+/, "").replace(/^\.\//, "");
  if (!pathname || pathname === ".") return ".";
  return pathname;
}

test("all application pages have unique IDs", () => {
  for (const page of PAGES) {
    const ids = tags(source(page), "[a-z][a-z0-9:-]*")
      .map(tag => attribute(tag, "id"))
      .filter(Boolean);
    const seen = new Set();
    const duplicates = [];
    for (const id of ids) {
      if (seen.has(id)) duplicates.push(id);
      seen.add(id);
    }
    assert.deepEqual(duplicates, [], page + " has duplicate IDs");
  }
});

test("all local HTML asset references point to existing repository files", () => {
  const rootPrefix = ROOT + path.sep;
  for (const page of PAGES) {
    for (const tag of tags(source(page), "[a-z][a-z0-9:-]*")) {
      for (const name of ["src", "href"]) {
        const reference = attribute(tag, name);
        const relative = localPath(reference);
        if (relative === null) continue;
        const resolved = path.resolve(ROOT, relative);
        assert.ok(
          resolved === ROOT || resolved.startsWith(rootPrefix),
          page + " contains a path escaping the repository root: " + reference
        );
        assert.ok(
          fs.existsSync(resolved),
          page + " references a missing local asset: " + reference
        );
      }
    }
  }
});

test("all PWA manifests are valid JSON and their icons exist", () => {
  for (const manifestPath of MANIFESTS) {
    const manifest = JSON.parse(source(manifestPath));
    assert.ok(manifest.name, manifestPath + " must define a name");
    assert.ok(manifest.start_url, manifestPath + " must define a start_url");
    assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0,
      manifestPath + " must define at least one icon");
    for (const icon of manifest.icons) {
      const relative = localPath(icon.src);
      assert.notEqual(relative, null, manifestPath + " icon must be local");
      assert.ok(fs.existsSync(path.resolve(ROOT, relative)),
        manifestPath + " references missing icon " + icon.src);
    }
  }
});

test("dark-theme.css is the final local stylesheet on every app page", () => {
  for (const page of PAGES) {
    const localStylesheets = tags(source(page), "link")
      .filter(tag => /(?:^|\s)stylesheet(?:\s|$)/i.test(attribute(tag, "rel") || ""))
      .map(tag => attribute(tag, "href"))
      .filter(href => href && !/^https?:/i.test(href) && !href.startsWith("//"));
    assert.ok(localStylesheets.length > 0, page + " must load local stylesheets");
    const finalStylesheet = localStylesheets[localStylesheets.length - 1];
    assert.equal(
      path.basename(String(finalStylesheet).split(/[?#]/, 1)[0]),
      "dark-theme.css",
      page + " must load dark-theme.css last to preserve the shared design"
    );
  }
});

test("every versioned local stylesheet is listed in the service-worker cache shell", () => {
  const worker = source("service-worker.js");
  const shellMatch = worker.match(/const SHELL_FILES\s*=\s*\[([\s\S]*?)\];/);
  assert.ok(shellMatch, "service worker must declare SHELL_FILES");
  const shell = new Set(
    [...shellMatch[1].matchAll(/["']([^"']+)["']/g)].map(match => match[1])
  );

  for (const page of PAGES) {
    for (const tag of tags(source(page), "link")) {
      if (!/(?:^|\s)stylesheet(?:\s|$)/i.test(attribute(tag, "rel") || "")) continue;
      const href = attribute(tag, "href");
      if (!href || /^https?:/i.test(href) || href.startsWith("//") || !href.includes("?v=")) continue;
      const normalized = "./" + href.replace(/^\.\//, "").replace(/^\//, "");
      assert.ok(shell.has(normalized),
        page + " stylesheet is missing from the service-worker cache shell: " + normalized);
    }
  }
});

test("removed chef illustration has no orphan animation CSS", () => {
  const html = source("index.html");
  const theme = source("dark-theme.css");
  assert.doesNotMatch(html, /al-shami-chef-mascot|al-shami-chef-art|al-shami-chef-spark/);
  assert.doesNotMatch(theme, /al-shami-chef-art|al-shami-chef-spark|al-shami-chef-mascot/);
  assert.doesNotMatch(theme, /@keyframes\s+(?:alShamiChef|shamiChef)/i);
  assert.match(theme, /AL SHAMI account brand: text-only, centered wordmark/);
});

test("browser configuration does not contain a Supabase secret/service-role key", () => {
  const config = source("config.js");
  assert.doesNotMatch(config, /SUPABASE_SERVICE_ROLE_KEY\s*:/i);
  assert.doesNotMatch(config, /sb_secret_[A-Za-z0-9_-]+/i);
  assert.match(config, /SUPABASE_URL\s*:\s*"https:\/\//);
  assert.match(config, /SUPABASE_ANON_KEY\s*:/);
});


test("customer, admin, and rider authentication sessions use distinct storage keys", () => {
  const keyFrom = (file, label) => {
    const match = source(file).match(/storageKey:\s*["']([^"']+)["']/);
    assert.ok(match, label + " must explicitly configure its Supabase storageKey");
    return match[1];
  };
  const keys = [
    keyFrom("customer.js", "customer app"),
    keyFrom("admin.js", "admin app"),
    keyFrom("rider.js", "rider app")
  ];
  assert.deepEqual(keys, [
    "al-shami-customer-auth-v1",
    "al-shami-admin-auth-v1",
    "al-shami-rider-auth-v1"
  ]);
  assert.equal(new Set(keys).size, 3, "each app must use a separate auth session key");
});

test("every versioned local JavaScript asset is included in the service-worker shell", () => {
  const worker = source("service-worker.js");
  const shellMatch = worker.match(/const SHELL_FILES\s*=\s*\[([\s\S]*?)\];/);
  assert.ok(shellMatch, "service worker must declare SHELL_FILES");
  const shell = new Set(
    [...shellMatch[1].matchAll(/["']([^"']+)["']/g)].map(match => match[1])
  );

  for (const page of PAGES) {
    for (const tag of tags(source(page), "script")) {
      const src = attribute(tag, "src");
      if (!src || /^https?:/i.test(src) || src.startsWith("//") || !src.includes("?v=")) continue;
      const normalized = "./" + src.replace(/^\.\//, "").replace(/^\//, "");
      assert.ok(shell.has(normalized),
        page + " script is missing from the service-worker cache shell: " + normalized);
    }
  }
});

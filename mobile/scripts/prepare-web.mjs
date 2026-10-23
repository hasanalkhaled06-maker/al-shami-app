import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../..");
const mobileRoot = path.resolve(repositoryRoot, "mobile");
const webDirectory = path.resolve(mobileRoot, "web");

const customerFiles = [
  "index.html",
  "history.html",
  "customer.js",
  "config.js",
  "style.css",
  "app-refresh.css",
  "dark-theme.css"
];

async function readSource(relativePath) {
  const sourcePath = path.resolve(repositoryRoot, relativePath);
  return readFile(sourcePath, "utf8");
}

function countMatches(value, expression) {
  return [...value.matchAll(expression)].length;
}

function prepareCustomerHtml(relativePath, html) {
  // Native builds use Capacitor's own app icon and lifecycle. Do not install a
  // website service worker inside the native WebView.
  html = html.replace(/^\s*<link\b[^>]*rel=["']manifest["'][^>]*>\s*\r?\n?/gim, "");
  html = html.replace(/^\s*<link\b[^>]*rel=["'](?:icon|apple-touch-icon)["'][^>]*>\s*\r?\n?/gim, "");
  html = html.replace(/^\s*<script\b[^>]*src=["']\.\/??pwa\.js(?:\?[^"']*)?["'][^>]*>\s*<\/script>\s*\r?\n?/gim, "");
  html = html.replace(/^\s*<script\b[^>]*src=["']pwa\.js(?:\?[^"']*)?["'][^>]*>\s*<\/script>\s*\r?\n?/gim, "");

  // Keep staff entry points out of the customer-only mobile package. Fail
  // closed if source markup changes so we can review it before packaging.
  const staffLink = /<a href="admin\.html">Staff \/ Admin<\/a>/g;
  const staffLinkCount = countMatches(html, staffLink);
  if (staffLinkCount !== 1) {
    throw new Error(
      `Expected exactly one customer-page staff link in ${relativePath}; found ${staffLinkCount}. Review the markup before packaging.`
    );
  }
  html = html.replace(staffLink, "");

  if (/rel=["']manifest["']|src=["']\.?\/?pwa\.js/i.test(html)) {
    throw new Error(`PWA manifest/service-worker bootstrap remains in native copy: ${relativePath}`);
  }
  return html;
}

await mkdir(mobileRoot, { recursive: true });
await rm(webDirectory, { recursive: true, force: true });
await mkdir(webDirectory, { recursive: true });

for (const relativePath of customerFiles) {
  const source = await readSource(relativePath);
  const output = relativePath.endsWith(".html")
    ? prepareCustomerHtml(relativePath, source)
    : source;
  await writeFile(path.join(webDirectory, relativePath), output, "utf8");
}

await cp(
  path.resolve(repositoryRoot, "icons"),
  path.resolve(webDirectory, "icons"),
  { recursive: true }
);

console.log(`Prepared customer-only native web assets in ${path.relative(repositoryRoot, webDirectory)}.`);
console.log("Source website files were read only; admin, rider, database, and production configuration were not modified.");

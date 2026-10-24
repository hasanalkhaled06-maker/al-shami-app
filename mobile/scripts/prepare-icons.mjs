import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.resolve(here, "..");
const assetsDir = path.resolve(mobileRoot, "assets");
const svgPath = path.join(assetsDir, "icon.svg");
const svg = await readFile(svgPath);
await mkdir(assetsDir, { recursive: true });

// Capacitor Assets expects raster source files; render the approved English
// brand mark explicitly so it never falls back to the default blue icon.
await sharp(svg).resize(1024, 1024).png().toFile(path.join(assetsDir, "icon.png"));
await sharp(svg).resize(2732, 2732, { fit: "contain", background: "#4f0d16" })
  .png().toFile(path.join(assetsDir, "splash.png"));

console.log("Generated English AL SHAMI icon and splash source images.");

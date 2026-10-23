import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  // Provisional app ID; confirm before the first public store submission.
  appId: "xyz.alshamiapp.restaurant",
  appName: "AL SHAMI RESTAURANT",
  webDir: "web",
  bundledWebRuntime: false,
  // Do not set server.url: the preview packages the customer pages locally.
  // Business data and order operations continue to use the existing HTTPS APIs.
};

export default config;

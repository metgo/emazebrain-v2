import type { CapacitorConfig } from "@capacitor/cli";

// Local spike only. Production uses two flavours: app.emazebrain.clinic and app.emazebrain.home.
const config: CapacitorConfig = {
  appId: "app.emazebrain.spike",
  appName: "eMaze Offline Spike",
  webDir: "dist",
};

export default config;

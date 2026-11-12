import express from "express";

const router = express.Router();

/**
 * @route GET /api/tracker/version
 * @desc Public version requirements check endpoint for clients & companions
 */
router.get("/version", (_req, res) => {
  const minVersion = process.env.MIN_TRACKER_VERSION || "1.0.0";
  const latestVersion = "1.0.2";
  res.json({
    success: true,
    minVersion,
    latestVersion,
    downloadUrl: "https://github.com/mhazm/fortune-cookie-client/releases/latest",
  });
});

/**
 * @route GET /api/tracker/update.json
 * @desc Tauri v2 Auto-Updater Manifest Endpoint
 */
router.get("/update.json", (req, res) => {
  const configuredBaseUrl = (process.env.PUBLIC_SERVER_URL || "").trim().replace(/\/+$/, "");
  const host = req.get("host") || "localhost:3100";
  const protocol = req.protocol || "http";
  const baseUrl = configuredBaseUrl || `${protocol}://${host}`;

  res.json({
    version: "1.0.2",
    notes: "Nismara Companion v1.0.2: Close Beta Release — 3-pillar hardcore validation, adaptive ETS2/ATS speed limits, interactive phone positioning, and auto-updater.",
    pub_date: new Date().toISOString(),
    platforms: {
      "windows-x86_64": {
        signature: "",
        url: `${baseUrl}/downloads/NismaraCompanion_Setup.exe`,
      },
      "linux-x86_64": {
        signature: "",
        url: `${baseUrl}/downloads/NismaraCompanion_amd64.AppImage`,
      },
      "darwin-x86_64": {
        signature: "",
        url: `${baseUrl}/downloads/NismaraCompanion_x64.app.tar.gz`,
      },
      "darwin-aarch64": {
        signature: "",
        url: `${baseUrl}/downloads/NismaraCompanion_aarch64.app.tar.gz`,
      },
    },
    plugin_binaries: {
      version: "1.2.0",
      windows_x64: `${baseUrl}/downloads/NismaraTracker.dll`,
      linux_x64: `${baseUrl}/downloads/libNismaraTracker.so`,
      macos_universal: `${baseUrl}/downloads/libNismaraTracker.dylib`,
    },
    plugin_dll: {
      version: "1.2.0",
      url: `${baseUrl}/downloads/NismaraTracker.dll`,
    },
  });
});

export default router;


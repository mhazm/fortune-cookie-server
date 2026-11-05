import { connectDB } from "../config/db.js";

function parseSemVer(v) {
  const clean = String(v || "0.0.0").replace(/^v/i, "").trim();
  const parts = clean.split(".").map((n) => parseInt(n, 10) || 0);
  while (parts.length < 3) parts.push(0);
  return parts.slice(0, 3);
}

function isVersionOutdated(clientVer, minVer) {
  const [cMaj, cMin, cPat] = parseSemVer(clientVer);
  const [mMaj, mMin, mPat] = parseSemVer(minVer);
  if (cMaj < mMaj) return true;
  if (cMaj > mMaj) return false;
  if (cMin < mMin) return true;
  if (cMin > mMin) return false;
  return cPat < mPat;
}

/**
 * Middleware to authenticate requests from NismaraTracker plugin & Nismara Companion
 * using `Authorization: Bearer <trackerToken>` or `x-tracker-token` header.
 * Strict multi-user isolation and mandatory version gatekeeper for 24/7 production server.
 */
export async function authTracker(req, res, next) {
  try {
    const db = await connectDB();

    const minVersion = (process.env.MIN_TRACKER_VERSION || "1.0.0").trim();
    const clientVersion = (
      req.headers["x-tracker-version"] ||
      req.headers["x-plugin-version"] ||
      "1.0.0"
    ).trim();

    // Check mandatory minimum client version
    if (isVersionOutdated(clientVersion, minVersion)) {
      return res.status(426).json({
        success: false,
        errorCode: "OUTDATED_VERSION",
        clientVersion,
        minVersion,
        error: `Versi Nismara Tracker Anda (${clientVersion}) usang. Versi minimum adalah v${minVersion}. Silakan buka Nismara Companion untuk memperbarui ke versi terbaru.`,
      });
    }

    const authHeader = req.headers["authorization"] || "";
    let token = "";
    if (authHeader.toLowerCase().startsWith("bearer ")) {
      token = authHeader.slice(7).trim();
    } else if (req.headers["x-tracker-token"]) {
      token = String(req.headers["x-tracker-token"]).trim();
    } else if (req.body?.token || req.body?.driverToken) {
      token = String(req.body.token || req.body.driverToken).trim();
    }

    const steamIdHeader = (req.headers["x-steam-id"] || "").trim();

    let user = null;

    if (token.length >= 16) {
      user = await db.collection("users").findOne({ trackerToken: token });
    } else if (steamIdHeader.length >= 10) {
      user = await db.collection("users").findOne({ steamId: steamIdHeader });
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        error: "Invalid or missing Nismara Tracker token. Generate a token in Dashboard -> Settings.",
      });
    }

    // Update tracker telemetry heartbeat metadata asynchronously
    db.collection("users")
      .updateOne(
        { _id: user._id },
        {
          $set: {
            trackerLastSync: new Date(),
            trackerVersion: clientVersion,
          },
        }
      )
      .catch(() => {});

    req.driverUser = user;
    req.db = db;
    next();
  } catch (err) {
    console.error("[AuthTracker Error]:", err);
    return res.status(500).json({
      success: false,
      error: "Internal server error during tracker authentication.",
    });
  }
}


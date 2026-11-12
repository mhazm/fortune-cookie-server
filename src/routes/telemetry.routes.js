import express from "express";
import { authTracker } from "../middleware/authTracker.js";
import { setLiveTelemetry, getAllLiveTelemetry } from "../config/redis.js";

const router = express.Router();

/**
 * POST /api/tracker/telemetry/live
 * In-game plugin sends live position every 3-5 seconds.
 * Saved in Redis hash/string with 30s TTL.
 */
router.post("/telemetry/live", authTracker, async (req, res) => {
  try {
    const user = req.driverUser;
    const body = req.body || {};

    const rawGameId = String(body.gameId || req.headers["x-game-id"] || "1").toLowerCase();
    const gameId =
      rawGameId === "2" || rawGameId === "ats" || rawGameId === "amtrucks"
        ? "2"
        : "1";

    const driverKey = `${gameId}:${user.discordId}`;

    const telemetryPacket = {
      discordId: String(user.discordId),
      driverName: user.name || "Driver",
      truckyRank: user.truckyRank || "Driver",
      gameId: gameId,
      fleetNumber: body.fleetNumber || null,
      x: Number(body.x || 0),
      y: Number(body.y || 0),
      z: Number(body.z || 0),
      speed: Number(body.speed || 0),
      heading: Number(body.heading || 0),
      gear: Number(body.gear || 0),
      drivenDistanceKm: Number(body.drivenDistanceKm || 0),
      isPaused: Boolean(body.isPaused),
      serverType: body.serverType || "Singleplayer",
      updatedAt: new Date().toISOString(),
    };

    await setLiveTelemetry(driverKey, telemetryPacket, 30);

    return res.json({
      success: true,
      timestamp: telemetryPacket.updatedAt,
    });
  } catch (err) {
    console.error("[POST /api/tracker/telemetry/live Error]:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to record live telemetry.",
    });
  }
});

/**
 * GET /api/tracker/telemetry/live-map
 * Retrieves all currently active drivers for nismara-logistics web live map.
 */
router.get("/telemetry/live-map", async (req, res) => {
  try {
    const rawGameId = String(req.query.gameId || "").toLowerCase();
    const filterGameId =
      rawGameId === "2" || rawGameId === "ats" || rawGameId === "amtrucks"
        ? "2"
        : rawGameId === "1" || rawGameId === "ets2" || rawGameId === "eut2"
        ? "1"
        : null;

    let activeDrivers = await getAllLiveTelemetry();

    if (filterGameId) {
      activeDrivers = activeDrivers.filter((d) => d.gameId === filterGameId);
    }

    return res.json({
      success: true,
      count: activeDrivers.length,
      data: activeDrivers,
    });
  } catch (err) {
    console.error("[GET /api/tracker/telemetry/live-map Error]:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch live fleet map data.",
    });
  }
});

export default router;

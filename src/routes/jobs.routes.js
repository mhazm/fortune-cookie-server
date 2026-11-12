import express from "express";
import { authTracker } from "../middleware/authTracker.js";
import {
  processJobStart,
  processJobComplete,
  processJobCancel,
  processJobCheckpoint,
} from "../services/jobProcessor.js";

const router = express.Router();

/**
 * POST /api/tracker/jobs/start
 * Records a new ONGOING job in `jobhistories`, locks cargo price, and updates cargo demand.
 */
router.post("/jobs/start", authTracker, async (req, res) => {
  try {
    const result = await processJobStart(req.db, req.driverUser, req.body || {});
    return res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    console.error("[POST /api/tracker/jobs/start Error]:", err);
    return res.status(500).json({
      success: false,
      error: err.message || "Failed to record job start.",
    });
  }
});

/**
 * POST /api/tracker/jobs/complete
 * Finalizes an ONGOING job in `jobhistories` (`COMPLETED`), calculates NC rewards,
 * expenses (service, fuel, rent, fines), penalties, XP, fleet wear, and updates wallet.
 */
router.post("/jobs/complete", authTracker, async (req, res) => {
  try {
    const result = await processJobComplete(req.db, req.driverUser, req.body || {});
    return res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    console.error("[POST /api/tracker/jobs/complete Error]:", err);
    return res.status(400).json({
      success: false,
      error: err.message || "Failed to complete job.",
    });
  }
});

/**
 * POST /api/tracker/jobs/checkpoint
 * Saves mid-job progress (driven distance, fuel, damage, coordinates, breadcrumb points)
 * to prevent data loss on crashes or quit-and-resume.
 */
router.post("/jobs/checkpoint", authTracker, async (req, res) => {
  try {
    const result = await processJobCheckpoint(req.db, req.driverUser, req.body || {});
    return res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    console.error("[POST /api/tracker/jobs/checkpoint Error]:", err);
    return res.status(500).json({
      success: false,
      error: err.message || "Failed to save job checkpoint.",
    });
  }
});

/**
 * POST /api/tracker/jobs/cancel
 * Marks the driver's ONGOING job as `CANCELED` and applies the 5-point cancel penalty.
 */
router.post("/jobs/cancel", authTracker, async (req, res) => {
  try {
    const result = await processJobCancel(req.db, req.driverUser, req.body || {});
    return res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    console.error("[POST /api/tracker/jobs/cancel Error]:", err);
    return res.status(500).json({
      success: false,
      error: err.message || "Failed to cancel job.",
    });
  }
});

export default router;


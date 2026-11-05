import express from "express";
import { authTracker } from "../middleware/authTracker.js";

const router = express.Router();
const NISMARA_GUILD_ID = process.env.NISMARA_GUILD_ID || "863959415702028318";

/**
 * GET & POST /api/tracker/me
 * Returns the authenticated driver's profile, real NC balance (`currencies`),
 * points (`points`), personal garage (`garages`), and full fleet roster (`fleets`).
 */
const handleMeRequest = async (req, res) => {
  try {
    const user = req.driverUser;
    const db = req.db;
    const now = new Date();

    const rawGameId = String(req.body?.gameId || req.headers["x-game-id"] || "").toLowerCase();
    const mappedGameId = rawGameId === "ats" || rawGameId === "2" ? "2" : rawGameId === "eut2" || rawGameId === "ets2" || rawGameId === "1" ? "1" : "";
    const ongoingFilter = {
      guildId: NISMARA_GUILD_ID,
      driverId: String(user.discordId),
      jobStatus: "ONGOING",
    };
    if (mappedGameId) {
      ongoingFilter.gameId = mappedGameId;
    }

    const [currencyDoc, pointsDoc, garageDoc, fleetDocs, ongoingJobDoc, guildSettingsDoc] = await Promise.all([
      user.discordId
        ? db.collection("currencies").findOne({
            userId: String(user.discordId),
            guildId: NISMARA_GUILD_ID,
          })
        : Promise.resolve(null),
      user.discordId
        ? db.collection("points").findOne({
            userId: String(user.discordId),
            guildId: NISMARA_GUILD_ID,
          })
        : Promise.resolve(null),
      user.discordId
        ? db.collection("garages").findOne({
            $or: [{ discordId: String(user.discordId) }, { userId: user._id }],
          })
        : Promise.resolve(null),
      db
        .collection("fleets")
        .aggregate([
          {
            $match: {
              $or: [{ driver: user._id }, { owner: user._id }],
            },
          },
          {
            $lookup: {
              from: "fleetstores",
              localField: "model",
              foreignField: "_id",
              as: "modelInfo",
            },
          },
          {
            $unwind: {
              path: "$modelInfo",
              preserveNullAndEmptyArrays: true,
            },
          },
          {
            $lookup: {
              from: "fleetbrands",
              localField: "modelInfo.brand",
              foreignField: "_id",
              as: "brandInfo",
            },
          },
          {
            $unwind: {
              path: "$brandInfo",
              preserveNullAndEmptyArrays: true,
            },
          },
          {
            $sort: { id: 1 },
          },
        ])
        .toArray(),
      user.discordId
        ? db.collection("jobhistories").findOne(ongoingFilter)
        : Promise.resolve(null),
      db.collection("guildsettings").findOne({ guildId: NISMARA_GUILD_ID }),
    ]);

    const actualNC =
      currencyDoc && typeof currencyDoc.totalNC === "number"
        ? currencyDoc.totalNC
        : user.nc ?? 0;

    const actualPoints =
      pointsDoc && typeof pointsDoc.totalPoints === "number"
        ? pointsDoc.totalPoints
        : 0;

    const insuranceActive = Boolean(
      user.insurance?.status &&
        (!user.insurance?.expiredAt || new Date(user.insurance.expiredAt) > now)
    );

    const nismaraPlusActive = Boolean(
      user.nismaraplus?.status &&
        (!user.nismaraplus?.expiredAt || new Date(user.nismaraplus.expiredAt) > now)
    );

    const basePointPrice = guildSettingsDoc?.pointPrice || 3000;
    const discountBooster = Boolean(user.isBooster) ? 500 : 0;
    const discountNismaraPlus = nismaraPlusActive ? 500 : 0;
    const totalDiscount = discountBooster + discountNismaraPlus;
    const finalPointPrice = Math.max(0, basePointPrice - totalDiscount);

    const safeboxStock = typeof garageDoc?.safeboxStock === "number" ? garageDoc.safeboxStock : 0;
    const safeboxLevel = typeof garageDoc?.safeboxLevel === "number" ? garageDoc.safeboxLevel : 1;
    const maxPenaltyTickets = 10 + (safeboxLevel - 1) * 5;

    const ncBoostActive = Boolean(
      user.ncBoost?.active &&
        (!user.ncBoost?.expiredAt || new Date(user.ncBoost.expiredAt) > now)
    );

    const topManagerActive = Boolean(
      user.topManager?.status &&
        (!user.topManager?.expiredAt || new Date(user.topManager.expiredAt) > now)
    );

    return res.json({
      success: true,
      serverTime: now.toISOString(),
      driver: {
        id: String(user._id),
        name: user.name || "Unknown Driver",
        email: user.email || "",
        image: user.image || "",
        bannerUrl: user.bannerUrl || "",
        backgroundUrl: user.backgroundUrl || "",
        discordId: user.discordId || "",
        discordRole: user.discordRole || "member",
        steamId: user.steamId || "",
        truckyId: user.truckyId ?? 0,
        truckersmpId: user.truckersmpId || "",

        level: user.level ?? 1,
        xp: user.xp ?? 0,
        nc: actualNC,
        totalNC: actualNC,
        totalNc: actualNC,
        points: actualPoints,
        penaltyPoints: actualPoints,
        pointPrice: basePointPrice,
        discountBooster,
        discountNismaraPlus,
        totalDiscount,
        finalPointPrice,
        safeboxTickets: safeboxStock,
        safeboxLevel,
        maxPenaltyTickets,
        joinedConvoy: user.joinedConvoy ?? 0,

        truckyRole: user.truckyRole || "Driver",
        truckyRoleColor: user.truckyRoleColor || "#efbf04",
        truckyRank: user.truckyRank || "Rookie",
        truckyRankColor: user.truckyRankColor || "#8e24aa",
        truckyColor: user.truckyColor || "#efbf04",

        isDriver: Boolean(user.isDriver),
        isOnLeave: Boolean(user.isOnLeave),
        isBooster: Boolean(user.isBooster),
        isGuildMember: Boolean(user.isGuildMember),
        isTmpDriver: Boolean(user.isTmpDriver),
        isHaulmpDriver: Boolean(user.isHaulmpDriver),
        isBestEmployeeETS2: Boolean(user.isBestEmployeeETS2),
        isBestEmployeeATS: Boolean(user.isBestEmployeeATS),

        insurance: {
          status: insuranceActive,
          rating: user.insurance?.rating ?? 0,
          startedAt: user.insurance?.startedAt
            ? new Date(user.insurance.startedAt).toISOString()
            : null,
          expiredAt: user.insurance?.expiredAt
            ? new Date(user.insurance.expiredAt).toISOString()
            : null,
        },
        nismaraplus: {
          status: nismaraPlusActive,
          startedAt: user.nismaraplus?.startedAt
            ? new Date(user.nismaraplus.startedAt).toISOString()
            : null,
          expiredAt: user.nismaraplus?.expiredAt
            ? new Date(user.nismaraplus.expiredAt).toISOString()
            : null,
          lastClaimAt: user.nismaraplus?.lastClaimAt
            ? new Date(user.nismaraplus.lastClaimAt).toISOString()
            : null,
        },
        ncBoost: {
          active: ncBoostActive,
          multiplier: user.ncBoost?.multiplier ?? 0,
          voucherTitle: user.ncBoost?.voucherTitle || "",
          voucherCode: user.ncBoost?.voucherCode || "",
          startedAt: user.ncBoost?.startedAt
            ? new Date(user.ncBoost.startedAt).toISOString()
            : null,
          expiredAt: user.ncBoost?.expiredAt
            ? new Date(user.ncBoost.expiredAt).toISOString()
            : null,
        },
        topManager: {
          status: topManagerActive,
          month: user.topManager?.month || "",
          awardedAt: user.topManager?.awardedAt
            ? new Date(user.topManager.awardedAt).toISOString()
            : null,
          expiredAt: user.topManager?.expiredAt
            ? new Date(user.topManager.expiredAt).toISOString()
            : null,
        },

        garage: garageDoc
          ? {
              id: String(garageDoc._id),
              status: garageDoc.status || "operational",
              fleetSlot: garageDoc.fleetSlot ?? 1,
              fleetSlotUsed: garageDoc.fleetSlotUsed ?? 0,
              fuelCapacity: garageDoc.fuelCapacity ?? 2000,
              fuelStock: garageDoc.fuelStock ?? 0,
              safeboxLevel: safeboxLevel,
              safeboxStock: safeboxStock,
              maxPenaltyTickets: maxPenaltyTickets,
            }
          : null,

        fleets: (fleetDocs || []).map((f) => ({
          id: f.id || "",
          mongoId: String(f._id),
          fleetNumber: f.fleet_number || "",
          fleetName: f.fleet_name || "",
          customName: f.custom_name || "",
          gameId: String(f.game_id || "1"),
          odometer: f.odometer ?? 0,
          wheels: f.wheels || "4x2",
          status: f.status || "active",
          hasInsurance: Boolean(f.has_insurance),
          maintenanceNeeded: Boolean(f.maintenance_needed),
          isAssignedDriver: String(f.driver) === String(user._id),
          inGameId: f.modelInfo?.in_game_id || "",
          modelName: f.modelInfo?.name || "",
          modelType: f.modelInfo?.type || "truck",
          photoUrl: f.modelInfo?.photo_url || "",
          brandName: f.brandInfo?.name || "",
          wear: {
            unfixEngine: f.wear?.unfix_engine ?? 0,
            unfixTransmission: f.wear?.unfix_transmission ?? 0,
            unfixBrakes: f.wear?.unfix_brakes ?? 0,
            unfixTires: f.wear?.unfix_tires ?? 0,
          },
          maintenance: {
            engine: f.maintenance?.engine ?? 50000,
            tires: f.maintenance?.tires ?? 20000,
            transmission: f.maintenance?.transmission ?? 70000,
            brakes: f.maintenance?.brakes ?? 35000,
          },
        })),

        ongoingJob: ongoingJobDoc
          ? {
              jobId: String(ongoingJobDoc.jobId),
              gameMode: ongoingJobDoc.gameMode || "sp",
              lockedCargoPrice: ongoingJobDoc.lockedCargoPrice ?? 1.5,
              isSpecialContract: Boolean(ongoingJobDoc.isSpecialContract),
              sourceCity: ongoingJobDoc.sourceCity || "",
              destinationCity: ongoingJobDoc.destinationCity || "",
              cargoName: ongoingJobDoc.cargoName || "",
            }
          : null,
      },
    });
  } catch (err) {
    console.error("[/api/tracker/me Error]:", err);
    return res.status(500).json({
      success: false,
      error: "Internal server error while fetching driver profile.",
    });
  }
};

router.get("/me", authTracker, handleMeRequest);
router.post("/me", authTracker, handleMeRequest);

export default router;

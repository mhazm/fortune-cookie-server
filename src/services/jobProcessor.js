import { getNextJobId } from "../config/db.js";

const NISMARA_GUILD_ID = process.env.NISMARA_GUILD_ID || "863959415702028318";
const SYSTEM_MANAGER_ID = "NISMARA_TRACKER_SYSTEM";
const CANCEL_PENALTY_POINTS = 5;

function mapGameName(gameId) {
  const g = String(gameId || "").toLowerCase();
  if (g === "2" || g === "ats" || g === "amtrucks" || g.includes("american")) {
    return "American Truck Simulator";
  }
  return "Euro Truck Simulator 2";
}

function normalizeGameId(gameId) {
  const g = String(gameId || "").toLowerCase();
  if (g === "2" || g === "ats" || g === "amtrucks" || g.includes("american")) {
    return "2";
  }
  return "1";
}

/**
 * Classifies trip speed into Real Miles, Race Miles, or Invalid Stats
 * ETS2: Real Miles <= 100 km/h, Race Miles 101 - 180 km/h, Invalid > 180 km/h
 * ATS: Real Miles <= 80 mph (~128.75 km/h), Race Miles 81 - 130 mph (~209.2 km/h), Invalid > 130 mph (~209.2 km/h)
 */
export function getSpeedCategory(maxSpeedKmh, gameId) {
  const isAts = String(gameId) === "2" || String(gameId).toLowerCase() === "ats" || String(gameId).toLowerCase() === "amtrucks";
  if (isAts) {
    const speedMph = maxSpeedKmh / 1.609344;
    if (speedMph > 130.0 || maxSpeedKmh > 209.2) {
      return "Invalid Stats";
    }
    if (speedMph > 80.0 || maxSpeedKmh > 128.75) {
      return "Race Miles";
    }
    return "Real Miles";
  } else {
    if (maxSpeedKmh > 180.0) {
      return "Invalid Stats";
    }
    if (maxSpeedKmh > 100.0) {
      return "Race Miles";
    }
    return "Real Miles";
  }
}

function normalizeGameMode(serverMode) {
  const s = String(serverMode || "sp").toLowerCase();
  if (s.includes("truckersmp") || s === "tmp") return "truckersmp";
  if (s.includes("haulmp")) return "haulmp";
  return "sp";
}

function formatMarketType(rawMarket) {
  if (!rawMarket || typeof rawMarket !== "string") return "Freight Market";
  const low = rawMarket.toLowerCase();
  if (low === "quick_job" || low === "quick job") return "Quick Job";
  if (low === "freight_market" || low === "freight market") return "Freight Market";
  if (low === "cargo_market" || low === "cargo market") return "Cargo Market";
  if (low === "external_contracts" || low === "external contracts") return "External Contracts";
  if (low === "external_market" || low === "external market") return "External Market";
  return rawMarket
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function formatOffenceName(offence) {
  if (!offence || typeof offence !== "string") return "Tidak diketahui";
  const map = {
    red_signal: "Melanggar lampu merah",
    no_lights: "Lampu tidak dinyalakan",
    speeding: "Melampaui batas kecepatan",
    parking: "Parkir tidak benar",
    overload: "Kelebihan muatan",
    overtaking: "Menyalip sembarangan",
    fatigue: "Mengemudi dalam keadaan lelah",
    crash: "Kecelakaan lalu lintas",
    late_delivery: "Pengiriman terlambat",
    toll_violation: "Pelanggaran tol",
    police_fine: "Ditilang polisi",
    wrong_way: "Salah lajur jalan",
  };
  if (map[offence]) return map[offence];
  return offence
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function calcVehiclePenaltySp(dmg) {
  if (dmg < 11) return 0;
  return 1 + Math.floor((dmg - 10) / 5);
}

function calcTrailerPenaltySp(dmg) {
  if (dmg < 8) return 0;
  return 1 + Math.floor((dmg - 7) / 7);
}

function calcCargoPenaltySp(dmg) {
  if (dmg < 6) return 0;
  return 1 + Math.floor((dmg - 5) / 5);
}

function calcTmpMpPenalty(dmg, step) {
  if (dmg < step) return 0;
  return Math.floor(dmg / step);
}

function calcDistancePenalty(distanceKm) {
  if (distanceKm < 151) return 1;
  return 0;
}

function calcSpeedPenalty(statsType) {
  if (statsType === "Invalid Stats" || statsType === "invalid_stats") return 5;
  if (statsType === "Race Miles" || statsType === "race_miles") return 2;
  return 0;
}

/**
 * Hardcore Mode Simulation Evaluator, Hardcore Points (HP) & 5-Star Delivery Rating
 */
function evaluateHardcore(payload, driverJob, km, massTons, fuelUsedL, vehicleDmg, trailerDmg, cargoDmg, statsType, durationSec, finesCount, isRepetitiveRoute) {
  const isLate = Boolean(payload.isLate);
  const autoParkUsed = Boolean(payload.autoParkUsed);
  const warpDetected = Boolean(payload.warpDetected);
  const hasForbiddenMods = Boolean(payload.hasForbiddenMods);
  const restOverdueMin = Number(payload.restOverdueMinutes || 0);
  const speedingSec = Number(payload.speedingSeconds || 0);
  const hcSettings = payload.hardcoreSettings || {};

  // Check 9 mandatory profile settings at finish
  const settingsValidAtFinish = Boolean(
    hcSettings.trafficOk &&
    hcSettings.fatigueOk &&
    hcSettings.policeOk &&
    hcSettings.parkingOk &&
    hcSettings.roadEventsOk &&
    hcSettings.rainProbOk &&
    hcSettings.advancedCouplingOk &&
    hcSettings.fuelSimOk &&
    hcSettings.airBrakeOk
  );

  const reasons = [];

  // 1. Initial State Check (Must have been eligible when job started)
  if (driverJob && driverJob.isHardcoreEligibleAtStart === false) {
    reasons.push(driverJob.hardcoreDisqualifyReason || "Not Eligible for Hardcore at Job Start (Settings Incomplete or Mod Active)");
  }

  // 2. Mid-trip Disqualification / Tampering Check (Client latched flag)
  if (Boolean(payload.hardcoreDisqualifiedDuringTrip)) {
    reasons.push(payload.hardcoreMidTripReason || "Hardcore Disqualified During Trip (Settings Tampered or Violation)");
  } else if (driverJob && driverJob.hardcoreDisqualified) {
    reasons.push(driverJob.hardcoreDisqualifyReason || "Hardcore Disqualified During Trip");
  }

  // 3. Finish State & Rules Check
  if (hasForbiddenMods) reasons.push("Forbidden Mod Detected");
  if (!settingsValidAtFinish) reasons.push("Game Profile Settings Incomplete at Finish (9 Required)");
  if (autoParkUsed) reasons.push("Auto Park / Auto Load Used");
  if (warpDetected) reasons.push("Warping / Speedhack Detected");
  if (km < 250) reasons.push("Distance < 250 km");
  if (massTons <= 0) reasons.push("Cargo Mass is 0");
  if (fuelUsedL <= 0) reasons.push("Fuel Used is 0");
  if (statsType !== "Real Miles") {
    const isAts = String(driverJob?.gameId || payload.gameId) === "2" || String(driverJob?.game || "").includes("American");
    const speedLimitStr = isAts ? "80 mph / 129 km/h" : "100 km/h";
    reasons.push(`Speed exceeded Real Miles (${statsType} > ${speedLimitStr})`);
  }
  if (isRepetitiveRoute) reasons.push("Repetitive Route within 24h");

  const isEligible = reasons.length === 0;

  // 1. Delivery Ratings (0 to 5 Stars)
  // Distance Stars
  let distStars = 0;
  if (km >= 1250) distStars = 5;
  else if (km >= 1000) distStars = 4;
  else if (km >= 750) distStars = 3;
  else if (km >= 500) distStars = 2;
  else if (km >= 250) distStars = 1;

  // Mass Stars
  let massStars = 0;
  if (massTons >= 30) massStars = 5;
  else if (massTons >= 25) massStars = 4;
  else if (massTons >= 20) massStars = 3;
  else if (massTons >= 15) massStars = 2;
  else if (massTons >= 10) massStars = 1;

  // Damage Stars
  const maxDmgPct = Math.max(vehicleDmg, trailerDmg, cargoDmg);
  let dmgStars = 0;
  if (maxDmgPct === 0) dmgStars = 5;
  else if (maxDmgPct <= 10) dmgStars = 4;
  else if (maxDmgPct <= 20) dmgStars = 3;
  else if (maxDmgPct <= 30) dmgStars = 2;
  else if (maxDmgPct <= 40) dmgStars = 1;

  // Fuel Economy (L/100km)
  const lPer100km = km > 0 ? (fuelUsedL / km) * 100 : 38;
  const idealFuel = (payload.gameId === "2" || payload.gameId === "ats") ? 42.0 : 38.0;
  const fuelStarsRaw = 5.0 - ((lPer100km - idealFuel) / idealFuel);
  const fuelStars = Math.min(5, Math.max(0, Math.round(fuelStarsRaw)));

  // Fines Stars
  let finesStars = 0;
  if (finesCount === 0) finesStars = 5;
  else if (finesCount === 1) finesStars = 4;
  else if (finesCount === 2) finesStars = 3;
  else if (finesCount === 3) finesStars = 2;
  else if (finesCount === 4) finesStars = 1;

  // Calculate Base Rating (average of 5 categories)
  let totalStars = Math.round((distStars + massStars + dmgStars + fuelStars + finesStars) / 5.0);

  // Apply Star Penalties
  if (isLate) totalStars = Math.max(0, totalStars - 2);
  if (restOverdueMin > 30) totalStars = Math.max(0, totalStars - 2);
  if (statsType === "Race Miles" || statsType === "Invalid Stats" || !isEligible) {
    totalStars = 0;
  }

  // 2. Hardcore Point (HP) Calculation
  // 0.4 * Distance + 0.35 * Mass - 0.4 * Fuel Economy - 1 * Damage Percentage - 5 * Number of Fines
  let hp = 0;
  if (isEligible) {
    const distanceBonus = 0.4 * km;
    const massBonus = 0.35 * massTons;
    const fuelCost = 0.4 * lPer100km;
    const damageCost = 1.0 * maxDmgPct;
    const finesCost = 5.0 * finesCount;

    let baseBonus = distanceBonus + massBonus;

    // Penalties on base bonus
    if (isLate) {
      baseBonus *= 0.5; // -50%
    }
    if (restOverdueMin > 30) {
      baseBonus *= 0.5; // -50%
    }
    // Speeding penalty: allowed up to 10% of real time duration
    const allowedSpeedingSec = 0.10 * durationSec;
    if (speedingSec > allowedSpeedingSec) {
      const excessMinutes = Math.ceil((speedingSec - allowedSpeedingSec) / 60);
      const speedPenaltyPct = Math.min(1.0, excessMinutes * 0.05); // 5% per excess minute
      baseBonus *= (1.0 - speedPenaltyPct);
    }

    hp = Math.max(0, Math.round(baseBonus - fuelCost - damageCost - finesCost));
  }

  return {
    isEligible,
    disqualifyReason: reasons.join("; "),
    hardcorePoints: hp,
    deliveryRating: {
      distanceStars: distStars,
      massStars: massStars,
      damageStars: dmgStars,
      fuelStars: fuelStars,
      finesStars: finesStars,
      totalStars: totalStars,
    },
    hardcoreStats: {
      fuelEconomyL100: Math.round(lPer100km * 10) / 10,
      speedingSeconds: speedingSec,
      restOverdueMinutes: restOverdueMin,
      isLate,
      maxDamagePct: maxDmgPct,
    }
  };
}

/**
 * Helper to resolve the driver's matched Fleet document from MongoDB `fleets`
 */
async function resolveDriverFleet(db, user, fleetNumber, vehicleInGameId, gameIdStr) {
  const userFleets = await db
    .collection("fleets")
    .aggregate([
      { $match: { driver: user._id } },
      {
        $lookup: {
          from: "fleetstores",
          localField: "model",
          foreignField: "_id",
          as: "modelInfo",
        },
      },
      { $unwind: { path: "$modelInfo", preserveNullAndEmptyArrays: true } },
    ])
    .toArray();

  if (!userFleets.length) return null;

  // 1. Exact fleetNumber match if provided by NismaraTracker.dll
  if (fleetNumber) {
    const byNum = userFleets.find(
      (f) => f.fleet_number && f.fleet_number.toLowerCase() === String(fleetNumber).toLowerCase()
    );
    if (byNum) return byNum;
  }

  // 2. Match by in_game_id (prioritize status === 'active')
  if (vehicleInGameId) {
    let byId = userFleets.find(
      (f) => f.modelInfo?.in_game_id === vehicleInGameId && f.status === "active"
    );
    if (!byId) {
      byId = userFleets.find((f) => f.modelInfo?.in_game_id === vehicleInGameId);
    }
    if (byId) return byId;

    // 3. Mod Vehicle Fallback
    const isKnownStoreModel = await db
      .collection("fleetstores")
      .findOne({ in_game_id: vehicleInGameId });
    if (!isKnownStoreModel) {
      const genericId =
        gameIdStr === "2" ? "vehicle.generic.mod.ats" : "vehicle.generic.mod.ets2";
      let modFleet = userFleets.find(
        (f) => f.modelInfo?.in_game_id === genericId && f.status === "active"
      );
      if (!modFleet) {
        modFleet = userFleets.find((f) => f.modelInfo?.in_game_id === genericId);
      }
      if (modFleet) return modFleet;
    }
  }

  return null;
}

/**
 * 1. START JOB (`POST /api/tracker/jobs/start`)
 */
export async function processJobStart(db, user, payload) {
  const discordId = String(user.discordId || "");
  const truckyId = String(user.truckyId || "0");
  const gameId = normalizeGameId(payload.gameId);
  const gameName = mapGameName(gameId);
  const gameMode = normalizeGameMode(payload.gameMode);
  const marketType = formatMarketType(payload.marketType);

  const sourceCity = String(payload.sourceCity || "Unknown");
  const destinationCity = String(payload.destinationCity || "Unknown");
  const sourceCompany = String(payload.sourceCompany || "Unknown");
  const destinationCompany = String(payload.destinationCompany || "Unknown");
  const cargoId = String(payload.cargoId || "unknown_cargo");
  const cargoName = String(payload.cargoName || "Freight Cargo");
  const cargoMassTons = Math.round(Number(payload.cargoMassTons || 0));
  const plannedDistanceKm = Math.round(Number(payload.plannedDistanceKm || 0));

  const vehicleBrand = String(payload.vehicleBrand || "Unknown");
  const vehicleModel = String(payload.vehicleModel || "Truck");
  const vehicleInGameId = String(payload.vehicleInGameId || "");
  const requestedFleetNumber = String(payload.fleetNumber || "");

  // Check if driver already has an ONGOING job in this game
  const existingOngoing = await db.collection("jobhistories").findOne({
    guildId: NISMARA_GUILD_ID,
    driverId: discordId,
    gameId: gameId,
    jobStatus: "ONGOING",
  });

  if (existingOngoing) {
    // Idempotent check: if the driver reloaded a save of the EXACT same ongoing contract, return it!
    if (
      existingOngoing.sourceCity === sourceCity &&
      existingOngoing.destinationCity === destinationCity &&
      existingOngoing.cargoId === cargoId
    ) {
      return {
        resumed: true,
        jobId: String(existingOngoing.jobId),
        gameId: String(existingOngoing.gameId || gameId),
        game: existingOngoing.game || gameName,
        lockedCargoPrice: existingOngoing.lockedCargoPrice ?? 1.5,
        isSpecialContract: Boolean(existingOngoing.isSpecialContract),
        gameMode: existingOngoing.gameMode || gameMode,
        isHardcoreEligibleAtStart: existingOngoing.isHardcoreEligibleAtStart ?? true,
        hardcoreDisqualified: Boolean(existingOngoing.hardcoreDisqualified),
        hardcoreDisqualifyReason: existingOngoing.hardcoreDisqualifyReason || null,
      };
    }

    // Otherwise, driver started a NEW job without finishing the previous one -> Cancel old job + Penalty!
    await db.collection("jobhistories").updateOne(
      { _id: existingOngoing._id },
      {
        $set: {
          jobStatus: "CANCELED",
          status: "completed",
          completedAt: new Date(),
          updatedAt: new Date(),
          error: "START_NEW_JOB",
          cancelPenaltyApplied: true,
        },
      }
    );

    if (!existingOngoing.cancelPenaltyApplied) {
      await db.collection("pointhistories").insertOne({
        guildId: NISMARA_GUILD_ID,
        userId: discordId,
        points: CANCEL_PENALTY_POINTS,
        managerId: SYSTEM_MANAGER_ID,
        type: "add",
        reason: `[Job: ${existingOngoing.jobId}] Cancel Job Penalty (Started new job)`,
        createdAt: new Date(),
      });

      await db.collection("points").findOneAndUpdate(
        { guildId: NISMARA_GUILD_ID, userId: discordId },
        { $inc: { totalPoints: CANCEL_PENALTY_POINTS } },
        { upsert: true }
      );
    }
  }

  // Generate new sequential auto-increment jobId ("1", "2", "3", ...)
  const jobId = await getNextJobId();
  const gameIdNum = Number(gameId);

  // Lookup or auto-register Cargo & update market demand
  let cargo = await db.collection("cargos").findOne({
    in_game_id: cargoId,
    $or: [{ game_id: gameIdNum }, { game_id: gameId }],
  });

  if (!cargo) {
    const nextCargoId = String(Date.now());
    const newCargoDoc = {
      id: nextCargoId,
      name: cargoName,
      in_game_id: cargoId,
      game_id: gameIdNum,
      mass: cargoMassTons * 1000,
      volume: 1,
      price_per_km: 1.5,
      price_per_km_with_market_change: 1.5,
      market_demand: 0,
      job_count: 1,
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const insertRes = await db.collection("cargos").insertOne(newCargoDoc);
    cargo = { ...newCargoDoc, _id: insertRes.insertedId };
  }

  const lockedCargoPrice =
    cargo.price_per_km_with_market_change ?? cargo.price_per_km ?? 1.5;

  // Update cargo market demand (-5 per job started, down to -50)
  const oldDemand = cargo.market_demand || 0;
  const newDemand = Math.max(-50, oldDemand - 5);
  const basePrice = cargo.price_per_km || 1.5;
  const newPriceWithMarket =
    Math.round((basePrice + basePrice * (newDemand / 100)) * 100) / 100;

  if (oldDemand !== newDemand || lockedCargoPrice !== newPriceWithMarket) {
    await db.collection("cargomarkethistories").insertOne({
      cargo_id: cargo._id,
      in_game_id: cargo.in_game_id,
      old_market_demand: oldDemand,
      new_market_demand: newDemand,
      old_price: lockedCargoPrice,
      new_price: newPriceWithMarket,
      timestamp: new Date(),
    });
  }

  await db.collection("cargos").updateOne(
    { _id: cargo._id },
    {
      $inc: { job_count: 1 },
      $set: {
        market_demand: newDemand,
        price_per_km_with_market_change: newPriceWithMarket,
        updatedAt: new Date(),
      },
    }
  );

  // Check Special Contract
  let isSpecialContract = false;
  const activeContract = await db.collection("contracts").findOne({
    guildId: NISMARA_GUILD_ID,
    gameId: gameId,
    isActive: true,
  });

  if (activeContract && activeContract.companyName) {
    const targetCompany = activeContract.companyName.toLowerCase();
    if (
      sourceCompany.toLowerCase() === targetCompany ||
      destinationCompany.toLowerCase() === targetCompany
    ) {
      isSpecialContract = true;
    }
  }

  // Resolve Fleet Data at job start
  const matchedFleet = await resolveDriverFleet(
    db,
    user,
    requestedFleetNumber,
    vehicleInGameId,
    gameId
  );

  const fleetDataObj = matchedFleet
    ? {
        fleet_id: matchedFleet._id,
        fleet_number: matchedFleet.fleet_number || null,
        fleet_name: matchedFleet.modelInfo?.name || matchedFleet.fleet_name || null,
        in_game_id: matchedFleet.modelInfo?.in_game_id || vehicleInGameId || null,
      }
    : {
        fleet_id: null,
        fleet_number: null,
        fleet_name: null,
        in_game_id: null,
      };

  const now = new Date();
  // Validate Hardcore Simulation Eligibility at Job Start
  const hcSettings = payload.hardcoreSettings || {};
  const hasForbiddenMods = Boolean(payload.hasForbiddenMods);
  const settingsValidAtStart = Boolean(
    hcSettings.trafficOk &&
    hcSettings.fatigueOk &&
    hcSettings.policeOk &&
    hcSettings.parkingOk &&
    hcSettings.roadEventsOk &&
    hcSettings.rainProbOk &&
    hcSettings.advancedCouplingOk &&
    hcSettings.fuelSimOk &&
    hcSettings.airBrakeOk
  );

  const startDisqualifyReasons = [];
  if (hasForbiddenMods) startDisqualifyReasons.push("Forbidden Mod Detected at Job Start");
  if (!settingsValidAtStart) startDisqualifyReasons.push("Game Profile Settings Incomplete at Job Start (9 Required)");

  const isHardcoreEligibleAtStart = startDisqualifyReasons.length === 0;

  const newJobDoc = {
    guildId: NISMARA_GUILD_ID,
    jobId: jobId,
    driverId: discordId,
    truckyId: truckyId,
    gameId: gameId,
    status: "ongoing",
    jobStatus: "ONGOING",
    game: gameName,
    gameMode: gameMode,
    marketType: marketType,
    sourceCity: sourceCity,
    destinationCity: destinationCity,
    sourceCompany: sourceCompany,
    destinationCompany: destinationCompany,
    cargoId: cargoId,
    cargoName: cargoName,
    cargoMass: cargoMassTons,
    plannedDistanceKm: plannedDistanceKm,
    startedAt: now,
    vehicle: {
      brand: vehicleBrand,
      model: vehicleModel,
    },
    fleet_data: fleetDataObj,
    vehicleId: matchedFleet ? String(matchedFleet.id || matchedFleet._id) : null,
    vehicleRentCost: 0,
    rentPricePerKm: 0,
    marketFuelPricePerL: 0,
    isHardcore: false,
    hardcoreRating: 0,
    isHardcoreEligibleAtStart: isHardcoreEligibleAtStart,
    hardcoreDisqualified: !isHardcoreEligibleAtStart,
    hardcoreDisqualifyReason: isHardcoreEligibleAtStart ? null : startDisqualifyReasons.join("; "),
    hardcoreSettingsAtStart: hcSettings,
    hasForbiddenModsAtStart: hasForbiddenMods,
    discount: {
      nismaraplus: 0,
      insurance: 0,
      total: 0,
    },
    maintenance_penalty: 0,
    isSpecialContract: isSpecialContract,
    cancelPenaltyApplied: false,
    fines_events: [],
    lockedCargoPrice: lockedCargoPrice,
    createdAt: now,
    updatedAt: now,
    __v: 0,
  };

  await db.collection("jobhistories").insertOne(newJobDoc);

  console.log(
    `[Job Start] Job #${jobId} started by ${user.name} (${discordId}) | ${sourceCity} -> ${destinationCity} | Mode: ${gameMode} | Fleet: ${fleetDataObj.fleet_number || "Rental/None"} | Hardcore at Start: ${isHardcoreEligibleAtStart ? "YES" : "NO (" + startDisqualifyReasons.join("; ") + ")"}`
  );

  return {
    resumed: false,
    jobId: jobId,
    gameId: gameId,
    game: gameName,
    lockedCargoPrice: lockedCargoPrice,
    isSpecialContract: isSpecialContract,
    gameMode: gameMode,
    fleetNumber: fleetDataObj.fleet_number,
    isHardcoreEligibleAtStart: isHardcoreEligibleAtStart,
    hardcoreDisqualifyReason: isHardcoreEligibleAtStart ? null : startDisqualifyReasons.join("; "),
  };
}

/**
 * 2. COMPLETE JOB (`POST /api/tracker/jobs/complete`)
 */
export async function processJobComplete(db, user, payload) {
  const discordId = String(user.discordId || "");
  const truckyId = String(user.truckyId || "0");
  const gameId = normalizeGameId(payload.gameId);
  const reqJobId = payload.jobId ? String(payload.jobId) : "";

  // Find target ONGOING job (by jobId if known, else latest ONGOING job for this driver + gameId)
  const filter = {
    guildId: NISMARA_GUILD_ID,
    driverId: discordId,
    gameId: gameId,
    jobStatus: "ONGOING",
  };
  if (reqJobId) {
    filter.jobId = reqJobId;
  }

  const lockId = `tracker-${process.pid}-${Date.now()}`;
  const now = new Date();
  const lockExpiry = new Date(Date.now() - 5 * 60 * 1000);

  const jobLockResult = await db.collection("jobhistories").findOneAndUpdate(
    {
      ...filter,
      $or: [
        { status: "ongoing" },
        { status: "failed" },
        { status: "processing", lockedAt: { $lt: lockExpiry } },
      ],
    },
    {
      $set: {
        status: "processing",
        lockId: lockId,
        lockedAt: now,
      },
    },
    { returnDocument: "after", sort: { createdAt: -1 } }
  );

  const driverJob = jobLockResult?.value || jobLockResult;
  if (!driverJob || driverJob.lockId !== lockId) {
    throw new Error("No active ONGOING job found or job is already being processed.");
  }

  const jobId = String(driverJob.jobId);
  const gameMode = normalizeGameMode(
    payload.gameMode || driverJob.gameMode || "sp"
  );
  const isMultiplayer = gameMode === "truckersmp" || gameMode === "haulmp";

  const rawDrivenKm = Math.max(
    1,
    Math.round(Number(payload.distanceKm || driverJob.plannedDistanceKm || 1))
  );
  const plannedKm = Math.max(
    0,
    Math.round(Number(driverJob.plannedDistanceKm || payload.plannedDistanceKm || 0))
  );
  const distanceCapMultiplier = Number(process.env.DISTANCE_CAP_MULTIPLIER || 1.25);
  const maxAllowedKm = plannedKm > 0 ? Math.max(1, Math.round(plannedKm * distanceCapMultiplier)) : rawDrivenKm;
  const km = plannedKm > 0 ? Math.min(rawDrivenKm, maxAllowedKm) : rawDrivenKm;
  const durationSeconds = Math.max(
    1,
    Math.round(Number(payload.durationSeconds || 0))
  );
  const fuelUsedL = Math.max(0, Number(payload.fuelUsedL || 0));
  const maxSpeedKmh = Number(payload.maxSpeedKmh || 0);

  // Damage percentages (0 - 100)
  const vehicleDmg = Math.max(0, Math.round(Number(payload.vehicleDamagePct || 0)));
  const trailerDmg = Math.max(0, Math.round(Number(payload.trailerDamagePct || 0)));
  const cargoDmg = Math.max(0, Math.round(Number(payload.cargoDamagePct || 0)));

  // Estimated repair costs for service calculation (matching Trucky scale)
  const rawVehicleDmgCost = Number(payload.vehicleDamageCost ?? vehicleDmg * 250);
  const rawTrailerDmgCost = Number(payload.trailerDamageCost ?? trailerDmg * 180);
  const rawCargoDmgCost = Number(payload.cargoDamageCost ?? cargoDmg * 300);

  const cost = { rent: 0, service: 0, fuel: 0, fines: 0, total: 0 };
  const discount = { nismaraplus: 0, insurance: 0, total: 0 };
  const reward = {
    base: 0,
    special: 0,
    hardcore: 0,
    event: 0,
    userBoost: 0,
    booster: 0,
    nismaraplus: 0,
    truckersmp: 0,
    haulmp: 0,
    total: 0,
  };
  const xp = {
    base: 0,
    special: 0,
    hardcore: 0,
    event: 0,
    booster: 0,
    nismaraplus: 0,
    total: 0,
  };
  const penalty = {
    vehicle: 0,
    trailer: 0,
    cargo: 0,
    speed: 0,
    distance: 0,
    total: 0,
  };

  // =========================================================================
  // 1. EXPENSE CALCULATOR (Service, Discounts, Fleet Wear/Rent, Fuel, Fines)
  // =========================================================================
  const dmgDivisor = isMultiplayer ? 10 : 2;
  const cargoDamageCost = Math.round(rawCargoDmgCost / dmgDivisor) || 0;
  const vehicleDamageCost = Math.round(rawVehicleDmgCost / dmgDivisor) || 0;
  const trailerDamageCost = Math.round(rawTrailerDmgCost / dmgDivisor) || 0;
  cost.service = Math.round(cargoDamageCost + vehicleDamageCost + trailerDamageCost);

  const hasNismaraPlus = Boolean(
    user.nismaraplus?.status &&
      user.nismaraplus?.expiredAt &&
      new Date(user.nismaraplus.expiredAt) > now
  );
  const hasInsurance = Boolean(
    user.insurance?.status &&
      user.insurance?.expiredAt &&
      new Date(user.insurance.expiredAt) > now
  );

  if (hasNismaraPlus) {
    discount.nismaraplus = Math.round(cost.service * 0.3);
  }
  if (hasInsurance) {
    discount.insurance = Math.round(cost.service * 0.3);
  }
  discount.total = Math.round(discount.nismaraplus + discount.insurance);

  if (discount.insurance > 0) {
    await db.collection("insuranceclaimhistories").insertOne({
      guildId: NISMARA_GUILD_ID,
      discordId,
      truckyId,
      jobId,
      realCost: cost.service,
      claimAmount: discount.insurance,
      claimReason: "Insurance Damage Cost",
      createdAt: now,
    });
  }

  // Fleet / Vehicle Rent & Wear Update
  const usedFleet = await resolveDriverFleet(
    db,
    user,
    payload.fleetNumber || driverJob.fleet_data?.fleet_number || "",
    payload.vehicleInGameId || driverJob.fleet_data?.in_game_id || "",
    gameId
  );

  let vehicleStatus = "Rental";
  let rentPricePerKm = 0;
  let isFleetMaintenancePenalty = false;
  let fleetDataObj = driverJob.fleet_data || {
    fleet_id: null,
    fleet_number: null,
    fleet_name: null,
    in_game_id: null,
  };

  if (usedFleet) {
    vehicleStatus = "Owned";
    fleetDataObj = {
      fleet_id: usedFleet._id,
      fleet_number: usedFleet.fleet_number,
      fleet_name: usedFleet.modelInfo?.name || usedFleet.fleet_name,
      in_game_id: usedFleet.modelInfo?.in_game_id || payload.vehicleInGameId || null,
    };

    if (["need_maintenance", "onservice"].includes(usedFleet.status)) {
      isFleetMaintenancePenalty = true;
      rentPricePerKm = 0.5;
      cost.rent = Math.round(km * rentPricePerKm);
    } else if (usedFleet.status === "active") {
      const newOdo = (usedFleet.odometer || 0) + km;
      const newWearEngine = Math.min(
        100,
        (usedFleet.wear?.unfix_engine || 0) + (km / 500) * 0.1
      );
      const newWearTires = Math.min(
        100,
        (usedFleet.wear?.unfix_tires || 0) + (km / 200) * 0.1
      );
      const newWearTrans = Math.min(
        100,
        (usedFleet.wear?.unfix_transmission || 0) + (km / 800) * 0.1
      );
      const newWearBrakes = Math.min(
        100,
        (usedFleet.wear?.unfix_brakes || 0) + (km / 300) * 0.1
      );

      const lastMaint = usedFleet.last_maintenance || {
        engine: 0,
        tires: 0,
        transmission: 0,
        brakes: 0,
      };
      const maintTargets = usedFleet.maintenance || {
        engine: 50000,
        tires: 20000,
        transmission: 70000,
        brakes: 35000,
      };

      const needsMaint =
        newOdo - (lastMaint.engine || 0) >= maintTargets.engine ||
        newOdo - (lastMaint.tires || 0) >= maintTargets.tires ||
        newOdo - (lastMaint.transmission || 0) >= maintTargets.transmission ||
        newOdo - (lastMaint.brakes || 0) >= maintTargets.brakes;

      await db.collection("fleets").updateOne(
        { _id: usedFleet._id },
        {
          $set: {
            odometer: newOdo,
            "wear.unfix_engine": newWearEngine,
            "wear.unfix_tires": newWearTires,
            "wear.unfix_transmission": newWearTrans,
            "wear.unfix_brakes": newWearBrakes,
            status: needsMaint ? "need_maintenance" : usedFleet.status,
            maintenance_needed: needsMaint,
            updatedAt: now,
          },
        }
      );
    }
  } else if (driverJob.marketType === "Quick Job") {
    vehicleStatus = "Rental";
    rentPricePerKm = 0.3;
    cost.rent = Math.round(km * rentPricePerKm);
  } else {
    vehicleStatus = "Company";
    rentPricePerKm = 0.2;
    cost.rent = Math.round(km * rentPricePerKm);
  }

  // Fuel Cost (Deduct from Garage first, buy remainder from Market)
  let marketFuelPricePerL = 0;
  if (fuelUsedL > 0) {
    const latestFuelPrice = await db
      .collection("fuelprices")
      .findOne({}, { sort: { timestamp: -1 } });
    marketFuelPricePerL = latestFuelPrice?.price ?? 1.0;

    let fuelRemainingNeeded = Math.round(fuelUsedL);
    const userGarage = await db.collection("garages").findOne({
      $or: [{ discordId }, { userId: user._id }],
    });

    if (userGarage && (userGarage.fuelStock || 0) > 0) {
      const fuelFromGarage = Math.min(fuelRemainingNeeded, userGarage.fuelStock);
      await db.collection("garages").updateOne(
        { _id: userGarage._id },
        { $inc: { fuelStock: -fuelFromGarage } }
      );
      fuelRemainingNeeded -= fuelFromGarage;

      await db.collection("fuelusagehistories").insertOne({
        discordId,
        jobId,
        source: driverJob.sourceCity,
        destination: driverJob.destinationCity,
        fuelConsumed: fuelFromGarage,
        createdAt: now,
      });
    }

    cost.fuel = Math.round(fuelRemainingNeeded * marketFuelPricePerL);
  }

  // Traffic Fines Cost (`amount / 2`)
  const finesEvents = [];
  if (Array.isArray(payload.fines) && payload.fines.length > 0) {
    const finesMap = {};
    for (const fine of payload.fines) {
      const offKey = String(fine.offence || "police_fine");
      const adjAmt = Math.round(Number(fine.amount || 0) / 2);
      if (adjAmt > 0) {
        finesMap[offKey] = (finesMap[offKey] || 0) + adjAmt;
        cost.fines += adjAmt;
      }
    }
    for (const [offKey, amt] of Object.entries(finesMap)) {
      finesEvents.push({
        offenceName: formatOffenceName(offKey),
        amount: amt,
      });
    }
  }

  cost.total = Math.max(
    0,
    Math.round(cost.rent + cost.service + cost.fuel + cost.fines - discount.total)
  );

  // =========================================================================
  // 2. SPEED CLASSIFICATION & HARDCORE SIMULATION EVALUATION
  // =========================================================================
  const statsType = getSpeedCategory(maxSpeedKmh, gameId);

  // Anti-Repetitive Route check (same driver, same source & destination in last 24 hours)
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentJobSameRoute = await db.collection("jobhistories").findOne({
    driverId: discordId,
    sourceCity: driverJob.sourceCity,
    destinationCity: driverJob.destinationCity,
    status: "completed",
    completedAt: { $gte: twentyFourHoursAgo },
  });
  const isRepetitiveRoute = Boolean(recentJobSameRoute);

  const massTons = Number(driverJob.cargoMass || payload.cargoMassTons || 0);
  const finesCount = finesEvents.length;
  const hcEval = evaluateHardcore(
    payload,
    driverJob,
    km,
    massTons,
    fuelUsedL,
    vehicleDmg,
    trailerDmg,
    cargoDmg,
    statsType,
    durationSeconds,
    finesCount,
    isRepetitiveRoute
  );

  // =========================================================================
  // REWARD CALCULATOR (NC & Taxes)
  // =========================================================================
  const cargoPrice = Number(driverJob.lockedCargoPrice || 1.5);
  const cargoRevenue = Math.round(km * cargoPrice);
  const rewardKm = Math.round(km * 0.2);
  const rewardJob = Math.round(rewardKm + cargoRevenue);

  const isSpecialContract = Boolean(driverJob.isSpecialContract);
  if (isSpecialContract) {
    reward.special = Math.round(rewardJob * 2);
    await db.collection("specialcontracthistories").insertOne({
      guildId: NISMARA_GUILD_ID,
      driverId: discordId,
      jobId,
      gameId,
      destination: driverJob.destinationCompany,
      source: driverJob.sourceCompany,
      distanceKm: km,
      ncEarned: reward.special,
      revenue: Number(payload.inGameRevenue || 0),
      cargoName: driverJob.cargoName,
      cargoMass: driverJob.cargoMass,
      rating: 5,
      completedAt: now,
    });
  } else {
    reward.base = Math.round(rewardJob);
  }

  // Hardcore Bonus calculation
  const isHardcore = hcEval.isEligible;
  const hardcoreRating = hcEval.deliveryRating.totalStars;
  if (isHardcore) {
    let bonusMult = 0.2;
    if (hardcoreRating >= 5) bonusMult = 1.0;
    else if (hardcoreRating >= 4) bonusMult = 0.75;
    else if (hardcoreRating >= 3) bonusMult = 0.5;
    else if (hardcoreRating >= 2) bonusMult = 0.25;
    reward.hardcore = Math.round(rewardJob * bonusMult);
  }

  // Active NC Event Multiplier
  const activeEvent = await db.collection("ncevents").findOne({
    guildId: NISMARA_GUILD_ID,
    isActive: true,
    endAt: { $gt: now },
  });

  let isActiveEvent = false;
  if (activeEvent) {
    let eligible = true;
    if (activeEvent.gameId !== "all" && String(activeEvent.gameId) !== gameId) {
      eligible = false;
    }
    if (eligible && activeEvent.type !== "all") {
      if (activeEvent.type === "TruckersMP" && gameMode !== "truckersmp") {
        eligible = false;
      } else if (activeEvent.type === "HaulMP" && gameMode !== "haulmp") {
        eligible = false;
      } else if (activeEvent.type === "Singleplayer" && gameMode !== "sp") {
        eligible = false;
      }
    }

    if (eligible) {
      isActiveEvent = true;
      reward.event = Math.round(rewardJob * Number(activeEvent.multiplier || 0));
      await db.collection("ncevents").updateOne(
        { _id: activeEvent._id },
        {
          $push: {
            participants: {
              discordId,
              totalEarned: reward.event,
            },
          },
        }
      );
    }
  }

  // Individual User NC Boost Voucher
  let userBoostMultiplier = 0;
  if (
    user.ncBoost?.active &&
    user.ncBoost?.expiredAt &&
    new Date(user.ncBoost.expiredAt) > now
  ) {
    userBoostMultiplier = Number(user.ncBoost.multiplier || 0);
    if (userBoostMultiplier > 0) {
      reward.userBoost = Math.round(rewardJob * userBoostMultiplier);
    }
  }

  // Distance Tier Bonus for Booster & Nismara+
  let distTierBonus = 0;
  if (km > 5000) distTierBonus = 600;
  else if (km > 4000) distTierBonus = 500;
  else if (km > 3000) distTierBonus = 400;
  else if (km > 2000) distTierBonus = 300;
  else if (km > 1000) distTierBonus = 200;
  else if (km > 150) distTierBonus = 100;

  if (user.isBooster) {
    reward.booster = Math.round(rewardJob * 0.3 + distTierBonus);
  }
  if (hasNismaraPlus) {
    reward.nismaraplus = Math.round(rewardJob * 0.3 + distTierBonus);
  }

  // TruckersMP & HaulMP Server Bonuses
  if (user.isTmpDriver && gameMode === "truckersmp") {
    const tmpMult =
      vehicleDmg < 11 && trailerDmg < 8 && cargoDmg < 6 ? 1.0 : 0.5;
    reward.truckersmp = Math.round(rewardJob * tmpMult);
  }
  if (user.isHaulmpDriver && gameMode === "haulmp") {
    const haulMult =
      vehicleDmg < 11 && trailerDmg < 8 && cargoDmg < 6 ? 1.0 : 0.5;
    reward.haulmp = Math.round(rewardJob * haulMult);
  }

  // Subtotal & Progressive Tax
  const subTotal = Math.round(
    reward.base +
      reward.special +
      reward.hardcore +
      reward.event +
      reward.userBoost +
      reward.truckersmp +
      reward.haulmp
  );

  let taxRate = 0.05;
  if (subTotal >= 30000) taxRate = 0.2;
  else if (subTotal >= 20000) taxRate = 0.15;
  else if (subTotal >= 10000) taxRate = 0.1;
  else if (subTotal >= 5000) taxRate = 0.07;

  const taxAmount = Math.round(subTotal * taxRate);
  const afterTax = subTotal - taxAmount;

  reward.total = Math.round(afterTax + reward.booster + reward.nismaraplus);

  let maintenancePenaltyAmount = 0;
  if (isFleetMaintenancePenalty) {
    maintenancePenaltyAmount = Math.round(reward.total * 0.5);
    reward.total -= maintenancePenaltyAmount;
  }

  const rewardTotal = Math.round(reward.total - cost.total);

  // =========================================================================
  // 3. PENALTY & XP CALCULATOR
  // =========================================================================
  xp.base = Math.round(km * 0.5);
  xp.hardcore = reward.hardcore > 0 ? Math.round(km * 0.5) : 0;
  xp.special = isSpecialContract ? Math.round(km * 0.3) : 0;
  xp.event = isActiveEvent ? Math.round(km * 0.2) : 0;
  xp.booster = user.isBooster ? Math.round(km * 0.2) : 0;
  xp.nismaraplus = hasNismaraPlus ? Math.round(km * 0.2) : 0;
  xp.total =
    xp.base +
    xp.hardcore +
    xp.special +
    xp.event +
    xp.booster +
    xp.nismaraplus;

  penalty.distance = calcDistancePenalty(km);
  penalty.speed = calcSpeedPenalty(statsType);

  if (isMultiplayer) {
    penalty.vehicle = calcTmpMpPenalty(vehicleDmg, 21);
    penalty.trailer = calcTmpMpPenalty(trailerDmg, 15);
    penalty.cargo = calcTmpMpPenalty(cargoDmg, 11);
  } else {
    penalty.vehicle = calcVehiclePenaltySp(vehicleDmg);
    penalty.trailer = calcTrailerPenaltySp(trailerDmg);
    penalty.cargo = calcCargoPenaltySp(cargoDmg);
  }

  penalty.total =
    penalty.vehicle +
    penalty.trailer +
    penalty.cargo +
    penalty.speed +
    penalty.distance;

  if (penalty.total > 0) {
    await db.collection("pointhistories").insertOne({
      guildId: NISMARA_GUILD_ID,
      userId: discordId,
      points: penalty.total,
      managerId: SYSTEM_MANAGER_ID,
      type: "add",
      reason: `[Job: ${jobId}] Penalty`,
      createdAt: now,
    });

    await db.collection("points").findOneAndUpdate(
      { guildId: NISMARA_GUILD_ID, userId: discordId },
      { $inc: { totalPoints: penalty.total } },
      { upsert: true }
    );
  }

  // =========================================================================
  // 4. DATABASE UPDATER (Currency, CurrencyHistory, JobHistory, Contracts, User XP)
  // =========================================================================
  const updatedCurrencyRes = await db.collection("currencies").findOneAndUpdate(
    { guildId: NISMARA_GUILD_ID, userId: discordId },
    { $inc: { totalNC: rewardTotal } },
    { upsert: true, returnDocument: "after" }
  );
  const newCurrencyDoc = updatedCurrencyRes?.value || updatedCurrencyRes;
  const newTotalNC = newCurrencyDoc?.totalNC ?? 0;

  const historyRecords = [];
  const pushHistory = (amount, type, reason) => {
    if (amount > 0) {
      historyRecords.push({
        guildId: NISMARA_GUILD_ID,
        userId: discordId,
        amount,
        managerId: SYSTEM_MANAGER_ID,
        type,
        reason,
        createdAt: now,
      });
    }
  };

  pushHistory(
    isSpecialContract ? reward.special : reward.base,
    "earn",
    isSpecialContract ? `Special Contract Job #${jobId}` : `Standard Job #${jobId}`
  );
  pushHistory(reward.hardcore, "earn", `Hardcore mode bonus - Job #${jobId}`);
  pushHistory(reward.event, "earn", `NC Boost Event bonus - Job #${jobId}`);
  pushHistory(
    reward.userBoost,
    "earn",
    `Personal NC Boost bonus (x${userBoostMultiplier}) - Job #${jobId}`
  );
  pushHistory(reward.booster, "earn", `Server Booster bonus - Job #${jobId}`);
  pushHistory(reward.nismaraplus, "earn", `Nismara Plus bonus - Job #${jobId}`);
  pushHistory(reward.truckersmp, "earn", `TruckersMP bonus - Job #${jobId}`);
  pushHistory(reward.haulmp, "earn", `HaulMP bonus - Job #${jobId}`);
  pushHistory(cost.rent, "spend", `Vehicle Rental Cost - Job #${jobId}`);
  pushHistory(cost.service, "spend", `Vehicle Service Cost - Job #${jobId}`);
  pushHistory(cost.fuel, "spend", `Fuel Cost - Job #${jobId}`);
  pushHistory(cost.fines, "spend", `Traffic Fines Cost - Job #${jobId}`);
  pushHistory(
    maintenancePenaltyAmount,
    "spend",
    `Vehicle Maintenance Penalty - Job #${jobId}`
  );
  pushHistory(
    taxAmount,
    "spend",
    `Income Tax (${(taxRate * 100).toFixed(0)}%) - Job #${jobId}`
  );

  if (historyRecords.length > 0) {
    await db.collection("currencyhistories").insertMany(historyRecords);
  }

  // Finalize `jobhistories` document
  await db.collection("jobhistories").updateOne(
    { _id: driverJob._id },
    {
      $set: {
        gameId: gameId,
        game: gameName,
        gameMode: gameMode,
        statsType: statsType,
        jobStatus: "COMPLETED",
        status: "completed",
        distanceKm: km,
        durationSeconds: durationSeconds,
        revenue: rewardTotal,
        isHardcore: hcEval.isEligible,
        hardcoreRating: hcEval.deliveryRating.totalStars,
        hardcorePoints: hcEval.hardcorePoints,
        isHardcoreEligibleAtStart: driverJob.isHardcoreEligibleAtStart ?? true,
        hardcoreDisqualifiedDuringTrip: Boolean(payload.hardcoreDisqualifiedDuringTrip),
        deliveryRating: hcEval.deliveryRating,
        hardcoreDisqualifyReason: hcEval.disqualifyReason,
        hardcoreStats: hcEval.hardcoreStats,
        damage: {
          vehicle: vehicleDmg,
          trailer: trailerDmg,
          cargo: cargoDmg,
        },
        vehicleStatus: vehicleStatus,
        fleet_data: fleetDataObj,
        rentPricePerKm: rentPricePerKm,
        marketFuelPricePerL: marketFuelPricePerL,
        nc: reward,
        ncCost: cost,
        tax: {
          rate: taxRate,
          amount: taxAmount,
        },
        fines_events: finesEvents,
        discount: discount,
        xp: xp,
        maintenance_penalty: maintenancePenaltyAmount,
        penalty: penalty,
        completedAt: now,
        updatedAt: now,
      },
      $unset: { lockId: "", lockedAt: "" },
    }
  );

  // Update Special Contract progress if applicable
  if (isSpecialContract) {
    const upd = await db.collection("contracts").updateOne(
      { guildId: NISMARA_GUILD_ID, gameId: gameId, isActive: true },
      {
        $inc: {
          completedContracts: 1,
          totalNCEarned: reward.total,
          totalDistance: km,
          totalMass: driverJob.cargoMass || 0,
        },
      }
    );
    if (upd.matchedCount > 0) {
      const contribUpd = await db.collection("contracts").updateOne(
        {
          guildId: NISMARA_GUILD_ID,
          gameId: gameId,
          isActive: true,
          "contributors.driverId": discordId,
        },
        {
          $inc: {
            "contributors.$.jobs": 1,
            "contributors.$.totalNC": reward.total,
            "contributors.$.totalDistance": km,
            "contributors.$.totalMass": driverJob.cargoMass || 0,
          },
        }
      );
      if (contribUpd.modifiedCount === 0) {
        await db.collection("contracts").updateOne(
          { guildId: NISMARA_GUILD_ID, gameId: gameId, isActive: true },
          {
            $push: {
              contributors: {
                driverId: discordId,
                jobs: 1,
                totalNC: reward.total,
                totalDistance: km,
                totalMass: driverJob.cargoMass || 0,
              },
            },
          }
        );
      }
    }
  }

  // Update User XP, Level, and Hardcore Points
  const newUserXp = (user.xp || 0) + xp.total;
  const newUserLevel = Math.floor(Math.sqrt(newUserXp / 500)) + 1;
  const newHardcorePoints = (user.hardcorePoints || 0) + hcEval.hardcorePoints;
  await db.collection("users").updateOne(
    { _id: user._id },
    {
      $set: {
        xp: newUserXp,
        level: newUserLevel,
        hardcorePoints: newHardcorePoints,
        updatedAt: now,
      },
    }
  );

  console.log(
    `[Job Complete] Job #${jobId} COMPLETED by ${user.name} (${discordId}) | ${km} km | Mode: ${gameMode} | Net Revenue: ${rewardTotal} NC | XP: +${xp.total} | Hardcore: ${hcEval.isEligible ? "YES (+" + hcEval.hardcorePoints + " HP)" : "NO"}`
  );

  return {
    jobId,
    gameId,
    game: gameName,
    gameMode,
    statsType,
    distanceKm: km,
    durationSeconds,
    revenue: rewardTotal,
    newTotalNC,
    newLevel: newUserLevel,
    nc: reward,
    ncCost: cost,
    discount,
    tax: { rate: taxRate, amount: taxAmount },
    xp,
    penalty,
    fleetNumber: fleetDataObj.fleet_number,
    isHardcore: hcEval.isEligible,
    hardcoreEligible: hcEval.isEligible,
    isHardcoreEligibleAtStart: driverJob.isHardcoreEligibleAtStart ?? true,
    hardcoreDisqualifiedDuringTrip: Boolean(payload.hardcoreDisqualifiedDuringTrip),
    hardcorePoints: hcEval.hardcorePoints,
    deliveryStars: hcEval.deliveryRating.totalStars,
    deliveryRating: hcEval.deliveryRating,
    hardcoreDisqualifyReason: hcEval.disqualifyReason,
  };
}

/**
 * 3. CANCEL JOB (`POST /api/tracker/jobs/cancel`)
 */
export async function processJobCancel(db, user, payload) {
  const discordId = String(user.discordId || "");
  const gameId = normalizeGameId(payload.gameId);
  const reqJobId = payload.jobId ? String(payload.jobId) : "";

  const filter = {
    guildId: NISMARA_GUILD_ID,
    driverId: discordId,
    gameId: gameId,
    jobStatus: "ONGOING",
    cancelPenaltyApplied: false,
  };
  if (reqJobId) {
    filter.jobId = reqJobId;
  }

  const now = new Date();
  const res = await db.collection("jobhistories").findOneAndUpdate(
    filter,
    {
      $set: {
        jobStatus: "CANCELED",
        status: "completed",
        completedAt: now,
        updatedAt: now,
        error: "CANCELED_BY_DRIVER",
        cancelPenaltyApplied: true,
      },
    },
    { returnDocument: "after", sort: { createdAt: -1 } }
  );

  const canceledJob = res?.value || res;
  if (!canceledJob) {
    return { canceled: false, message: "No active ONGOING job found to cancel." };
  }

  await db.collection("pointhistories").insertOne({
    guildId: NISMARA_GUILD_ID,
    userId: discordId,
    points: CANCEL_PENALTY_POINTS,
    managerId: SYSTEM_MANAGER_ID,
    type: "add",
    reason: `[Job: ${canceledJob.jobId}] Cancel Job Penalty`,
    createdAt: now,
  });

  await db.collection("points").findOneAndUpdate(
    { guildId: NISMARA_GUILD_ID, userId: discordId },
    { $inc: { totalPoints: CANCEL_PENALTY_POINTS } },
    { upsert: true }
  );

  console.log(
    `[Job Cancel] Job #${canceledJob.jobId} CANCELED by ${user.name} (${discordId}) -> +${CANCEL_PENALTY_POINTS} Penalty Points`
  );

  return {
    canceled: true,
    jobId: String(canceledJob.jobId),
    penaltyPointsAdded: CANCEL_PENALTY_POINTS,
  };
}


import express from "express";
import { authTracker } from "../middleware/authTracker.js";

const router = express.Router();
const NISMARA_GUILD_ID = process.env.NISMARA_GUILD_ID || "863959415702028318";

/**
 * POST /api/tracker/points/pay
 * Driver redeems/pays penalty points using Nismara Cash (NC).
 * Includes cumulative discounts for Server Booster (-500 NC) and Nismara+ (-500 NC).
 */
router.post("/pay", authTracker, async (req, res) => {
  try {
    const user = req.driverUser;
    const db = req.db;
    const now = new Date();

    const pointsToPay = Math.floor(Number(req.body?.pointsToPay || req.body?.points || 0));
    if (pointsToPay <= 0) {
      return res.status(400).json({
        success: false,
        error: "Jumlah poin yang ingin ditebus harus lebih dari 0.",
      });
    }

    const discordId = String(user.discordId || "");
    if (!discordId) {
      return res.status(400).json({
        success: false,
        error: "Driver tidak memiliki discordId yang valid.",
      });
    }

    const [currencyDoc, pointDoc, guildSettingsDoc] = await Promise.all([
      db.collection("currencies").findOne({ userId: discordId, guildId: NISMARA_GUILD_ID }),
      db.collection("points").findOne({ userId: discordId, guildId: NISMARA_GUILD_ID }),
      db.collection("guildsettings").findOne({ guildId: NISMARA_GUILD_ID }),
    ]);

    const currentPoints = pointDoc && typeof pointDoc.totalPoints === "number" ? pointDoc.totalPoints : 0;
    const currentNC = currencyDoc && typeof currencyDoc.totalNC === "number" ? currencyDoc.totalNC : 0;

    if (currentPoints <= 0) {
      return res.status(400).json({
        success: false,
        error: "Poin penalti Anda sudah bersih (0 Poin).",
      });
    }

    if (pointsToPay > currentPoints) {
      return res.status(400).json({
        success: false,
        error: `Jumlah poin yang ingin ditebus (${pointsToPay}) melebihi poin penalti Anda (${currentPoints}).`,
      });
    }

    // Hitung diskon kumulatif: Booster (-500 NC) + Nismara+ (-500 NC)
    const isBooster = Boolean(user.isBooster);
    const isNismaraPlus = Boolean(
      user.nismaraplus?.status &&
        (!user.nismaraplus?.expiredAt || new Date(user.nismaraplus.expiredAt) > now)
    );

    const basePointPrice = guildSettingsDoc?.pointPrice || 3000;
    const discountBooster = isBooster ? 500 : 0;
    const discountNismaraPlus = isNismaraPlus ? 500 : 0;
    const totalDiscountPerPoint = discountBooster + discountNismaraPlus;
    const finalPricePerPoint = Math.max(0, basePointPrice - totalDiscountPerPoint);
    const totalCost = pointsToPay * finalPricePerPoint;

    if (currentNC < totalCost) {
      return res.status(400).json({
        success: false,
        error: `Saldo NC Anda tidak mencukupi. Dibutuhkan ${totalCost.toLocaleString()} NC, saldo Anda ${currentNC.toLocaleString()} NC.`,
      });
    }

    // 1. Potong saldo NC secara atomik
    const deductRes = await db.collection("currencies").updateOne(
      { userId: discordId, guildId: NISMARA_GUILD_ID, totalNC: { $gte: totalCost } },
      { $inc: { totalNC: -totalCost } }
    );

    if (deductRes.modifiedCount === 0) {
      return res.status(400).json({
        success: false,
        error: "Saldo Nismara Cash (NC) Anda tidak mencukupi atau telah terpakai.",
      });
    }

    // 2. Kurangi poin penalti (minimal 0)
    await db.collection("points").updateOne(
      { userId: discordId, guildId: NISMARA_GUILD_ID },
      [{ $set: { totalPoints: { $max: [0, { $subtract: [{ $ifNull: ["$totalPoints", 0] }, pointsToPay] }] } } }]
    );

    // Keterangan diskon
    let discountReason = "";
    if (isBooster && isNismaraPlus) {
      discountReason = " (Booster & Nismara+ Discount -1000 NC)";
    } else if (isBooster) {
      discountReason = " (Booster Discount -500 NC)";
    } else if (isNismaraPlus) {
      discountReason = " (Nismara+ Discount -500 NC)";
    }

    // 3. Catat di pointhistories & currencyhistories
    await Promise.all([
      db.collection("pointhistories").insertOne({
        userId: discordId,
        guildId: NISMARA_GUILD_ID,
        managerId: discordId,
        points: pointsToPay,
        reason: `Membayar penalti menggunakan ${totalCost.toLocaleString()} NC${discountReason}`,
        type: "remove",
        createdAt: new Date(),
      }),
      db.collection("currencyhistories").insertOne({
        userId: discordId,
        guildId: NISMARA_GUILD_ID,
        managerId: discordId,
        amount: totalCost,
        type: "spend",
        reason: `Tebus ${pointsToPay} penalty point${discountReason}`,
        createdAt: new Date(),
      }),
    ]);

    const remainingPoints = Math.max(0, currentPoints - pointsToPay);
    const remainingNC = currentNC - totalCost;

    return res.json({
      success: true,
      message: `Berhasil menebus ${pointsToPay} poin penalti dengan ${totalCost.toLocaleString()} NC!`,
      pointsPaid: pointsToPay,
      totalCost,
      remainingPoints,
      remainingNC,
    });
  } catch (err) {
    console.error("[/api/tracker/points/pay Error]:", err);
    return res.status(500).json({
      success: false,
      error: "Gagal memproses pembayaran poin penalti: " + err.message,
    });
  }
});

/**
 * POST /api/tracker/points/use-ticket
 * Driver uses penalty removal tickets from their personal garage Safebox.
 * 1 Ticket = 1 Penalty Point Removed.
 */
router.post("/use-ticket", authTracker, async (req, res) => {
  try {
    const user = req.driverUser;
    const db = req.db;

    const amountToUse = Math.floor(Number(req.body?.amountToUse || req.body?.tickets || req.body?.amount || 0));
    if (amountToUse <= 0) {
      return res.status(400).json({
        success: false,
        error: "Jumlah tiket yang ingin digunakan harus lebih dari 0.",
      });
    }

    const discordId = String(user.discordId || "");
    if (!discordId) {
      return res.status(400).json({
        success: false,
        error: "Driver tidak memiliki discordId yang valid.",
      });
    }

    const [pointDoc, garageDoc] = await Promise.all([
      db.collection("points").findOne({ userId: discordId, guildId: NISMARA_GUILD_ID }),
      db.collection("garages").findOne({
        $or: [{ discordId: discordId }, { userId: user._id }],
      }),
    ]);

    const currentPoints = pointDoc && typeof pointDoc.totalPoints === "number" ? pointDoc.totalPoints : 0;
    if (currentPoints <= 0) {
      return res.status(400).json({
        success: false,
        error: "Poin penalti Anda sudah bersih (0 Poin).",
      });
    }

    if (amountToUse > currentPoints) {
      return res.status(400).json({
        success: false,
        error: `Anda tidak bisa menggunakan tiket (${amountToUse}) lebih dari jumlah poin penalti Anda (${currentPoints}).`,
      });
    }

    if (!garageDoc) {
      return res.status(400).json({
        success: false,
        error: "Anda belum memiliki garasi pribadi.",
      });
    }

    if (garageDoc.status === "suspended") {
      return res.status(400).json({
        success: false,
        error: "Akses ditolak! Garasi Anda sedang disita/dibekukan karena tunggakan operasional.",
      });
    }

    const currentSafeboxStock = typeof garageDoc.safeboxStock === "number" ? garageDoc.safeboxStock : 0;
    if (currentSafeboxStock < amountToUse) {
      return res.status(400).json({
        success: false,
        error: `Stok tiket di Safebox Garasi Anda tidak mencukupi (Tersedia: ${currentSafeboxStock}, Diminta: ${amountToUse}).`,
      });
    }

    // 1. Potong stok tiket Safebox Garasi
    const deductTicketRes = await db.collection("garages").updateOne(
      { _id: garageDoc._id, safeboxStock: { $gte: amountToUse } },
      { $inc: { safeboxStock: -amountToUse } }
    );

    if (deductTicketRes.modifiedCount === 0) {
      return res.status(400).json({
        success: false,
        error: "Gagal memotong tiket safebox atau stok telah berubah.",
      });
    }

    // 2. Kurangi poin penalti
    await db.collection("points").updateOne(
      { userId: discordId, guildId: NISMARA_GUILD_ID },
      [{ $set: { totalPoints: { $max: [0, { $subtract: [{ $ifNull: ["$totalPoints", 0] }, amountToUse] }] } } }]
    );

    // 3. Catat histori
    await db.collection("pointhistories").insertOne({
      userId: discordId,
      guildId: NISMARA_GUILD_ID,
      managerId: discordId,
      points: amountToUse,
      reason: `Penggunaan ${amountToUse} Tiket Hapus Penalti dari Safebox Garasi`,
      type: "remove",
      createdAt: new Date(),
    });

    const remainingPoints = Math.max(0, currentPoints - amountToUse);
    const remainingTickets = currentSafeboxStock - amountToUse;

    return res.json({
      success: true,
      message: `Berhasil menggunakan ${amountToUse} Tiket Safebox untuk menghapus ${amountToUse} Poin Penalti!`,
      ticketsUsed: amountToUse,
      remainingPoints,
      remainingTickets,
    });
  } catch (err) {
    console.error("[/api/tracker/points/use-ticket Error]:", err);
    return res.status(500).json({
      success: false,
      error: "Gagal memproses tiket hapus penalti: " + err.message,
    });
  }
});

export default router;


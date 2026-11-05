import { Router } from "express";
import { connectDB } from "../config/db.js";

const router = Router();

/**
 * GET /api/tracker/events
 * Aggregates live and recent VTC events from 4 MongoDB collections:
 * 1. contracts  (Special Contracts)
 * 2. coupons    (Coupon / Gift Redemption)
 * 3. giveaways  (Giveaway Quest & Prize Pool)
 * 4. ncevents   (Nismara Coin Multiplier Boosts)
 */
router.get("/", async (req, res) => {
  try {
    const db = await connectDB();

    // Query 4 event collections in parallel
    const [rawContracts, rawCoupons, rawGiveaways, rawNcEvents] = await Promise.all([
      db.collection("contracts").find({}).sort({ _id: -1 }).limit(10).toArray(),
      db.collection("coupons").find({}).sort({ _id: -1 }).limit(10).toArray(),
      db.collection("giveaways").find({}).sort({ _id: -1 }).limit(10).toArray(),
      db.collection("ncevents").find({}).sort({ _id: -1 }).limit(10).toArray(),
    ]);

    const now = new Date();

    // 1. Map Special Contracts
    const contracts = rawContracts.map((c) => {
      const end = c.endAt ? new Date(c.endAt) : null;
      const isActuallyActive = c.isActive === true || (end && end > now && c.isScheduled !== true);
      return {
        id: String(c._id),
        type: "CONTRACT",
        typeLabel: "Special Contract",
        title: c.contractName || "Special Contract",
        company: c.companyName || "Nismara Logistics",
        startDate: c.startDate || c.createdAt || null,
        endDate: c.endAt || null,
        isActive: isActuallyActive,
        isScheduled: c.isScheduled || false,
        stats: {
          completedContracts: c.completedContracts || 0,
          totalNCEarned: c.totalNCEarned || 0,
          totalDistanceKm: c.totalDistance || 0,
          totalMassTons: c.totalMass || 0,
          contributorsCount: Array.isArray(c.contributors) ? c.contributors.length : 0,
        },
        badgeColor: "bg-blue-500/20 text-blue-300 border-blue-500/30",
        imageUrl: c.imageUrl || null,
      };
    });

    // 2. Map Coupons
    const coupons = rawCoupons.map((cp) => {
      const end = cp.endDate ? new Date(cp.endDate) : null;
      const isActuallyActive = cp.isActive === true || (end && end > now);
      return {
        id: String(cp._id),
        type: "COUPON",
        typeLabel: "Kupon Hadiah",
        title: cp.nameCoupon || "Kupon Nismara",
        couponCode: cp.codeCoupon || "",
        rewardType: cp.type || "NC_REWARD",
        minAmount: cp.minAmount || 0,
        maxAmount: cp.maxAmount || 0,
        startDate: cp.startDate || cp.createdAt || null,
        endDate: cp.endDate || null,
        isActive: isActuallyActive,
        claimsCount: Array.isArray(cp.driverClaims) ? cp.driverClaims.length : 0,
        imageUrl: cp.imageUrl || null,
        badgeColor: "bg-amber-500/20 text-amber-300 border-amber-500/30",
      };
    });

    // 3. Map Giveaways
    const giveaways = rawGiveaways.map((g) => {
      const end = g.endDate ? new Date(g.endDate) : null;
      const isActuallyActive = g.status === "active" || (end && end > now && g.status !== "completed");
      return {
        id: String(g._id),
        type: "GIVEAWAY",
        typeLabel: "Giveaway Quest",
        title: g.title || "Giveaway Event",
        description: g.description || "",
        slug: g.slug || "",
        startDate: g.startDate || g.createdAt || null,
        endDate: g.endDate || null,
        drawDate: g.drawDate || null,
        status: g.status || "active",
        isActive: isActuallyActive,
        ticketPriceNC: g.ticketPriceNC || 0,
        maxPurchasableTickets: g.maxPurchasableTickets || 0,
        questsCount: Array.isArray(g.quests) ? g.quests.length : 0,
        quests: Array.isArray(g.quests) ? g.quests : [],
        prizes: Array.isArray(g.prizes) ? g.prizes : [],
        imageUrl: g.bannerUrl || null,
        badgeColor: "bg-purple-500/20 text-purple-300 border-purple-500/30",
      };
    });

    // 4. Map NC Events
    const ncevents = rawNcEvents.map((nc) => {
      const end = nc.endAt ? new Date(nc.endAt) : null;
      const isActuallyActive = nc.isActive === true || (end && end > now);
      const multPct = nc.multiplier ? `+${Math.round(nc.multiplier * 100)}% NC` : "Bonus NC";
      return {
        id: String(nc._id),
        type: "NC_EVENT",
        typeLabel: "NC Boost Event",
        title: nc.nameEvent || "NC Event",
        multiplierText: multPct,
        multiplierValue: nc.multiplier || 0,
        startDate: nc.setAt || nc.createdAt || null,
        endDate: nc.endAt || null,
        isActive: isActuallyActive,
        participantsCount: Array.isArray(nc.participants) ? nc.participants.length : 0,
        imageUrl: nc.imageUrl || null,
        badgeColor: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
      };
    });

    // Unified Chronological Feed (Active first, then by date desc)
    const feed = [...contracts, ...coupons, ...giveaways, ...ncevents].sort((a, b) => {
      if (a.isActive && !b.isActive) return -1;
      if (!a.isActive && b.isActive) return 1;
      const dateA = new Date(a.startDate || 0).getTime();
      const dateB = new Date(b.startDate || 0).getTime();
      return dateB - dateA;
    });

    const activeCount = feed.filter((e) => e.isActive).length;

    return res.json({
      success: true,
      timestamp: new Date().toISOString(),
      summary: {
        totalEvents: feed.length,
        activeCount,
        contractsCount: contracts.length,
        couponsCount: coupons.length,
        giveawaysCount: giveaways.length,
        nceventsCount: ncevents.length,
      },
      data: {
        feed,
        contracts,
        coupons,
        giveaways,
        ncevents,
      },
    });
  } catch (err) {
    console.error("[Events API] Error fetching events:", err);
    return res.status(500).json({
      success: false,
      error: "Gagal memuat daftar event komunitas dari database.",
      details: err?.message,
    });
  }
});

export default router;

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { connectDB } from "./src/config/db.js";
import meRoutes from "./src/routes/me.routes.js";
import jobsRoutes from "./src/routes/jobs.routes.js";
import pointsRoutes from "./src/routes/points.routes.js";
import updaterRoutes from "./src/routes/updater.routes.js";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3100);

// Trust reverse proxy headers (X-Forwarded-For / X-Forwarded-Proto) when deployed on 24/7 VPS
app.set("trust proxy", 1);

app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "2mb" }));

// Lightweight API Request Logger
app.use((req, _res, next) => {
  if (req.url.startsWith("/api/")) {
    const tok = req.headers["x-tracker-token"] || req.headers["authorization"] || "none";
    console.log(`[HTTP API] ${req.method} ${req.url} (Token: ${tok.length > 10 ? tok.slice(0, 10) + "..." : tok})`);
  }
  next();
});

// Health check endpoint
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "nismara-tracker-server",
    timestamp: new Date().toISOString(),
  });
});

// Mount Tracker API routes
app.use("/api/tracker", meRoutes);
app.use("/api/tracker", jobsRoutes);
app.use("/api/tracker/points", pointsRoutes);
app.use("/api/tracker", updaterRoutes);

async function bootstrap() {
  try {
    await connectDB();
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`=========================================================`);
      console.log(`🚀 Nismara Tracker Server running on http://localhost:${PORT}`);
      console.log(`   - GET  http://localhost:${PORT}/api/tracker/me`);
      console.log(`   - POST http://localhost:${PORT}/api/tracker/jobs/start`);
      console.log(`   - POST http://localhost:${PORT}/api/tracker/jobs/complete`);
      console.log(`   - POST http://localhost:${PORT}/api/tracker/jobs/cancel`);
      console.log(`   - POST http://localhost:${PORT}/api/tracker/points/pay`);
      console.log(`   - POST http://localhost:${PORT}/api/tracker/points/use-ticket`);
      console.log(`=========================================================`);
    });
  } catch (err) {
    console.error("[Bootstrap Fatal Error]:", err);
    process.exit(1);
  }
}

bootstrap();


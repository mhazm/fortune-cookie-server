import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

if (!MONGO_URI) {
  console.error("[MongoDB] FATAL: MONGO_URI is not defined in .env!");
  process.exit(1);
}

let isConnected = false;

export async function connectDB() {
  if (isConnected && mongoose.connection.readyState === 1) {
    return mongoose.connection.db;
  }

  try {
    await mongoose.connect(MONGO_URI, {
      maxPoolSize: 20,
      minPoolSize: 2,
      serverSelectionTimeoutMS: 10000,
    });
    isConnected = true;
    console.log("[MongoDB] Persistent Connection Pool established.");
    return mongoose.connection.db;
  } catch (err) {
    console.error("[MongoDB] Connection Error:", err);
    throw err;
  }
}

/**
 * Generates an atomic auto-incrementing jobId ("1", "2", "3", ...)
 * stored in the `tracker_counters` collection.
 */
export async function getNextJobId() {
  const db = await connectDB();
  const result = await db.collection("tracker_counters").findOneAndUpdate(
    { _id: "nismara_tracker_job_id" },
    {
      $inc: { seq: 1 },
      $set: { updatedAt: new Date() },
    },
    {
      upsert: true,
      returnDocument: "after",
    }
  );

  const doc = result?.value || result;
  const seq = doc?.seq || 1;
  return String(seq);
}

export default mongoose;


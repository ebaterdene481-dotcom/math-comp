import { buildApp } from "./app.js";
import { Database } from "./db.js";

const port = Number(process.env.PORT ?? 4000);
const corsOrigin = process.env.WEB_ORIGIN ?? true;

const demo = (process.env.DEMO_DATA ?? (process.env.NODE_ENV === "production" ? "0" : "1")) === "1";
const secureCookies = process.env.NODE_ENV === "production";

const adminEmails = (process.env.ADMIN_EMAILS ?? "").split(",");
const uploadDir = process.env.UPLOAD_DIR;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl && process.env.NODE_ENV === "production")
  throw new Error("DATABASE_URL is required in production: without it players' money is lost on restart.");
if (!databaseUrl) console.warn("No DATABASE_URL: data is kept in memory and lost on restart.");
const db = databaseUrl ? await Database.connect(databaseUrl) : undefined;

const app = await buildApp({ corsOrigin, demo, secureCookies, adminEmails, uploadDir, db });
await app.listen({ port, host: "0.0.0.0" });
console.log(`game server listening on :${port}`);

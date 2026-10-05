import { buildApp } from "./app.js";

const port = Number(process.env.PORT ?? 4000);
const corsOrigin = process.env.WEB_ORIGIN ?? true;

const demo = (process.env.DEMO_DATA ?? (process.env.NODE_ENV === "production" ? "0" : "1")) === "1";
const secureCookies = process.env.NODE_ENV === "production";

const app = await buildApp({ corsOrigin, demo, secureCookies });
await app.listen({ port, host: "0.0.0.0" });
console.log(`game server listening on :${port}`);

import { buildApp } from "./app.js";

const port = Number(process.env.PORT ?? 4000);
const corsOrigin = process.env.WEB_ORIGIN ?? true;

const app = await buildApp({ corsOrigin });
await app.listen({ port, host: "0.0.0.0" });
console.log(`game server listening on :${port}`);

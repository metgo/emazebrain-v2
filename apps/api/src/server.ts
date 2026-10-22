import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";

const port = Number(process.env.PORT ?? 8787);
const app = createApp({ cell: process.env.CELL ?? "local", version: process.env.APP_VERSION ?? "dev" });

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`api listening on :${info.port}`);
});

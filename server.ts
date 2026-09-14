import page from "./index.html";
import { handleGameRequest } from "./server/handler";
import { join } from "node:path";

const production = process.env.NODE_ENV === "production";
const server = Bun.serve({
  hostname: process.env.HOST ?? "0.0.0.0",
  port: Number(process.env.PORT ?? 3007),
  routes: { "/": page, "/david": page, "/elisabeth": page, "/ine": page, "/eg/music": page, "/eg/eating": page, "/api/game": handleGameRequest },
  development: production ? false : { hmr: true, console: true },
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/david/" || path === "/elisabeth/" || path === "/ine/") return Response.redirect(new URL(path.slice(0, -1), request.url), 308);
    if (["/sw.js", "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png"].includes(path)) {
      let file = Bun.file(join("public", path));
      if (!await file.exists()) file = Bun.file(join("dist", path));
      if (await file.exists()) return new Response(file, { headers: { "Cache-Control": "no-cache" } });
    }
    return new Response("Not found", { status: 404 });
  },
});
console.log(`Pass the Bigs → http://localhost:${server.port}`);

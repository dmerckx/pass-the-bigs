import page from "./index.html";

const production = process.env.NODE_ENV === "production";
const server = Bun.serve({
  hostname: process.env.HOST ?? "0.0.0.0",
  port: Number(process.env.PORT ?? 3007),
  routes: { "/": page },
  development: production ? false : { hmr: true, console: true },
  fetch() { return new Response("Not found", { status: 404 }); },
});
console.log(`Pass the Bigs → http://localhost:${server.port}`);

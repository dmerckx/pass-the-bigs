import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("Bun serves all player routes, app assets and the shared API over HTTP", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pass-the-bigs-http-"));
  const child = Bun.spawn(["bun", "server.ts"], {
    cwd: process.cwd(), env: { ...process.env, PORT: "0", VERCEL: "", STATE_BACKEND: "local", LOCAL_STATE_PATH: join(directory, "state.json") },
    stdout: "pipe", stderr: "pipe",
  });
  try {
    const reader = child.stdout.getReader(), decoder = new TextDecoder();
    let output = "", base = "";
    for (let i = 0; i < 10; i++) {
      const part = await reader.read();
      if (part.done) throw new Error("Bun server exited before becoming ready.");
      output += decoder.decode(part.value);
      const match = output.match(/http:\/\/localhost:\d+/);
      if (match) { base = match[0]; break; }
    }
    expect(base).not.toBe("");
    for (const route of ["/", "/david", "/elisabeth", "/ine", "/eg/eating", "/eg/drinking", "/eg/jumping", "/eg/reading", "/eg/sleeping", "/eg/sunbathing", "/eg/music"]) {
      const response = await fetch(base + route);
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('id="game-view"');
      for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
        const path = match[1]!;
        if (/^(https?:|#)/.test(path)) continue;
        const asset = await fetch(new URL(path, base + "/"));
        expect(asset.status).toBe(200);
      }
    }
    expect((await fetch(base + "/sw.js")).status).toBe(200);
    expect((await fetch(base + "/manifest.webmanifest")).status).toBe(200);
    expect((await fetch(base + "/icon-192.png")).headers.get("content-type")).toContain("image/png");
    const initial = await (await fetch(base + "/api/game")).json();
    expect(initial.state.game.active).toBe(0);
    expect(initial.state.profiles.ine).toEqual({ color: "amber", skin: "brown", completed: true });
    const roll = await fetch(base + "/api/game", { method: "POST", headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ id: crypto.randomUUID(), player: "david", expectedRevision: 0, kind: "roll", strength: .5 }) });
    expect(roll.status).toBe(200);
    const moved = await roll.json();
    expect(moved.state.gameRevision).toBe(1);
    const remote = await (await fetch(base + "/api/game")).json();
    expect(remote.state.lastRoll.id).toBe(moved.state.lastRoll.id);
    expect((await fetch(base + "/missing")).status).toBe(404);
  } finally {
    child.kill(); await child.exited;
    await rm(directory, { recursive: true });
  }
}, 30_000);

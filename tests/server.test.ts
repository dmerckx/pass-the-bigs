import { describe, test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHandler } from "../server/handler";
import { initialState, applyCommand, snapshot, type StoredState } from "../server/model";
import { LocalStore, GithubStore, openState, sealState, transaction, type StateStore, type Versioned } from "../server/storage";
import { validSubscription } from "../server/notifications";
import type { Command } from "../src/shared";

class MemoryStore implements StateStore {
  state: StoredState = initialState();
  version = 0;
  async load(): Promise<Versioned> { return { state: structuredClone(this.state), token: String(this.version) }; }
  async save(state: StoredState, token: string | null) {
    if (token !== String(this.version)) return false;
    this.state = structuredClone(state); this.version++; return true;
  }
}
let serial = 0;
function command(kind: Command["kind"], extra: Partial<Command> = {}): Command {
  return { id: `test-command-id-${++serial}`, player: "david", expectedRevision: 0, kind, ...(kind === "roll" ? { strength: 0.5 } : {}), ...extra };
}
function request(body: unknown) {
  return new Request("http://localhost/api/game", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost" }, body: JSON.stringify(body) });
}
describe("authoritative two-device play", () => {
  test("the waiting player cannot roll or bank", async () => {
    const store = new MemoryStore(), handler = createHandler({ store });
    expect((await handler(request(command("roll", { player: "elisabeth" })))).status).toBe(403);
    expect((await handler(request(command("bank", { player: "elisabeth" })))).status).toBe(403);
    expect(store.state.history).toHaveLength(0);
  });
  test("roll, bank, opponent roll, and restart share state and preserve history", async () => {
    const store = new MemoryStore(); let now = 10_000;
    const handler = createHandler({ store, ticket: () => 0, now: () => now });
    expect((await handler(request(command("roll")))).status).toBe(200);
    expect(store.state.game.turn).toBe(1);
    now += 5000;
    expect((await handler(request(command("bank", { expectedRevision: 1 })))).status).toBe(200);
    expect(store.state.game.active).toBe(1);
    expect((await handler(request(command("roll", { player: "elisabeth", expectedRevision: 2 })))).status).toBe(409);
    const replayId = store.state.replays[1]!.id;
    expect((await handler(request(command("start-replay", { player: "elisabeth", replayId })))).status).toBe(200);
    now += 5000;
    expect((await handler(request(command("finish-replay", { player: "elisabeth", replayId })))).status).toBe(200);
    expect((await handler(request(command("roll", { player: "elisabeth", expectedRevision: 2 })))).status).toBe(200);
    now += 5000;
    expect((await handler(request(command("restart", { expectedRevision: 3 })))).status).toBe(200);
    expect(store.state.game.scores).toEqual([0, 0]);
    expect(store.state.game.best).toEqual([1, 0]);
    expect(store.state.match).toBe(2);
    expect(store.state.history.map(e => e.kind)).toEqual(["roll", "bank", "roll", "restart"]);
  });
  test("retrying an uncertain request never rerolls or double-banks", async () => {
    const store = new MemoryStore(), handler = createHandler({ store, ticket: () => 0, now: () => 10_000 });
    const roll = command("roll");
    await handler(request(roll)); await handler(request(roll));
    expect(store.state.game.turn).toBe(1);
    expect(store.state.history).toHaveLength(1);
    expect((await handler(request({ ...roll, strength: 1 }))).status).toBe(409);
  });
  test("simultaneous devices cannot overwrite each other's move", async () => {
    const store = new MemoryStore(), handler = createHandler({ store, ticket: () => 0, now: () => 10_000 });
    const responses = await Promise.all([handler(request(command("roll"))), handler(request(command("roll")))]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
    expect(store.state.history).toHaveLength(1);
  });
  test("clients cannot choose a result, and cannot act before the pigs land", async () => {
    const store = new MemoryStore(), handler = createHandler({ store, ticket: () => 573, now: () => 10_000 });
    await handler(request({ ...command("roll"), ticket: 5976, points: 60 }));
    expect(store.state.game.turn).toBe(0);
    expect(store.state.game.active).toBe(1);
    expect((await handler(request(command("roll", { player: "elisabeth", expectedRevision: 1 })))).status).toBe(409);
  });
  test("nudge targets the active opponent, is deduplicated and rate limited", async () => {
    const store = new MemoryStore(); let sent = 0;
    const handler = createHandler({ store, now: () => 10_000, notify: async (_state, to) => {
      expect(to).toBe("david"); sent++; return { status: "in-app", expired: [] };
    } });
    expect((await handler(request(command("nudge")))).status).toBe(409);
    const nudge = command("nudge", { player: "elisabeth" });
    expect((await handler(request(nudge))).status).toBe(200);
    await handler(request(nudge));
    expect(sent).toBe(1);
    expect((await handler(request(command("nudge", { player: "elisabeth" })))).status).toBe(429);
  });
  test("polling strips secrets, supports ETags, and paginates history", async () => {
    const store = new MemoryStore(), handler = createHandler({ store });
    const response = await handler(new Request("http://localhost/api/game"));
    const text = await response.text();
    expect(text).not.toContain("privateKey");
    expect(text).not.toContain("subscriptions");
    expect(text).not.toContain("receipts");
    expect((await handler(new Request("http://localhost/api/game", { headers: { "if-none-match": '"0"' } }))).status).toBe(304);
    const history = await (await handler(new Request("http://localhost/api/game?view=history"))).json();
    expect(history).toEqual({ events: [], next: null, total: 0 });
  });
  test("rejects cross-origin actions, malformed input and arbitrary push endpoints", async () => {
    const handler = createHandler({ store: new MemoryStore() });
    const cross = new Request("http://localhost/api/game", { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: JSON.stringify(command("roll")) });
    expect((await handler(cross)).status).toBe(403);
    expect((await handler(request(command("roll", { strength: 2 })))).status).toBe(400);
    expect(validSubscription({ endpoint: "https://127.0.0.1/private", keys: { p256dh: "a".repeat(87), auth: "a".repeat(22) } })).toBe(false);
    expect(validSubscription({ endpoint: "https://fcm.googleapis.com/fcm/send/test", keys: { p256dh: "a".repeat(87), auth: "a".repeat(22) } })).toBe(true);
  });
});
describe("JSON and GitHub persistence", () => {
  test("local JSON survives a server instance restart and protects concurrent writes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pass-the-bigs-test-"));
    try {
      const path = join(directory, "state.json"), first = new LocalStore(path), second = new LocalStore(path);
      expect((await first.load()).state).toBeNull();
      const state = initialState();
      expect(await first.save(state, null)).toBe(true);
      const loaded = await second.load();
      expect(loaded.state).toEqual(state);
      const changed = applyCommand(state, command("roll"), 10_000, 0).state;
      const writes = await Promise.all([first.save(changed, loaded.token), second.save(changed, loaded.token)]);
      expect(writes.sort()).toEqual([false, true]);
    } finally { await rm(directory, { recursive: true }); }
  });
  test("public-repository state is authenticated ciphertext and a wrong key fails closed", () => {
    const state = initialState(), sealed = sealState(state, "test-secret");
    expect(sealed).not.toContain(state.vapid.privateKey);
    expect(sealed).not.toContain("David");
    expect(openState(sealed, "test-secret")).toEqual(state);
    expect(() => openState(sealed, "other-secret")).toThrow();
    const envelope = JSON.parse(sealed); envelope.tag = Buffer.alloc(16).toString("base64");
    expect(() => openState(JSON.stringify(envelope), "test-secret")).toThrow();
  });
  test("GitHub branch bootstrap, encrypted write and cross-instance CAS conflict", async () => {
    let branch = false, content: string | null = null, version = 0;
    const fakeFetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
      const url = new URL(String(input)), body = init.body ? JSON.parse(String(init.body)) : null;
      if (url.pathname.endsWith("/git/ref/heads/main")) return Response.json({ object: { sha: "main-sha" } });
      if (url.pathname.includes("/git/ref/heads/")) return branch ? Response.json({ object: { sha: "state-sha" } }) : new Response(null, { status: 404 });
      if (url.pathname.endsWith("/git/refs")) { branch = true; return Response.json({}, { status: 201 }); }
      if (init.method === "PUT") {
        if ((body.sha ?? null) !== (content ? String(version) : null)) return new Response(null, { status: 409 });
        content = body.content; version++;
        return Response.json({ content: { sha: String(version) } });
      }
      if (!content) return new Response(null, { status: 404 });
      if (new Headers(init.headers).get("if-none-match") === `"${version}"`) return new Response(null, { status: 304 });
      return Response.json({ content, encoding: "base64", sha: String(version) }, { headers: { etag: `"${version}"` } });
    }) as typeof fetch;
    const config = { token: "test-token", repo: "owner/repo", branch: "game-state", secret: "test-secret", fetcher: fakeFetch };
    const a = new GithubStore(config), b = new GithubStore(config), state = initialState();
    expect(await a.save(state, null)).toBe(true);
    expect(branch).toBe(true);
    const [left, right] = await Promise.all([a.load(), b.load()]);
    expect(left.state).toEqual(state);
    expect(right.token).toBe(left.token);
    const changed = applyCommand(state, command("roll"), 10_000, 0).state;
    expect(await a.save(changed, left.token)).toBe(true);
    expect(await b.save(changed, right.token)).toBe(false);
    expect((await b.load(true)).state?.game.turn).toBe(1);
    const savedText = Buffer.from(content!, "base64").toString("utf8");
    expect(savedText).not.toContain(state.vapid.privateKey);
    expect(savedText).not.toContain("subscriptions");
  });
});

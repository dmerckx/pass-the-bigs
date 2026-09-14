import { describe, test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHandler } from "../server/handler";
import { applyCommand, snapshot, type StoredState } from "../server/model";
import { LocalStore, GithubStore, openState, sealState, readState, transaction, type StateStore, type Versioned } from "../server/storage";
import { readyState as initialState } from "./helpers";
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
describe("three-player state migration", () => {
  function legacyStore() {
    const store = new MemoryStore();
    store.state = applyCommand(store.state, command("roll"), 10_000, 573).state;
    const old = JSON.parse(JSON.stringify(store.state));
    delete old.rosterVersion; delete old.maintenanceResetVersion; delete old.replayBacklog;
    old.game.scores = [42, 71]; old.game.best = [123, 111]; old.game.wins = [3, 2];
    old.profiles.david = { color: "blue", skin: "white", completed: true };
    old.profiles.elisabeth = { color: "plum", skin: "pink", completed: true };
    delete old.profiles.ine; delete old.subscriptions.ine;
    old.replays.length = old.replaySessions.length = old.replayAcknowledged.length = 2;
    store.state = old;
    return store;
  }
  test("adds Ine while preserving scores, skins, history, subscriptions and pending replay", async () => {
    const store = legacyStore(), old = structuredClone(store.state);
    const state = await readState(store);
    expect(state.game.scores).toEqual([42, 71, 0]);
    expect(state.game.best).toEqual([123, 111, 0]);
    expect(state.game.wins).toEqual([3, 2, 0]);
    expect(state.game.active).toBe(old.game.active);
    expect(state.profiles.david).toEqual(old.profiles.david);
    expect(state.profiles.elisabeth).toEqual(old.profiles.elisabeth);
    expect(state.profiles.ine).toEqual({ color: "amber", skin: "brown", completed: true });
    expect(state.history).toEqual(old.history);
    expect(state.replays[1]?.id).toBe(old.replays[1]?.id);
    expect(state.vapid).toEqual(old.vapid);
    expect(state.receipts).toEqual(old.receipts);
    expect(state.subscriptions.david).toEqual(old.subscriptions.david);
    expect(state.match).toBe(old.match);
    expect(state.gameRevision).toBe(old.gameRevision + 1);
    expect(await readState(store)).toEqual(state);
    expect(store.version).toBe(1);
    expect(openState(sealState(state, "migration-key"), "migration-key").rosterVersion).toBe(3);
  });
  test("an old screen gets the upgraded state without replaying its stale move", async () => {
    const store = legacyStore();
    const response = await createHandler({ store })(request(command("roll", { expectedRevision: store.state.gameRevision })));
    expect(response.status).toBe(409);
    expect(store.state.game.scores).toEqual([42, 71, 0]);
    expect(store.state.profiles.ine.completed).toBe(true);
    expect(store.state.history).toHaveLength(1);
  });
  test("concurrent migration requests save exactly once", async () => {
    const store = legacyStore();
    const states = await Promise.all([readState(store), readState(store), readState(store)]);
    expect(states.every(state => state.game.scores[1] === 71)).toBe(true);
    expect(store.version).toBe(1);
  });
});
describe("authoritative three-player play", () => {
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
    expect((await handler(request(command("restart", { expectedRevision: 3 })))).status).toBe(409);
    // In-progress reset remains a maintenance operation; public Restart is post-win.
    store.state = applyCommand(store.state, command("restart", { expectedRevision: 3 }), now, 0).state;
    expect(store.state.game.scores).toEqual([0, 0, 0]);
    expect(store.state.game.best).toEqual([1, 0, 0]);
    expect(store.state.match).toBe(2);
    expect(store.state.history.map(e => e.kind)).toEqual(["roll", "bank", "roll", "restart"]);
  });
  test("post-win Restart preserves the series, profiles and history exactly once", async () => {
    const store = new MemoryStore(); let now = 10_000;
    store.state.game.scores = [99, 31, 0];
    store.state.game.best = [112, 76, 0];
    store.state.game.wins = [2, 1, 0];
    store.state.profiles.david.skin = "brown";
    let alerts = 0;
    const handler = createHandler({ store, now: () => now, ticket: () => 0, notify: async (_state, notice) => {
      expect(notice.to).toBe("david"); alerts++; return { status: "in-app", expired: [] };
    } });
    expect((await handler(request(command("restart")))).status).toBe(409);
    expect((await handler(request(command("roll")))).status).toBe(200);
    expect(store.state.game.wins).toEqual([3, 1, 0]);
    now += 5000;
    const restart = command("restart", { player: "elisabeth", expectedRevision: 1 });
    expect((await handler(request(restart))).status).toBe(200);
    await handler(request(restart));
    expect(store.state.match).toBe(2);
    expect(store.state.game.scores).toEqual([0, 0, 0]);
    expect(store.state.game.wins).toEqual([3, 1, 0]);
    expect(store.state.game.best).toEqual([112, 76, 0]);
    expect(store.state.profiles.david.skin).toBe("brown");
    expect(store.state.replays).toEqual([null, null, null]);
    expect(snapshot(store.state).lastRolls).toEqual([null, null, null]);
    expect(store.state.history.map(e => e.kind)).toEqual(["roll", "restart"]);
    expect(store.state.history[0]?.scores).toEqual([100, 31, 0]);
    expect(alerts).toBe(1);
  });
  test("snapshots keep each player's own latest landing for both 3D slices", () => {
    let state = applyCommand(initialState(), command("roll"), 10_000, 573).state;
    const first = state.lastRoll;
    const replayId = state.replays[1]!.id;
    state = applyCommand(state, command("start-replay", { player: "elisabeth", replayId }), 15_000, 0).state;
    state = applyCommand(state, command("finish-replay", { player: "elisabeth", replayId }), 25_000, 0).state;
    state = applyCommand(state, command("roll", { player: "elisabeth", expectedRevision: 1 }), 30_000, 0).state;
    expect(snapshot(state).lastRolls).toEqual([first, state.lastRoll, null]);
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
  test("turn transitions notify exactly once across move retries and replays", async () => {
    const store = new MemoryStore(); let now = 10_000, ticket = 0;
    const sent: string[] = [];
    const handler = createHandler({ store, now: () => now, ticket: () => ticket, notify: async (saved, note) => {
      expect(saved.turnNotice).toEqual(note);
      sent.push(`${note.to}:${note.id}`); return { status: "in-app", expired: [] };
    } });
    await handler(request(command("roll")));
    expect(sent).toHaveLength(0);
    now += 5000;
    const bank = command("bank", { expectedRevision: 1 });
    expect((await handler(request(bank))).status).toBe(200);
    await handler(request(bank));
    expect(sent).toEqual(["elisabeth:1:2"]);
    const replayId = store.state.replays[1]!.id;
    await handler(request(command("start-replay", { player: "elisabeth", replayId })));
    now += 5000;
    await handler(request(command("finish-replay", { player: "elisabeth", replayId })));
    expect(sent).toHaveLength(1);
    ticket = 573;
    const roll = command("roll", { player: "elisabeth", expectedRevision: 2 });
    expect((await handler(request(roll))).status).toBe(200);
    await handler(request(roll));
    expect(sent).toEqual(["elisabeth:1:2", "ine:1:3"]);
    expect((await handler(request({ ...command("bank"), kind: "nudge" }))).status).toBe(400);
    expect(sent).toHaveLength(2);
  });
  test("concurrent banks send only the winning request's notification", async () => {
    const store = new MemoryStore(); let now = 10_000, sent = 0;
    const handler = createHandler({ store, now: () => now, ticket: () => 0, notify: async () => {
      sent++; return { status: "push", expired: [] };
    } });
    await handler(request(command("roll"))); now += 5000;
    const responses = await Promise.all([1, 2].map(() => handler(request(command("bank", { expectedRevision: 1 })))));
    expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
    expect(sent).toBe(1);
  });
  test("winning does not notify a nonexistent next turn", async () => {
    const store = new MemoryStore(); store.state.game.scores[0] = 99;
    let sent = 0;
    const handler = createHandler({ store, ticket: () => 0, now: () => 10_000, notify: async () => {
      sent++; return { status: "push", expired: [] };
    } });
    expect((await handler(request(command("roll")))).status).toBe(200);
    expect(store.state.game.winner).toBe(0);
    expect(sent).toBe(0);
  });
  test("failed delivery preserves the turn notice and removes expired subscriptions", async () => {
    const store = new MemoryStore();
    const endpoint = "https://fcm.googleapis.com/fcm/send/expired-test";
    store.state.subscriptions.elisabeth.push({ endpoint, keys: { p256dh: "a".repeat(87), auth: "a".repeat(22) } });
    let sent = 0;
    const handler = createHandler({ store, ticket: () => 5977, now: () => 10_000, notify: async () => {
      sent++; return { status: "failed", expired: [endpoint] };
    } });
    const roll = command("roll");
    const response = await handler(request(roll));
    expect(response.status).toBe(200);
    expect((await response.json()).delivery).toBe("failed");
    expect(store.state.turnNotice?.to).toBe("elisabeth");
    expect(store.state.subscriptions.elisabeth).toHaveLength(0);
    await handler(request(roll));
    expect(sent).toBe(1);
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

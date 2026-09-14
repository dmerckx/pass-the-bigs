import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { MoveOutbox, MoveConflict, projectMove } from "../src/outbox";
import { seededTicket } from "../src/seed";
import { outcomeForTicket } from "../src/rules";
import { applyCommand, initialState, snapshot } from "../server/model";
import { decodeSave, encodeSave } from "../src/game";
import { readState, type StateStore } from "../server/storage";
import type { Command } from "../src/shared";

let serial = 0;
function baseWithRolls(kinds: string[]) {
  const state = initialState();
  for (let candidate = 0; ; candidate++) {
    state.rollSeed = candidate.toString(16).padStart(64, "0");
    const rolls = kinds.map((_, i) => outcomeForTicket(seededTicket(state.rollSeed, i)));
    if (rolls.every((roll, i) => roll.kind === kinds[i]) && rolls.reduce((total, roll) => total + roll.points, 0) < 90) return state;
  }
}
function move(outbox: MoveOutbox, kind: "roll" | "bank" = "roll", strength = .5): Command {
  const state = outbox.view;
  return { id: `buffered-command-${++serial}`, player: "david", expectedRevision: state.gameRevision, kind,
    ...(kind === "roll" ? { strength, expectedRollIndex: state.rollIndex } : {}) };
}
test("shared tickets agree with native SHA-256 and keep existing scoring buckets", () => {
  const seed = "ab".repeat(32);
  for (let index = 0; index < 500; index++) {
    let expected = 0;
    for (let attempt = 0; ; attempt++) {
      const value = createHash("sha256").update(`pass-the-pigs:v1:${seed}:${index}:${attempt}`).digest().readUInt32BE(0);
      if (value < Math.floor(0x100000000 / 6000) * 6000) { expected = value % 6000; break; }
    }
    expect(seededTicket(seed, index)).toBe(expected);
    expect(outcomeForTicket(seededTicket(seed, index))).toEqual(outcomeForTicket(expected));
  }
  expect(() => seededTicket("bad", 0)).toThrow();
  expect(() => seededTicket(seed, -1)).toThrow();
});
test("multiple tosses and banking buffer while the first GitHub save is still in flight", async () => {
  let server = baseWithRolls(["score", "score", "score"]), saved: string | null = null, now = 0;
  const outbox = new MoveOutbox(snapshot(server), value => { saved = value; });
  let release!: () => void;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  const calls: string[] = [];
  outbox.enqueue(move(outbox, "roll", .1));
  const flushing = outbox.flush(async command => {
    calls.push(command.id); await delayed; now += 10_000;
    server = applyCommand(server, command, now).state; return snapshot(server);
  }, () => {});
  outbox.enqueue(move(outbox, "roll", .9)); outbox.enqueue(move(outbox, "roll", .5));
  const projectedPoints = outbox.view.game.turn;
  expect(projectedPoints).toBeGreaterThan(0);
  outbox.enqueue(move(outbox, "bank"));
  expect(outbox.count).toBe(4); expect(calls).toHaveLength(1);
  expect(outbox.view.game.scores[0]).toBe(projectedPoints);
  expect(outbox.view.game.active).toBe(1);
  expect(MoveOutbox.restore(saved, "david", () => {})?.count).toBe(4);
  release(); await flushing;
  expect(calls).toHaveLength(4); expect(outbox.count).toBe(0); expect(saved).toBeNull();
  expect(server.history.map(event => event.kind)).toEqual(["roll", "roll", "roll", "bank"]);
  expect(server.history.slice(0, 3).map(event => event.strength)).toEqual([.1, .9, .5]);
  expect(outbox.view.game).toEqual(server.game);
  expect(server.game.scores[0]).toBe(projectedPoints);
});
test("refresh after a lost response retries the same roll without rerolling or double scoring", async () => {
  let server = baseWithRolls(["score"]), saved: string | null = null;
  const persist = (value: string | null) => { saved = value; };
  const outbox = new MoveOutbox(snapshot(server), persist);
  const command = move(outbox); const predicted = outbox.enqueue(command);
  await expect(outbox.flush(async command => {
    server = applyCommand(server, command, 10_000).state;
    throw new Error("Response lost after commit");
  }, () => {})).rejects.toThrow("Response lost");
  const restored = MoveOutbox.restore(saved, "david", persist)!;
  expect(restored.view.game).toEqual(predicted.game);
  await restored.flush(async retry => {
    expect(retry).toEqual(command);
    const result = applyCommand(server, retry, 20_000);
    expect(result.applied).toBe(false); return snapshot(result.state);
  }, () => {});
  expect(server.history).toHaveLength(1); expect(server.rollIndex).toBe(1);
  expect(restored.count).toBe(0); expect(restored.view.game).toEqual(predicted.game);
});
test("another device winning the revision reconciles the projection to shared state", async () => {
  let server = baseWithRolls(["score", "score"]);
  const outbox = new MoveOutbox(snapshot(server), () => {});
  outbox.enqueue(move(outbox)); outbox.enqueue(move(outbox));
  server = applyCommand(server, { id: "other-device-command", player: "david", kind: "roll", expectedRevision: 0, expectedRollIndex: 0, strength: .2 }, 10_000).state;
  let conflict = false;
  await expect(outbox.flush(async () => { throw new MoveConflict("Another device moved", snapshot(server)); }, value => { conflict = value; })).rejects.toThrow();
  expect(conflict).toBe(true); expect(outbox.count).toBe(0); expect(outbox.view.game).toEqual(server.game);
});
test("busts stop buffering and winning predictions increment wins exactly once", () => {
  const lost = new MoveOutbox(snapshot(baseWithRolls(["pig-out"])), () => {});
  lost.enqueue(move(lost)); expect(lost.view.game.active).toBe(1);
  expect(() => lost.enqueue(move(lost))).toThrow("match changed");
  const state = baseWithRolls(["score"]); state.game.scores[0] = 99;
  const won = new MoveOutbox(snapshot(state), () => {}), command = move(won);
  const expected = won.enqueue(command);
  expect(expected.game.wins[0]).toBe(1); expect(() => won.enqueue(move(won))).toThrow();
  const server = applyCommand(state, command, 10_000).state;
  won.accept(snapshot(server), command.id); won.accept(snapshot(server));
  expect(won.view.game.wins[0]).toBe(1);
});
test("durability failure does not start a speculative move", () => {
  const outbox = new MoveOutbox(snapshot(baseWithRolls(["score"])), () => { throw new Error("Quota exceeded"); });
  expect(() => outbox.enqueue(move(outbox))).toThrow("Quota exceeded");
  expect(outbox.count).toBe(0); expect(outbox.view.game.turn).toBe(0);
});
test("server rejects an altered stream index and strength never changes its ticket", () => {
  const state = baseWithRolls(["score"]), outbox = new MoveOutbox(snapshot(state), () => {});
  const command = move(outbox);
  expect(() => applyCommand(state, { ...command, expectedRollIndex: 4 }, 10_000)).toThrow("roll sequence changed");
  const soft = applyCommand(state, { ...command, strength: 0 }, 10_000).state;
  const hard = applyCommand(state, { ...command, strength: 1 }, 10_000).state;
  expect(soft.lastRoll?.ticket).toBe(hard.lastRoll?.ticket);
  expect(projectMove(snapshot(state), command).game).toEqual(soft.game);
});
test("adding a seed to an existing match preserves its scores and old browser saves remain readable", async () => {
  const current = initialState(); current.game.scores = [81, 53, 4];
  const old = JSON.parse(JSON.stringify(current)); delete old.rollSeed; delete old.rollIndex;
  let saves = 0;
  const store: StateStore = { load: async () => ({ state: old, token: "old" }), save: async state => { Object.assign(old, state); saves++; return true; } };
  const upgraded = await readState(store); await readState(store);
  expect(saves).toBe(1); expect(upgraded.game.scores).toEqual([81, 53, 4]);
  expect(upgraded.rollIndex).toBe(0); expect(upgraded.rollSeed).toHaveLength(64);
  const legacy = JSON.parse(encodeSave(current.game));
  legacy.game.scores.length = legacy.game.best.length = legacy.game.wins.length = 2;
  expect(decodeSave(JSON.stringify(legacy)).scores).toEqual([81, 53, 0]);
});

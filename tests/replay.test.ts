import { describe, expect, test } from "bun:test";
import { applyCommand, snapshot, validateState, type StoredState } from "../server/model";
import { readyState as initialState } from "./helpers";
import { needsReplay, replayDuration } from "../server/replay";
import { openState, sealState } from "../server/storage";
import { parseCommand } from "../server/handler";
import { outcomeForTicket } from "../src/rules";
import type { Command, PlayerId } from "../src/shared";

let serial = 0;
function move(s: StoredState, kind: Command["kind"], player: PlayerId = "david", fields: Partial<Command> = {}): Command {
  return { id: `replay-test-command-${++serial}`, expectedRevision: s.gameRevision, kind, player,
    ...(kind === "roll" ? { strength: .5 } : {}), ...fields };
}
function act(s: StoredState, kind: Command["kind"], ticket = 0, player: PlayerId = "david", fields: Partial<Command> = {}, now = s.availableAt + 5000) {
  return applyCommand(s, move(s, kind, player, fields), now, ticket).state;
}
function bankedTurn() {
  let s = act(initialState(), "roll", 0, "david", { strength: .1 });
  s = act(s, "roll", 0, "david", { strength: .9 });
  return act(s, "bank");
}
function watch(s: StoredState, player: PlayerId, reducedMotion = false) {
  const i = player === "david" ? 0 : player === "elisabeth" ? 1 : 2, replayId = s.replays[i]!.id;
  s = act(s, "start-replay", 0, player, { replayId, reducedMotion });
  return act(s, "finish-replay", 0, player, { replayId }, s.replaySessions[i]!.notBefore);
}
describe("mandatory opponent turn replay", () => {
  test("records all rolls, strengths and final bank in order without including subscription changes", () => {
    let s = act(initialState(), "roll", 0, "david", { strength: .1 });
    s = act(s, "unsubscribe", 0, "elisabeth", { endpoint: "https://fcm.googleapis.com/fcm/send/old" });
    s = act(s, "roll", 0, "david", { strength: .9 });
    expect(snapshot(s).replays).toEqual([null, null, null]);
    s = act(s, "bank");
    const replay = snapshot(s).replays[1]!;
    expect(replay.player).toBe("david");
    expect(replay.startScores).toEqual([0, 0, 0]);
    expect(replay.events.map(e => e.kind)).toEqual(["roll", "roll", "bank"]);
    expect(replay.events.slice(0, 2).map(e => e.strength)).toEqual([.1, .9]);
    expect(replay.events.map(e => e.turn)).toEqual([1, 2, 0]);
    expect(replay.events.at(-1)?.scores).toEqual([2, 0, 0]);
    expect(s.currentTurn.player).toBe("elisabeth");
    expect(s.currentTurn.startScores).toEqual([2, 0, 0]);
  });
  test("rolling and banking require a started replay and its full duration", () => {
    let s = bankedTurn();
    const replayId = s.replays[1]!.id;
    for (const kind of ["roll", "bank"] as const) {
      expect(() => act(s, kind, 0, "elisabeth")).toThrow("Replay the other player's turn first.");
    }
    expect(() => act(s, "finish-replay", 0, "elisabeth", { replayId })).toThrow("Watch the entire turn");
    const revision = s.gameRevision, history = structuredClone(s.history), scores = structuredClone(s.game.scores);
    s = act(s, "start-replay", 0, "elisabeth", { replayId });
    const deadline = s.replaySessions[1]!.notBefore;
    expect(() => act(s, "finish-replay", 0, "elisabeth", { replayId }, deadline - 1)).toThrow("Watch the entire turn");
    expect(() => act(s, "roll", 0, "elisabeth", {}, deadline + 1)).toThrow("Replay the other player's turn first.");
    s = act(s, "finish-replay", 0, "elisabeth", { replayId }, deadline);
    expect(s.gameRevision).toBe(revision);
    expect(s.history).toEqual(history);
    expect(s.game.scores).toEqual(scores);
    expect(snapshot(s).replays[1]).toBeNull();
    s = act(s, "roll", 0, "elisabeth", {}, deadline + 1);
    expect(s.game.turn).toBe(1);
  });
  test("each player must watch the other's next turn and acknowledgements survive reloads", () => {
    let s = watch(bankedTurn(), "elisabeth");
    s = openState(sealState(s, "test-key"), "test-key");
    expect(needsReplay(s, 1)).toBe(false);
    s = act(s, "roll", 0, "elisabeth");
    s = act(s, "bank", 0, "elisabeth");
    s = openState(sealState(s, "test-key"), "test-key");
    expect(needsReplay(s, 0)).toBe(true);
    expect(s.replays[0]!.player).toBe("elisabeth");
    expect(() => act(s, "roll")).toThrow("Replay the other player's turn first.");
    s = watch(s, "david");
    expect(() => act(s, "roll", 0, "ine")).toThrow("Replay the other player's turn first.");
    s = watch(s, "ine");
    expect(needsReplay(s, 2)).toBe(true);
    s = watch(s, "ine");
    s = act(s, "roll", 0, "ine"); s = act(s, "bank", 0, "ine");
    s = watch(s, "david");
    s = act(s, "roll");
    s = act(s, "bank");
    expect(needsReplay(s, 1)).toBe(true);
    expect(s.replays[1]!.id).toBe("1:3");
    expect(s.replays[1]!.startScores).toEqual([2, 1, 0]);
    expect(s.replayBacklog[1][0]?.player).toBe("david");
  });
  test("a bust or winning roll completes a replay without requiring a bank", () => {
    for (const ticket of [573, 5977, 0]) {
      const initial = initialState();
      if (ticket === 0) initial.game.scores[0] = 99;
      const s = act(initial, "roll", ticket);
      expect(s.replays[1]?.events).toHaveLength(1);
      expect(s.replays[1]?.events[0]?.ticket).toBe(ticket);
      if (ticket === 0) {
        expect(s.game.winner).toBe(0);
        expect(watch(s, "elisabeth").game.scores[0]).toBe(100);
      } else expect(outcomeForTicket(ticket).kind).not.toBe("score");
    }
  });
  test("bad-roll replays cannot finish before the three-second landing hold", () => {
    for (const ticket of [573, 5977]) {
      for (const reducedMotion of [false, true]) {
        let s = act(initialState(), "roll", ticket, "david", { strength: 1 });
        const replayId = s.replays[1]!.id, now = s.availableAt + 5000;
        const animationMs = reducedMotion ? 520 : 2350 + 110;
        s = act(s, "start-replay", 0, "elisabeth", { replayId, reducedMotion }, now);
        expect(s.replaySessions[1]!.notBefore).toBe(now + animationMs + 3000);
        expect(() => act(s, "finish-replay", 0, "elisabeth", { replayId }, now + animationMs + 2999))
          .toThrow("Watch the entire turn");
        s = act(s, "finish-replay", 0, "elisabeth", { replayId }, now + animationMs + 3000);
        expect(needsReplay(s, 1)).toBe(false);
        expect(act(s, "roll", 0, "elisabeth", {}, now + animationMs + 3001).game.turn).toBe(1);
      }
    }
  });
  test("restart clears pending replays and rejects old acknowledgements", () => {
    let s = bankedTurn();
    const old = s.replays[1]!.id;
    s = act(s, "restart", 0, "elisabeth");
    expect(s.replays).toEqual([null, null, null]);
    expect(s.replaySessions).toEqual([null, null, null]);
    expect(s.game.best).toEqual([2, 0, 0]);
    expect(s.history).toHaveLength(4);
    expect(() => act(s, "finish-replay", 0, "elisabeth", { replayId: old })).toThrow("no longer available");
    s = act(s, "roll"); s = act(s, "bank");
    expect(s.replays[1]?.id).toBe("2:1");
    expect(s.replays[1]?.events).toHaveLength(2);
  });
  test("wrong recipient, wrong replay and malformed inputs cannot acknowledge a turn", () => {
    const s = bankedTurn(), replayId = s.replays[1]!.id;
    expect(() => act(s, "start-replay", 0, "david", { replayId })).toThrow("no longer available");
    expect(() => act(s, "start-replay", 0, "elisabeth", { replayId: "1:999" })).toThrow("no longer available");
    expect(() => parseCommand(move(s, "start-replay", "elisabeth"))).toThrow("Invalid replay");
    expect(() => parseCommand({ ...move(s, "start-replay", "elisabeth", { replayId }), reducedMotion: "false" })).toThrow("Invalid replay");
  });
  test("lost responses retry idempotently and reduced motion has a bounded shorter duration", () => {
    let s = bankedTurn(), now = s.availableAt + 5000;
    const replayId = s.replays[1]!.id;
    expect(replayDuration(s.replays[1]!, true)).toBeLessThan(replayDuration(s.replays[1]!));
    const start = move(s, "start-replay", "elisabeth", { replayId, reducedMotion: true });
    s = applyCommand(s, start, now, 0).state;
    expect(applyCommand(s, start, now + 1000, 0).applied).toBe(false);
    const finish = move(s, "finish-replay", "elisabeth", { replayId });
    now = s.replaySessions[1]!.notBefore;
    s = applyCommand(s, finish, now, 0).state;
    expect(applyCommand(s, finish, now + 1, 0).applied).toBe(false);
    expect(() => act(s, "start-replay", 0, "elisabeth", { replayId })).toThrow("no longer available");
  });
  test("upgrades existing JSON history and preserves current scores, records and match", () => {
    let original = watch(bankedTurn(), "elisabeth");
    original = act(original, "roll", 0, "elisabeth");
    original = act(original, "bank", 0, "elisabeth");
    original = act(original, "restart");
    original = act(original, "roll"); original = act(original, "bank");
    const old = JSON.parse(JSON.stringify(original));
    for (const key of ["turnNumber", "currentTurn", "replays", "replayAcknowledged", "replaySessions"]) delete old[key];
    const migrated = validateState(old);
    expect(migrated.history).toEqual(original.history);
    expect(migrated.game).toEqual(original.game);
    expect(migrated.match).toBe(2);
    expect(migrated.replays[1]?.id).toEqual(original.replays[1]?.id);
    expect(migrated.currentTurn).toEqual(original.currentTurn);
    expect(needsReplay(migrated, 1)).toBe(true);
    expect(validateState(migrated)).toEqual(migrated);
  });
});

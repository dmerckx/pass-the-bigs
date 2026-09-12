import { describe, expect, test } from "bun:test";
import { JOINT_COUNTS, POSES, SAMPLE_SIZE, TOUCHING_COUNT, outcomeForTicket, scorePoses } from "../src/rules";
import { bankTurn, decodeSave, encodeSave, newGame, resolveRoll } from "../src/game";

describe("published scoring and measured probabilities", () => {
  test("all 36 pairs match the published scoring matrix", () => {
    const scores = [[1,0,5,5,10,15],[0,1,5,5,10,15],[5,5,20,10,15,20],
      [5,5,10,20,15,20],[10,10,15,15,40,25],[15,15,20,20,25,60]];
    POSES.forEach((a, i) => POSES.forEach((b, j) => {
      expect(scorePoses(a, b).points).toBe(scores[i]![j]!);
      expect(scorePoses(a, b, true).kind).toBe("oinker");
    }));
  });
  test("every ticket reproduces the full study exactly, including contact", () => {
    const counts = Array.from({ length: 6 }, () => Array(6).fill(0));
    let contact = 0;
    for (let ticket = 0; ticket < SAMPLE_SIZE; ticket++) {
      const result = outcomeForTicket(ticket);
      if (result.kind === "oinker") contact++;
      else counts[POSES.indexOf(result.poses[0])]![POSES.indexOf(result.poses[1])]++;
    }
    expect(counts).toEqual(JOINT_COUNTS.map(row => [...row]));
    expect(contact).toBe(TOUCHING_COUNT);
    expect(JOINT_COUNTS.flat().reduce<number>((a, b) => a + b, 0) + contact).toBe(6000);
  });
  test("invalid inputs cannot silently skew sampling", () => {
    for (const bad of [-1, 6000, 0.5, NaN, Infinity]) expect(() => outcomeForTicket(bad)).toThrow();
  });
});

describe("two-player game and saved high scores", () => {
  test("reroll totals accumulate until banking passes the turn", () => {
    const first = resolveRoll(newGame(), 0);
    const second = resolveRoll(first, 0);
    expect(first.turn).toBe(1);
    expect(second.turn).toBe(2);
    const banked = bankTurn(second);
    expect(banked.scores).toEqual([2, 0]);
    expect(banked.best).toEqual([2, 0]);
    expect(banked.active).toBe(1);
    expect(banked.turn).toBe(0);
    expect(banked.lastTicket).toBe(0);
  });
  test("Pig Out clears only the current turn", () => {
    const game = newGame();
    game.scores = [30, 20]; game.turn = 25;
    const next = resolveRoll(game, 573);
    expect(next.scores).toEqual([30, 20]);
    expect(next.turn).toBe(0);
    expect(next.active).toBe(1);
  });
  test("Oinker clears current player's game score but preserves records", () => {
    const game = newGame(); game.scores = [45, 20]; game.turn = 30; game.best = [90, 80];
    const next = resolveRoll(game, 5999);
    expect(next.scores).toEqual([0, 20]);
    expect(next.best).toEqual([90, 80]);
    expect(next.turn).toBe(0);
    expect(next.active).toBe(1);
  });
  test("reaching 100 banks, wins once, and keeps records across rematches", () => {
    const game = newGame(); game.scores[0] = 99;
    const won = resolveRoll(game, 0);
    expect(won.winner).toBe(0);
    expect(won.scores[0]).toBe(100);
    expect(won.wins).toEqual([1, 0]);
    expect(resolveRoll(won, 0)).toBe(won);
    expect(bankTurn(won)).toBe(won);
    const rematch = newGame(won);
    expect(rematch.scores).toEqual([0, 0]);
    expect(rematch.best).toEqual([100, 0]);
    expect(rematch.wins).toEqual([1, 0]);
  });
  test("reload during a toss resolves the reserved ticket exactly once", () => {
    const game = newGame(); game.turn = 20;
    const restored = decodeSave(encodeSave(game, 573));
    expect(restored.turn).toBe(0);
    expect(restored.active).toBe(1);
    expect(decodeSave(encodeSave(restored))).toEqual(restored);
  });
  test("corrupted storage recovers to an immediately playable game", () => {
    for (const raw of [null, "{bad", "null", '{"version":1}', encodeSave({...newGame(), scores: [-1, 0]})]) {
      expect(decodeSave(raw)).toEqual(newGame());
    }
  });
});

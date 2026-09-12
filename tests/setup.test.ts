import { describe, expect, test } from "bun:test";
import { applyCommand, initialState, validateState, snapshot } from "../server/model";
import { parseCommand } from "../server/handler";
import { openState, sealState } from "../server/storage";
import { COLOR_IDS, SKIN_IDS } from "../src/palette";
import type { Command, PlayerId } from "../src/shared";

let serial = 0;
function setup(player: PlayerId = "david", fields: Partial<Command> = {}): Command {
  return { id: `player-setup-test-${++serial}`, player, expectedRevision: 0, kind: "setup", color: "blue", skin: "pink", ...fields };
}
describe("first-visit player setup", () => {
  test("new players must choose a valid appearance before rolling", () => {
    const state = initialState();
    expect(state.profiles.david.completed).toBe(false);
    expect(state.profiles.elisabeth.completed).toBe(false);
    expect(() => applyCommand(state, setup("david", { kind: "roll", strength: .5 }), 10_000, 0)).toThrow("Choose your color");
    for (const color of COLOR_IDS) for (const skin of SKIN_IDS) {
      const ready = applyCommand(state, parseCommand(setup("david", { color, skin })), 10_000, 0).state;
      expect(ready.profiles.david).toEqual({ color, skin, completed: true });
      expect(ready.gameRevision).toBe(0);
      expect(ready.history).toHaveLength(0);
      expect(applyCommand(ready, setup("david", { kind: "roll", strength: .5 }), 10_000, 0).state.game.turn).toBe(1);
    }
  });
  test("each player owns their preferences and claimed colors remain distinct", () => {
    let state = applyCommand(initialState(), setup("elisabeth", { color: "amber", skin: "brown" }), 10_000, 0).state;
    expect(state.profiles.david.completed).toBe(false);
    expect(() => applyCommand(state, setup("david", { color: "amber" }), 10_000, 0)).toThrow("That color was just picked");
    state = applyCommand(state, setup("david", { color: "plum", skin: "white" }), 10_000, 0).state;
    expect(state.profiles.elisabeth).toEqual({ completed: true, color: "amber", skin: "brown" });
    expect(state.profiles.david).toEqual({ completed: true, color: "plum", skin: "white" });
    expect(() => applyCommand(state, setup(), 10_000, 0)).toThrow("already set up");
  });
  test("choices survive refreshes, uncertain retries and a maintenance reset", () => {
    const command = setup("david", { color: "amber", skin: "brown" });
    let state = applyCommand(initialState(), command, 10_000, 0).state;
    expect(applyCommand(state, command, 20_000, 0).applied).toBe(false);
    state = openState(sealState(state, "test-secret"), "test-secret");
    expect(snapshot(state).profiles.david).toEqual({ completed: true, color: "amber", skin: "brown" });
    state = applyCommand(state, setup("david", { kind: "restart" }), 20_000, 0).state;
    expect(state.profiles.david.completed).toBe(true);
    expect(state.profiles.david.skin).toBe("brown");
    expect(state.match).toBe(2);
  });
  test("invalid choices, public resets and manual nudges are rejected", () => {
    for (const fields of [{ color: "green" }, { skin: "rainbow" }, { completed: true, skin: null }, { kind: "restart" }, { kind: "nudge" }]) {
      expect(() => parseCommand({ ...setup(), ...fields })).toThrow();
    }
  });
  test("old saved matches gain setup without discarding scores or old history", () => {
    const state = initialState();
    state.game.scores = [28, 16];
    const legacy = JSON.parse(JSON.stringify(state));
    delete legacy.profiles; delete legacy.turnNotice;
    legacy.lastNudge = { id: "legacy", to: "david", from: "elisabeth", at: 1 };
    const migrated = validateState(legacy);
    expect(migrated.game.scores).toEqual([28, 16]);
    expect(migrated.profiles.david.completed).toBe(false);
    expect(migrated.profiles.elisabeth.completed).toBe(false);
    expect(migrated.turnNotice).toBeNull();
    expect(JSON.stringify(snapshot(migrated))).not.toContain("lastNudge");
    expect(() => validateState({ ...migrated, profiles: { ...migrated.profiles, david: { color: "invalid" } } })).toThrow("preferences");
  });
});

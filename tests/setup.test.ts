import { describe, expect, test } from "bun:test";
import { applyCommand, initialState, migrateRoster, validateState } from "../server/model";
import { parseCommand } from "../server/handler";
import { openState, sealState } from "../server/storage";
describe("assigned player appearance", () => {
  test("David stays blue, Elisabeth pink/plum, and Ine amber with brown pigs", () => {
    const s = initialState();
    expect(s.profiles.david.color).toBe("blue");
    expect(s.profiles.elisabeth.color).toBe("plum");
    expect(s.profiles.ine).toEqual({ color: "amber", skin: "brown", completed: true });
    expect(Object.values(s.profiles).every(p => p.completed)).toBe(true);
    expect(applyCommand(s, { id: "fixed-appearance-roll", player: "david", expectedRevision: 0, kind: "roll", strength: .5 }, 1, 0).state.game.turn).toBe(1);
  });
  test("existing skin choices survive loading and new-match restart", () => {
    let s = initialState(); s.profiles.david.skin = "white";
    s = openState(sealState(s, "appearance-key"), "appearance-key");
    s = applyCommand(s, { id: "fixed-appearance-restart", player: "david", expectedRevision: 0, kind: "restart" }, 1, 0).state;
    expect(s.profiles.david.skin).toBe("white");
    expect(s.profiles.ine.skin).toBe("brown");
  });
  test("older onboarding state upgrades without losing points or requiring cache removal", () => {
    const old = JSON.parse(JSON.stringify(initialState()));
    delete old.rosterVersion; delete old.profiles.ine;
    old.profiles.david.completed = false;
    old.game.scores = [28, 16];
    const s = migrateRoster(validateState(old)).state;
    expect(s.game.scores).toEqual([28, 16, 0]);
    expect(s.profiles.david.completed).toBe(true);
    expect(s.profiles.ine.completed).toBe(true);
  });
  test("invalid choices and manual nudges stay rejected", () => {
    for (const fields of [{ color: "green" }, { skin: "rainbow" }, { kind: "nudge" }]) {
      expect(() => parseCommand({ id: "invalid-appearance-command", player: "david", expectedRevision: 0, kind: "setup", color: "blue", skin: "pink", ...fields })).toThrow();
    }
  });
});

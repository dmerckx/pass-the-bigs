import { expect, test } from "bun:test";
import { idleAnimations, IDLE_IDS } from "../src/idle";
import { makePlayerSlice, showSlice } from "../src/tableau";
import { outcomeForTicket } from "../src/rules";
test("waiting animations restore the real landing and do not change pig collision geometry", () => {
  for (const id of IDLE_IDS) {
    const slice = makePlayerSlice(); showSlice(slice, outcomeForTicket(5941));
    const original = slice.pigs.map(pig => ({ position: pig.group.position.clone(), rotation: pig.group.quaternion.clone(), children: pig.group.children.length, support: pig.support.length }));
    const rootChildren = slice.root.children.length;
    const animation = idleAnimations[id](slice);
    for (const seconds of [0, .5, 2, 7, 13]) animation.update(seconds, false);
    animation.update(0, true);
    const reduced = slice.pigs.map(pig => pig.group.matrix.clone());
    slice.pigs.forEach(pig => pig.group.updateMatrix());
    const positions = slice.pigs.map(pig => pig.group.position.clone());
    animation.update(10, true);
    slice.pigs.forEach((pig, i) => expect(pig.group.position.equals(positions[i]!)).toBe(true));
    animation.dispose();
    expect(slice.root.children.length).toBe(rootChildren);
    slice.pigs.forEach((pig, i) => {
      expect(pig.group.children.length).toBe(original[i]!.children);
      expect(pig.support.length).toBe(original[i]!.support);
      expect(pig.group.position.equals(original[i]!.position)).toBe(true);
      expect(pig.group.quaternion.equals(original[i]!.rotation)).toBe(true);
    });
  }
});

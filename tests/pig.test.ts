import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { makePig, floorHeight, poseRotation } from "../src/pig";
import { applyFlight, strengthForHold, tossSettings, type Flight } from "../src/toss";
import { POSES } from "../src/rules";

const pig = makePig(0xf0b8ad);
describe("geometry and animation agree with scoring poses", () => {
  test("rare poses actually rest on the named body parts", () => {
    expect(pig.contacts.snouter).toContain("snout");
    expect(pig.contacts.snouter).toContain("front-hoof");
    expect(pig.contacts.jowler).toContain("ear");
    expect(pig.contacts.jowler).toContain("front-hoof");
    expect(pig.contacts.jowler).toContain("snout");
  });
  test("all six poses have at least three ground contacts and never penetrate", () => {
    for (const pose of POSES) {
      const rotation = poseRotation(pig, pose, 0.4), height = floorHeight(pig, rotation);
      const ys = pig.support.map(p => p.clone().applyQuaternion(rotation).y + height);
      expect(Math.min(...ys)).toBeGreaterThanOrEqual(-1e-6);
      expect(ys.filter(y => y < 1e-5).length).toBeGreaterThanOrEqual(3);
    }
  });
  test("dot-up and dot-down really expose opposite sides", () => {
    const dot = new THREE.Vector3(0, 0, 1);
    expect(dot.clone().applyQuaternion(pig.rotations["dot-up"]).y).toBeGreaterThan(0.95);
    expect(dot.clone().applyQuaternion(pig.rotations["dot-down"]).y).toBeLessThan(-0.95);
  });
  test("strength changes motion but all powers land on the identical pose", () => {
    for (const strength of [0, 0.5, 1]) for (const pose of POSES) {
      const to = poseRotation(pig, pose, 0.5);
      const flight: Flight = {
        start: new THREE.Vector3(-1.5, 1, 0), end: new THREE.Vector3(1.5, floorHeight(pig, to), 0),
        from: new THREE.Quaternion(), to, spinAxis: new THREE.Vector3(1, 0.3, 0.5).normalize(),
        bend: 0.2, settings: tossSettings(strength),
      };
      for (let step = 0; step <= 100; step++) {
        applyFlight(pig, flight, step / 100);
        expect(pig.group.position.y - floorHeight(pig, pig.group.quaternion)).toBeGreaterThanOrEqual(-1e-6);
      }
      expect(pig.group.quaternion.angleTo(to)).toBeLessThan(1e-6);
      expect(pig.group.position.distanceTo(flight.end)).toBeLessThan(1e-6);
    }
  });
  test("hold strength is bounded and reduced motion remains short", () => {
    expect(strengthForHold(-10)).toBe(0);
    expect(strengthForHold(700)).toBe(0.5);
    expect(strengthForHold(5000)).toBe(1);
    expect(tossSettings(1).height).toBeGreaterThan(tossSettings(0).height);
    expect(tossSettings(1).revolutions).toBeGreaterThan(tossSettings(0).revolutions);
    expect(tossSettings(1, true).revolutions).toBe(0);
    expect(tossSettings(1, true).duration).toBeLessThan(600);
  });
});

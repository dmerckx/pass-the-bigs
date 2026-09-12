import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { makePig, floorHeight, poseRotation } from "../src/pig";
import { applyFlight, tossCameraZoom, strengthForHold, tossSettings, type Flight } from "../src/toss";
import { POSES } from "../src/rules";

const pig = makePig(0xf0b8ad);
describe("geometry and animation agree with scoring poses", () => {
  test("rare poses actually rest on the named body parts", () => {
    expect(pig.contacts.razorback).toContain("body");
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

test("hard throws keep every pose visible on wide and narrow tables", () => {
  const camera = new THREE.OrthographicCamera(-5, 5, 3, -3, 0.1, 80);
  camera.position.set(3.5, 6, 8.5);
  camera.lookAt(new THREE.Vector3(0, 0.65, 0));
  camera.updateMatrixWorld(true);
  for (const [width, height] of [[1200, 420], [360, 280]]) {
    const aspect = width! / height!, vertical = Math.max(5.8, 7.6 / aspect);
    camera.left = -vertical * aspect / 2; camera.right = vertical * aspect / 2;
    camera.top = vertical / 2; camera.bottom = -vertical / 2;
    for (const startPose of POSES) for (const endPose of POSES) {
      const from = poseRotation(pig, startPose, -0.5), to = poseRotation(pig, endPose, -0.5);
      const flight: Flight = {
        start: new THREE.Vector3(-1.6, floorHeight(pig, from), 0.2),
        end: new THREE.Vector3(-1.6, floorHeight(pig, to), 0.2),
        from, to, spinAxis: new THREE.Vector3(1, 0.3, 0.5).normalize(), bend: 0.2, settings: tossSettings(1),
      };
      for (let step = 0; step <= 30; step++) {
        const t = step / 30;
        applyFlight(pig, flight, t);
        camera.zoom = tossCameraZoom(t, flight.settings);
        camera.updateProjectionMatrix();
        let maxX = 0, maxY = 0;
        for (const point of pig.support) {
          const screen = point.clone().applyQuaternion(pig.group.quaternion).add(pig.group.position).project(camera);
          maxX = Math.max(maxX, Math.abs(screen.x)); maxY = Math.max(maxY, Math.abs(screen.y));
        }
        expect(maxX).toBeLessThan(0.98);
        expect(maxY).toBeLessThan(0.98);
      }
    }
  }
});

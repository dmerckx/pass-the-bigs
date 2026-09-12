import { test, expect } from "bun:test";
import * as THREE from "three";
import { orbitCamera, MIN_POLAR, MAX_POLAR } from "../src/view";
import { makePig, floorHeight, poseRotation } from "../src/pig";
import { applyFlight, tossCameraZoom, tossSettings, type Flight } from "../src/toss";

test("orbit wraps a complete 360 degrees and cannot go under the table", () => {
  const camera = new THREE.OrthographicCamera(), target = new THREE.Vector3(0, .65, 0);
  camera.position.set(3.5, 6, 8.5);
  const initial = camera.position.clone();
  for (let i = 0; i < 72; i++) orbitCamera(camera, target, Math.PI * 2 / 72);
  expect(camera.position.distanceTo(initial)).toBeLessThan(1e-10);
  orbitCamera(camera, target, 0, 100);
  expect(new THREE.Spherical().setFromVector3(camera.position.clone().sub(target)).phi).toBeCloseTo(MAX_POLAR);
  orbitCamera(camera, target, 0, -100);
  expect(new THREE.Spherical().setFromVector3(camera.position.clone().sub(target)).phi).toBeCloseTo(MIN_POLAR);
});
test("hard throws stay visible when viewed from every side on a phone", () => {
  const pig = makePig(0xf0b8ad), aspect = 390 / 560, vertical = Math.max(5.8, 7.6 / aspect);
  const camera = new THREE.OrthographicCamera(-vertical * aspect / 2, vertical * aspect / 2, vertical / 2, -vertical / 2, .1, 80);
  const target = new THREE.Vector3(0, .65, 0);
  camera.position.set(3.5, 6, 8.5);
  for (let angle = 0; angle < 12; angle++) {
    orbitCamera(camera, target, Math.PI / 6);
    for (const sign of [-1, 1]) {
      const from = poseRotation(pig, "trotter", -.5), to = poseRotation(pig, "jowler", .5);
      const flight: Flight = { start: new THREE.Vector3(sign * 1.6, floorHeight(pig, from), .2),
        end: new THREE.Vector3(sign * 1.6, floorHeight(pig, to), .2),
        from, to, spinAxis: new THREE.Vector3(.8,.3,1).normalize(), bend:.2, settings:tossSettings(1) };
      for (let step = 0; step <= 30; step++) {
        const t = step / 30;
        applyFlight(pig, flight, t); camera.zoom = tossCameraZoom(t, flight.settings); camera.updateProjectionMatrix();
        let bound = 0;
        for (const point of pig.support) {
          const p = point.clone().applyQuaternion(pig.group.quaternion).add(pig.group.position).project(camera);
          bound = Math.max(bound, Math.abs(p.x), Math.abs(p.y));
        }
        expect(bound).toBeLessThan(.98);
      }
    }
  }
});

import { expect, test } from "bun:test";
import * as THREE from "three";
import { MIN_POLAR, MAX_POLAR } from "../src/view";
import { floorHeight } from "../src/pig";
import { applyFlight, tossCameraZoom, tossSettings, type Flight } from "../src/toss";
import { outcomeForTicket } from "../src/rules";
import { makePlayerSlice, positionSlice, celebrateSlice, showSlice, restoreSlice, turnAngle, transitionAngle, MIN_TABLE_HEIGHT, MIN_TABLE_WIDTH, sliceDestinations, PLAYER_ANGLE } from "../src/tableau";

function cameraFor(aspect: number, theta: number, phi: number) {
  const vertical = Math.max(MIN_TABLE_HEIGHT, MIN_TABLE_WIDTH / aspect);
  const camera = new THREE.OrthographicCamera(-vertical * aspect / 2, vertical * aspect / 2, vertical / 2, -vertical / 2, .1, 100);
  camera.position.setFromSpherical(new THREE.Spherical(10, phi, theta)).add(new THREE.Vector3(0, .65, 0));
  camera.lookAt(0, .65, 0); camera.updateMatrixWorld(true); return camera;
}
function boundsOnScreen(object: THREE.Object3D, camera: THREE.Camera) {
  object.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(object), points: THREE.Vector3[] = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    points.push(new THREE.Vector3(x, y, z).project(camera));
  }
  return { x: Math.max(...points.map(p => Math.abs(p.x))), y: Math.max(...points.map(p => Math.abs(p.y))) };
}
test("all three pairs fit phone screens throughout a turn rotation at every viewing angle", () => {
  const slices = [makePlayerSlice(), makePlayerSlice(), makePlayerSlice()] as const;
  let maxX = 0, maxY = 0;
  for (const aspect of [320/470, 390/640, 844/220, 920/600]) {
    for (const phi of [MIN_POLAR, .8, MAX_POLAR]) for (let theta = 0; theta < Math.PI * 2; theta += Math.PI / 6) {
      const camera = cameraFor(aspect, theta, phi);
      for (let step = 0; step <= 12; step++) {
        const angle = transitionAngle(0, PLAYER_ANGLE, step / 12);
        for (const i of [0, 1, 2] as const) {
          positionSlice(slices[i].root, i, angle, camera);
          for (const pig of slices[i].pigs) {
            const box = boundsOnScreen(pig.group, camera); maxX = Math.max(maxX, box.x); maxY = Math.max(maxY, box.y);
          }
        }
      }
    }
  }
  expect(maxX).toBeLessThan(1);
  expect(maxY).toBeLessThan(1);
  const camera = cameraFor(390/640, 0, .8);
  positionSlice(slices[0].root, 0, 0, camera); positionSlice(slices[1].root, 1, 0, camera);
  expect(slices[0].root.scale.x).toBe(1);
  expect(slices[1].root.scale.x).toBeCloseTo(.22);
  positionSlice(slices[0].root, 0, PLAYER_ANGLE, camera); positionSlice(slices[1].root, 1, PLAYER_ANGLE, camera);
  expect(slices[0].root.scale.x).toBeCloseTo(.22);
  expect(slices[1].root.scale.x).toBe(1);
});
test("turn rotations progress continuously across repeated switches", () => {
  let angle = 0;
  for (let turn = 1; turn <= 20; turn++) {
    const player = (turn % 3) as 0 | 1 | 2, next = turnAngle(angle, player);
    expect(next - angle).toBeCloseTo(PLAYER_ANGLE);
    expect(transitionAngle(angle, next, 0)).toBe(angle);
    expect(transitionAngle(angle, next, 1)).toBe(next);
    angle = next;
  }
});
test("a full-power toss stays in frame with the other slice behind it", () => {
  const slice = makePlayerSlice(), target = sliceDestinations(slice, outcomeForTicket(5941)), settings = tossSettings(1);
  let maxX = 0, maxY = 0;
  for (const phi of [MIN_POLAR, MAX_POLAR]) for (let theta = 0; theta < Math.PI * 2; theta += Math.PI / 4) {
    const camera = cameraFor(320/470, theta, phi);
    slice.pigs.forEach((pig, i) => {
      const flight: Flight = { start: slice.resting[i]!.position.clone(), end: target[i]!.position, from: slice.resting[i]!.rotation.clone(),
        to: target[i]!.rotation, settings, spinAxis: new THREE.Vector3(.7, .2, -.4).normalize(), bend: .45 };
      for (let t = 0; t <= 1.001; t += .04) {
        applyFlight(pig, flight, t); camera.zoom = tossCameraZoom(t, settings); camera.updateProjectionMatrix();
        positionSlice(slice.root, 0, 0, camera);
        const bounds = boundsOnScreen(pig.group, camera); maxX = Math.max(maxX, bounds.x); maxY = Math.max(maxY, bounds.y);
      }
    });
  }
  expect(maxX).toBeLessThan(1); expect(maxY).toBeLessThan(1);
});
test("winners dance above the felt, losers show tears, and restarting clears both reactions", () => {
  const winner = makePlayerSlice(), loser = makePlayerSlice();
  let maxX = 0, maxY = 0;
  const camera = cameraFor(390/640, .6, .8);
  for (let t = 0; t < 7; t += .07) {
    celebrateSlice(winner, true, t, false); celebrateSlice(loser, false, t, false);
    positionSlice(winner.root, 0, 0, camera, true); positionSlice(loser.root, 1, 0, camera, true);
    for (const slice of [winner, loser]) for (const pig of slice.pigs) {
      expect(pig.group.position.y).toBeGreaterThanOrEqual(floorHeight(pig, pig.group.quaternion) - 1e-8);
      const bounds = boundsOnScreen(pig.group, camera); maxX = Math.max(maxX, bounds.x); maxY = Math.max(maxY, bounds.y);
    }
  }
  expect(winner.tears.every(group => !group.visible)).toBe(true);
  expect(loser.tears.every(group => group.visible)).toBe(true);
  expect(maxX).toBeLessThan(1); expect(maxY).toBeLessThan(1);
  showSlice(winner, null); showSlice(loser, null);
  expect(loser.tears.every(group => !group.visible)).toBe(true);
  for (const slice of [winner, loser]) for (const [i, pig] of slice.pigs.entries()) {
    expect(pig.group.position.equals(slice.resting[i]!.position)).toBe(true);
    expect(pig.group.quaternion.equals(slice.resting[i]!.rotation)).toBe(true);
  }
});
test("reduced-motion end states stay still and cosmetic reactions preserve saved landing poses", () => {
  const slice = makePlayerSlice(); showSlice(slice, outcomeForTicket(5977));
  const resting = slice.resting.map(landing => ({ position: landing.position.clone(), rotation: landing.rotation.clone() }));
  for (const won of [true, false]) {
    celebrateSlice(slice, won, .1, true);
    const positions = slice.pigs.map(pig => pig.group.position.clone()), rotations = slice.pigs.map(pig => pig.group.quaternion.clone());
    celebrateSlice(slice, won, 20, true);
    slice.pigs.forEach((pig, i) => {
      expect(pig.group.position.equals(positions[i]!)).toBe(true);
      expect(pig.group.quaternion.equals(rotations[i]!)).toBe(true);
    });
  }
  restoreSlice(slice);
  slice.pigs.forEach((pig, i) => {
    expect(pig.group.position.equals(resting[i]!.position)).toBe(true);
    expect(pig.group.quaternion.equals(resting[i]!.rotation)).toBe(true);
  });
});

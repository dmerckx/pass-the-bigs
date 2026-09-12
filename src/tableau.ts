import * as THREE from "three";
import { makePig, floorHeight, poseRotation, setPigSkin, type Pig } from "./pig";
import { COLOR_PALETTES, type PlayerProfile } from "./palette";
import type { Outcome } from "./rules";
import type { PlayerIndex } from "./game";

export type Landing = { position: THREE.Vector3; rotation: THREE.Quaternion };
export type PlayerSlice = {
  root: THREE.Group; pigs: [Pig, Pig]; felt: THREE.MeshStandardMaterial; rim: THREE.MeshBasicMaterial;
  tears: [THREE.Group, THREE.Group]; resting: Landing[]; appearance: string;
};
export const SLICE_RADIUS = 3.85;
export const MIN_TABLE_HEIGHT = 9.8, MIN_TABLE_WIDTH = 10;
export const SWITCH_MS = 900;
export function makePlayerSlice(): PlayerSlice {
  const root = new THREE.Group(), felt = new THREE.MeshStandardMaterial({ color: 0x244661, roughness: 1 });
  const rim = new THREE.MeshBasicMaterial({ color: 0x8aadc9, transparent: true, opacity: .5, side: THREE.DoubleSide });
  const edge = new THREE.MeshStandardMaterial({ color: 0x292739, roughness: .7 });
  const disk = new THREE.Mesh(new THREE.CylinderGeometry(SLICE_RADIUS, SLICE_RADIUS, .22, 96), [edge, felt, edge]);
  disk.position.y = -.11; disk.receiveShadow = true; root.add(disk);
  const ring = new THREE.Mesh(new THREE.RingGeometry(SLICE_RADIUS - .18, SLICE_RADIUS - .155, 96), rim);
  ring.rotation.x = -Math.PI / 2; ring.position.y = .002; root.add(ring);
  const pigs: [Pig, Pig] = [makePig(0xf0b8ad), makePig(0xf0b8ad)];
  const tears = pigs.map(pig => {
    root.add(pig.group);
    const drops = new THREE.Group();
    const geometry = new THREE.SphereGeometry(.075, 10, 8);
    const material = new THREE.MeshBasicMaterial({ color: 0x87ddff, transparent: true, opacity: .95 });
    for (let i = 0; i < 6; i++) {
      const drop = new THREE.Mesh(geometry, material); drop.scale.set(.85, 1.65, .85); drops.add(drop);
    }
    drops.visible = false; pig.group.add(drops); return drops;
  }) as [THREE.Group, THREE.Group];
  const slice: PlayerSlice = { root, pigs, tears, felt, rim, resting: [], appearance: "" };
  showSlice(slice, null);
  return slice;
}
export function setSliceAppearance(slice: PlayerSlice, profile: Pick<PlayerProfile, "color" | "skin">) {
  const key = `${profile.color}:${profile.skin}`;
  if (slice.appearance === key) return;
  slice.appearance = key;
  const palette = COLOR_PALETTES[profile.color];
  slice.felt.color.setHex(palette.felt); slice.rim.color.setHex(palette.rim);
  slice.pigs.forEach(pig => setPigSkin(pig, profile.skin));
}
const random = (low: number, high: number) => low + Math.random() * (high - low);
export function sliceDestinations(slice: PlayerSlice, outcome: Outcome | null, variation = false): Landing[] {
  return slice.pigs.map((pig, i) => {
    const touching = outcome?.kind === "oinker";
    const rotation = poseRotation(pig, outcome?.poses[i] ?? "trotter",
      touching ? 0 : (i === 0 ? -.5 : .45) + (variation ? random(-.22, .22) : 0));
    return { rotation, position: new THREE.Vector3(
      touching ? 0 : (i === 0 ? -1.6 : 1.6) + (variation ? random(-.08, .08) : 0),
      floorHeight(pig, rotation),
      touching ? (i === 0 ? -.47 : .47) : (i === 0 ? .2 : -.2) + (variation ? random(-.1, .1) : 0),
    ) };
  });
}
export function restoreSlice(slice: PlayerSlice) {
  slice.pigs.forEach((pig, i) => {
    pig.group.position.copy(slice.resting[i]!.position);
    pig.group.quaternion.copy(slice.resting[i]!.rotation);
    pig.group.scale.setScalar(1);
    pig.materials.skin.emissive.setHex(0);
    slice.tears[i]!.visible = false;
    slice.tears[i]!.children.forEach(drop => drop.position.set(0, 0, 0));
  });
}
export function showSlice(slice: PlayerSlice, outcome: Outcome | null) {
  slice.resting = sliceDestinations(slice, outcome);
  restoreSlice(slice);
}
const ease = (t: number) => { const v = THREE.MathUtils.clamp(t, 0, 1); return v * v * (3 - 2 * v); };
export function turnAngle(current: number, player: PlayerIndex) {
  let target = player * Math.PI;
  while (target < current - .001) target += Math.PI * 2;
  return target;
}
/** Two floating table slices orbit each other; the rear slice stays readable at every camera azimuth. */
export function positionSlice(root: THREE.Group, player: PlayerIndex, angle: number, camera: THREE.OrthographicCamera, celebration = false) {
  const phase = player * Math.PI - angle, rear = (1 - Math.cos(phase)) / 2;
  const scale = THREE.MathUtils.lerp(1, celebration ? .36 : .22, rear);
  camera.updateMatrixWorld();
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
  const towardCamera = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 2);
  root.position.set(0, .65, 0).add(right.multiplyScalar(Math.sin(phase) * 2.7));
  root.position.addScaledVector(up, THREE.MathUtils.lerp(-1.15, celebration ? 3.25 : 3.55, rear) / camera.zoom);
  root.position.addScaledVector(towardCamera, -rear * 4.8);
  root.scale.setScalar(scale);
  root.rotation.y = phase;
  root.updateMatrixWorld(true);
  return rear;
}
export function transitionAngle(from: number, to: number, progress: number) {
  return THREE.MathUtils.lerp(from, to, ease(progress));
}
/** Expressions are cosmetic and never touch the authoritative roll or scoring state. */
export function celebrateSlice(slice: PlayerSlice, won: boolean, seconds: number, reducedMotion: boolean) {
  slice.pigs.forEach((pig, i) => {
    const beat = seconds * 5 + i * Math.PI;
    const turn = reducedMotion ? 0 : Math.floor(seconds / 5) * Math.PI * 2 + ease((seconds % 5 - 3.6) / 1.2) * Math.PI * 2;
    const yaw = (i === 0 ? -.5 : .45) + (won ? turn + (reducedMotion ? 0 : Math.sin(beat / 2) * .3) : 0);
    pig.group.quaternion.copy(poseRotation(pig, "trotter", yaw));
    const lean = won ? (reducedMotion ? 0 : Math.sin(beat) * .17) : -.13 + (reducedMotion ? 0 : Math.sin(beat * 3) * .025);
    pig.group.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), lean));
    pig.group.position.set((i === 0 ? -1.6 : 1.6) + (won && !reducedMotion ? Math.sin(beat) * .13 : 0),
      floorHeight(pig, pig.group.quaternion) + (won && !reducedMotion ? Math.abs(Math.sin(beat)) * .42 : 0), i === 0 ? .2 : -.2);
    pig.group.scale.setScalar(1);
    const tears = slice.tears[i]!; tears.visible = !won;
    tears.children.forEach((drop, j) => {
      const fall = reducedMotion ? (j % 3) / 3 : (seconds * 1.25 + (j % 3) / 3) % 1;
      drop.position.set(.9 + fall * .16, .18 - fall * .78, (j < 3 ? -1 : 1) * (.36 + fall * .28));
    });
  });
}

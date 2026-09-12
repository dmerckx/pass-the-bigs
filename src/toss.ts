import * as THREE from "three";
import { floorHeight, type Pig } from "./pig";

export const MAX_HOLD_MS = 1400;
export function strengthForHold(milliseconds: number) {
  return Math.min(1, Math.max(0, milliseconds / MAX_HOLD_MS));
}
export function tossSettings(strength: number, reducedMotion = false) {
  const power = Math.max(0, Math.min(1, strength));
  return {
    duration: reducedMotion ? 520 : 1450 + power * 900,
    height: reducedMotion ? 0.22 : 1.1 + power * 2.1,
    revolutions: reducedMotion ? 0 : 1 + Math.floor(power * 3),
    bounce: reducedMotion ? 0.03 : 0.13 + power * 0.32,
  };
}
export type Flight = {
  start: THREE.Vector3; end: THREE.Vector3;
  from: THREE.Quaternion; to: THREE.Quaternion;
  spinAxis: THREE.Vector3; bend: number; settings: ReturnType<typeof tossSettings>;
};
const ease = (x: number) => x * x * (3 - 2 * x);
export function applyFlight(pig: Pig, flight: Flight, progress: number) {
  const t = Math.max(0, Math.min(1, progress));
  // Complete the ballistic tumble before contact; impact never changes the outcome.
  const air = Math.min(1, t / 0.7), travel = ease(air);
  pig.group.quaternion.slerpQuaternions(flight.from, flight.to, ease(Math.min(1, t / 0.82)));
  const spin = new THREE.Quaternion().setFromAxisAngle(flight.spinAxis, 2 * Math.PI * flight.settings.revolutions * ease(air));
  pig.group.quaternion.premultiply(spin);
  if (t > 0.7) {
    const bounceT = (t - 0.7) / 0.3;
    const wobble = Math.sin(bounceT * Math.PI * 4) * Math.pow(1 - bounceT, 2) * 0.16;
    pig.group.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(flight.spinAxis, wobble));
  }
  pig.group.position.lerpVectors(flight.start, flight.end, travel);
  pig.group.position.z += Math.sin(Math.PI * air) * flight.bend;
  const elevation = t <= 0.7
    ? 4 * air * (1 - air) * flight.settings.height
    : Math.abs(Math.sin((t - 0.7) / 0.3 * Math.PI * 3)) * Math.pow(1 - (t - 0.7) / 0.3, 2) * flight.settings.bounce;
  pig.group.position.y = floorHeight(pig, pig.group.quaternion) + elevation;
  if (t === 1) {
    pig.group.quaternion.copy(flight.to);
    pig.group.position.copy(flight.end);
    pig.group.position.y = floorHeight(pig, flight.to);
  }
}

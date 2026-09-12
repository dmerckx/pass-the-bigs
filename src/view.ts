import * as THREE from "three";
export const MIN_POLAR = 0.5, MAX_POLAR = 1.15;
export function orbitCamera(camera: THREE.Camera, target: THREE.Vector3, radians: number, vertical = 0) {
  const orbit = new THREE.Spherical().setFromVector3(camera.position.clone().sub(target));
  orbit.theta += radians;
  orbit.phi = THREE.MathUtils.clamp(orbit.phi + vertical, MIN_POLAR, MAX_POLAR);
  camera.position.setFromSpherical(orbit).add(target);
  camera.lookAt(target); camera.updateMatrixWorld(true);
}

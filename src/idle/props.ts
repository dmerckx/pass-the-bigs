import * as THREE from "three";
import { floorHeight, poseRotation } from "../pig";
import { restoreSlice, type PlayerSlice } from "../tableau";
import type { Pose } from "../rules";
export type IdleAnimation = { update: (seconds: number, reduced: boolean) => void; dispose: () => void };
export type IdleFactory = (slice: PlayerSlice) => IdleAnimation;
export function propsFor(slice: PlayerSlice) {
  const objects: THREE.Object3D[] = [], hidden: THREE.Object3D[] = [];
  function add<T extends THREE.Object3D>(object: T, parent: THREE.Object3D = slice.root): T {
    parent.add(object); objects.push(object); return object;
  }
  function material(color: number, opacity = 1) { return new THREE.MeshStandardMaterial({ color, roughness: .65, transparent: opacity < 1, opacity }); }
  function mesh(geometry: THREE.BufferGeometry, color: number, position: [number, number, number], parent: THREE.Object3D = slice.root, opacity = 1) {
    const object = new THREE.Mesh(geometry, material(color, opacity)); object.position.set(...position);
    object.castShadow = true; object.receiveShadow = true; return add(object, parent);
  }
  function ball(color: number, position: [number, number, number], scale: [number, number, number], parent: THREE.Object3D = slice.root) {
    const object = mesh(new THREE.SphereGeometry(1, 16, 10), color, position, parent); object.scale.set(...scale); return object;
  }
  function tube(points: number[][], color: number, radius: number, parent: THREE.Object3D = slice.root) {
    const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(p[0]!, p[1]!, p[2]!)));
    return mesh(new THREE.TubeGeometry(curve, 24, radius, 8, false), color, [0, 0, 0], parent);
  }
  function pose(index: number, x: number, z: number, yaw = 0, lean = 0, bounce = 0, resting: Pose = "trotter") {
    const pig = slice.pigs[index]!;
    pig.group.scale.setScalar(1);
    pig.group.quaternion.copy(poseRotation(pig, resting, yaw));
    pig.group.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), lean));
    pig.group.position.set(x, floorHeight(pig, pig.group.quaternion) + bounce, z);
    pig.materials.skin.emissive.setHex(0); slice.tears[index]!.visible = false;
  }
  function hideEyes() { for (const pig of slice.pigs) pig.group.traverse(node => { if (node.name === "eye" || node.name === "eye-highlight") { hidden.push(node); node.visible = false; } }); }
  function dispose() {
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
    for (const object of objects) {
      if (object instanceof THREE.Mesh) { geometries.add(object.geometry); (Array.isArray(object.material) ? object.material : [object.material]).forEach(m => materials.add(m)); }
      object.removeFromParent();
    }
    geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
    hidden.forEach(node => { node.visible = true; }); restoreSlice(slice);
  }
  return { add, mesh, ball, tube, pose, hideEyes, dispose };
}

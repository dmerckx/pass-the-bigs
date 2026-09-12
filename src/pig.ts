import * as THREE from "three";
import { ConvexHull } from "three/addons/math/ConvexHull.js";
import type { Pose } from "./rules";

export type Pig = {
  group: THREE.Group;
  support: THREE.Vector3[];
  rotations: Record<Pose, THREE.Quaternion>;
  contacts: Record<Pose, string[]>;
};
const Y = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);

export function makePig(color: number): Pig {
  const group = new THREE.Group();
  const skin = new THREE.MeshPhysicalMaterial({
    color, roughness: 0.34, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.4,
  });
  const pink = new THREE.MeshStandardMaterial({ color: 0xd27e86, roughness: 0.6 });
  const hoof = new THREE.MeshStandardMaterial({ color: 0xb36d77, roughness: 0.55 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x302526, roughness: 0.32 });
  const shine = new THREE.MeshBasicMaterial({ color: 0xfff6ed });
  const sphere = new THREE.SphereGeometry(1, 28, 18);
  function ellipsoid(name: string, position: number[], scale: number[], material: THREE.Material = skin) {
    const mesh = new THREE.Mesh(sphere, material);
    mesh.name = name;
    mesh.position.set(position[0]!, position[1]!, position[2]!);
    mesh.scale.set(scale[0]!, scale[1]!, scale[2]!);
    mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  }
  ellipsoid("body", [0, 0, 0], [0.87, 0.46, 0.47]);
  ellipsoid("head", [0.68, 0.04, 0], [0.49, 0.39, 0.37]);
  ellipsoid("cheek", [0.85, -0.10, 0], [0.38, 0.27, 0.36]);
  ellipsoid("snout", [1.17, -0.015, 0], [0.24, 0.24, 0.28]);
  ellipsoid("snout", [1.35, -0.02, 0], [0.045, 0.205, 0.245], pink);
  for (const side of [-1, 1]) {
    ellipsoid("nostril", [1.391, 0.015, side * 0.105], [0.009, 0.045, 0.032], dark);
    ellipsoid("eye", [0.86, 0.21, side * 0.292], [0.073, 0.072, 0.051], dark);
    ellipsoid("eye-highlight", [0.875, 0.233, side * 0.334], [0.019, 0.022, 0.013], shine);
    for (const x of [-0.53, 0.59]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.12, 0.37, 14), skin);
      leg.position.set(x, -0.43, side * 0.285);
      leg.castShadow = true; leg.receiveShadow = true; leg.name = "leg";
      group.add(leg);
      ellipsoid(x > 0 ? "front-hoof" : "rear-hoof", [x + 0.025, -0.645, side * 0.285], [0.15, 0.078, 0.155], hoof);
      // A recessed-looking cloven split on the front of each trotter.
      ellipsoid("hoof-split", [x + 0.156, -0.656, side * 0.285], [0.008, 0.042, 0.012], dark);
    }
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.23, 0.52, 3, 1), skin);
    ear.name = "ear";
    ear.position.set(0.53, 0.53, side * 0.31);
    ear.rotation.set(side * 0.46, Math.PI / 2, -0.35);
    ear.castShadow = true; group.add(ear);
    const inner = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.34, 3, 1), pink);
    inner.name = "inner-ear"; inner.position.copy(ear.position).add(new THREE.Vector3(0.045, 0.03, side * 0.025));
    inner.rotation.copy(ear.rotation); group.add(inner);
  }
  // One unmistakable black flank dot: +Z is the marked side.
  ellipsoid("dot", [-0.19, 0.07, 0.458], [0.105, 0.106, 0.016], dark);
  const curl: THREE.Vector3[] = [];
  for (let i = 0; i <= 42; i++) {
    const t = i / 42, angle = t * Math.PI * 3.6;
    curl.push(new THREE.Vector3(-0.82 - t * 0.36, 0.13 + Math.sin(angle) * 0.105, Math.cos(angle) * 0.105));
  }
  const tail = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(curl), 42, 0.039, 7, false), skin);
  tail.name = "tail"; tail.castShadow = true; group.add(tail);

  group.updateMatrixWorld(true);
  const points: THREE.Vector3[] = [], tags = new Map<THREE.Vector3, string>();
  group.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    const vertices = node.geometry.getAttribute("position");
    for (let i = 0; i < vertices.count; i++) {
      const point = new THREE.Vector3().fromBufferAttribute(vertices, i).applyMatrix4(node.matrixWorld);
      points.push(point); tags.set(point, node.name);
    }
  });
  const hull = new ConvexHull().setFromPoints(points);
  const support = [...new Set(hull.faces.flatMap(face => {
    const vertices: THREE.Vector3[] = [];
    let edge = face.edge;
    do { vertices.push(edge.head().point); edge = edge.next; } while (edge !== face.edge);
    return vertices;
  }))];
  const normals: Record<Pose, THREE.Vector3> = {
    "dot-up": new THREE.Vector3(0, 0, -1),
    "dot-down": new THREE.Vector3(0, 0, 1),
    trotter: new THREE.Vector3(0, -1, 0),
    razorback: new THREE.Vector3(0, 1, 0),
    snouter: new THREE.Vector3(0.59, -0.81, 0).normalize(),
    jowler: new THREE.Vector3(0.72, 0.08, 0.69).normalize(),
  };
  const rotations = {} as Record<Pose, THREE.Quaternion>;
  const contacts = {} as Record<Pose, string[]>;
  for (const pose of Object.keys(normals) as Pose[]) {
    const faces = hull.faces.map(face => {
      const names: string[] = [];
      let edge = face.edge;
      do { names.push(tags.get(edge.head().point)!); edge = edge.next; } while (edge !== face.edge);
      const score = face.normal.dot(normals[pose]);
      return { face, names, score };
    });
    // Select a real supporting face. Rare positions must touch their named
    // anatomy instead of freezing an arbitrary rotation above the table.
    const candidates = pose === "snouter"
      ? faces.filter(f => f.names.includes("snout") && f.names.includes("front-hoof"))
      : pose === "jowler"
        ? faces.filter(f => f.names.includes("ear") && f.names.includes("front-hoof") && f.names.includes("snout"))
        : pose === "razorback"
          ? faces.filter(f => f.names.includes("body"))
          : faces;
    const chosen = (candidates.length ? candidates : faces).sort((a, b) => b.score - a.score)[0]!;
    rotations[pose] = new THREE.Quaternion().setFromUnitVectors(chosen.face.normal, DOWN);
    contacts[pose] = chosen.names;
  }
  return { group, support, rotations, contacts };
}
export function floorHeight(pig: Pick<Pig, "support">, rotation: THREE.Quaternion): number {
  // Dotting with inverse-rotated up avoids allocating every rotated vertex.
  const up = Y.clone().applyQuaternion(rotation.clone().invert());
  let lowest = Infinity;
  for (const point of pig.support) lowest = Math.min(lowest, point.dot(up));
  return -lowest;
}
export function poseRotation(pig: Pig, pose: Pose, yaw: number): THREE.Quaternion {
  return new THREE.Quaternion().setFromAxisAngle(Y, yaw).multiply(pig.rotations[pose]);
}

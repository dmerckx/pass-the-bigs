import * as THREE from "three";
import { MIN_POLAR, MAX_POLAR } from "../src/view";
import { MIN_TABLE_HEIGHT, MIN_TABLE_WIDTH, positionSlice } from "../src/tableau";
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

test("all waiting props stay inside a phone viewport while orbiting", () => {
  let widest=0, tallest=0;
  for (const id of IDLE_IDS) {
    const slice=makePlayerSlice(), floor=new Set<THREE.Object3D>(slice.root.children.filter(child=>child instanceof THREE.Mesh));
    const animation=idleAnimations[id](slice);
    for (const aspect of [320/470,390/640]) for (const phi of [MIN_POLAR,MAX_POLAR]) {
      const vertical=Math.max(MIN_TABLE_HEIGHT,MIN_TABLE_WIDTH/aspect);
      const camera=new THREE.OrthographicCamera(-vertical*aspect/2,vertical*aspect/2,vertical/2,-vertical/2,.1,100);
      for (let theta=0;theta<Math.PI*2;theta+=Math.PI/2) for (const seconds of [0,.5,2,6]) {
        camera.position.setFromSpherical(new THREE.Spherical(10,phi,theta)).add(new THREE.Vector3(0,.65,0));
        camera.lookAt(0,.65,0); camera.updateMatrixWorld(true);
        animation.update(seconds,false); positionSlice(slice.root,0,0,camera);
        for (const object of slice.root.children) {
          if (floor.has(object) || !object.visible) continue;
          const box=new THREE.Box3().setFromObject(object);
          for (const x of [box.min.x,box.max.x]) for (const y of [box.min.y,box.max.y]) for (const z of [box.min.z,box.max.z]) {
            const screen=new THREE.Vector3(x,y,z).project(camera);
            widest=Math.max(widest,Math.abs(screen.x)); tallest=Math.max(tallest,Math.abs(screen.y));
          }
        }
      }
    }
    animation.dispose();
  }
  expect(widest).toBeLessThan(1); expect(tallest).toBeLessThan(1);
});

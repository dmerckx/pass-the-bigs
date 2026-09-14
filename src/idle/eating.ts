import * as THREE from "three";
import { propsFor, type IdleFactory } from "./props";
export const eating: IdleFactory = slice => {
  const p = propsFor(slice), tray = p.add(new THREE.Group());
  tray.position.set(.8, .12, 0);
  p.mesh(new THREE.BoxGeometry(1.25,.13,3), 0x90b9c1, [0,0,0], tray);
  for (const z of [-1.5, 1.5]) p.mesh(new THREE.BoxGeometry(1.35,.25,.09), 0xbdd9de, [0,.04,z], tray);
  for (const x of [-.66,.66]) p.mesh(new THREE.BoxGeometry(.09,.25,3.1), 0xbdd9de, [x,.04,0], tray);
  const crumbs: THREE.Mesh[] = [];
  for (let i = 0; i < 22; i++) {
    const x = Math.sin(i*7)*.45, z = Math.cos(i*11)*1.3;
    p.ball(i % 3 ? 0xe99a48 : 0x91b765, [x,.13,z], [.13,.095,.1], tray);
  }
  for (let i = 0; i < 2; i++) {
    const carrot = p.mesh(new THREE.ConeGeometry(.16,.6,12), 0xf29947, [.15,.2,i ? .95 : -.95], tray);
    carrot.rotation.z = Math.PI / 2;
    p.ball(0x78a86a, [.45,.22,i ? .95 : -.95], [.16,.07,.09], tray);
    crumbs.push(p.ball(0xf6c579, [.8,.3,i ? .95 : -.95], [.07,.05,.06]));
  }
  return { dispose: p.dispose, update(seconds, reduced) {
    const t = reduced ? 0 : seconds;
    slice.pigs.forEach((_, i) => {
      const chew = Math.sin(t*5+i*2);
      p.pose(i, -.95, i ? .95 : -.95, 0, -.27 + chew*.045);
      crumbs[i]!.position.set(.54, .25 + Math.abs(chew)*.15, i ? .95 : -.95);
      crumbs[i]!.visible = reduced || chew > .3;
    });
  } };
};

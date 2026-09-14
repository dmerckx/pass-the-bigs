import * as THREE from "three";
import { propsFor, type IdleFactory } from "./props";
export const drinking: IdleFactory = slice => {
  const p = propsFor(slice), outline = new THREE.Shape();
  const points = Array.from({ length: 25 }, (_, i) => {
    const a = i / 24 * Math.PI * 2, wave = 1 + Math.sin(a*3)*.07;
    return new THREE.Vector2(.6 + Math.cos(a)*1.15*wave, Math.sin(a)*1.9*wave);
  });
  outline.moveTo(points[0]!.x, points[0]!.y); outline.splineThru(points.slice(1)); outline.closePath();
  const water = p.mesh(new THREE.ShapeGeometry(outline, 40), 0x73c9dd, [0,.025,0], slice.root, .7);
  water.rotation.x = -Math.PI/2; water.castShadow = false;
  const rings: THREE.Mesh[] = [];
  for (const z of [-.95,.95]) for (let j = 0; j < 3; j++) {
    const ring = p.mesh(new THREE.RingGeometry(.21,.23,40), 0xc0edf5, [.65,.032,z], slice.root, .65);
    ring.rotation.x = -Math.PI/2; ring.castShadow = false; ring.userData.step = j; rings.push(ring);
  }
  const drops = [-.95,.95].map(z => p.ball(0xbeeef6, [.7,.15,z], [.045,.07,.045]));
  return { dispose: p.dispose, update(seconds, reduced) {
    const t = reduced ? 0 : seconds;
    slice.pigs.forEach((_, i) => p.pose(i, -.55, i ? .95 : -.95, 0, reduced ? 0 : Math.sin(t*3+i)*.018, 0, "snouter"));
    rings.forEach(ring => {
      const phase = reduced ? ring.userData.step/3 : (t*.55 + ring.userData.step/3)%1;
      ring.scale.setScalar(.4 + phase*2.1); (ring.material as THREE.Material).opacity = .65*(1-phase);
    });
    drops.forEach((drop, i) => {
      const sip = reduced ? .4 : (t*1.5 + i*.5)%1;
      drop.position.y = .07 + Math.sin(sip*Math.PI)*.18; drop.visible = reduced || sip < .75;
    });
  } };
};

import * as THREE from "three";
import { propsFor, type IdleFactory } from "./props";
export const music: IdleFactory = slice => {
  const p = propsFor(slice);
  const notes: THREE.Group[] = [];
  for (const [i, pig] of slice.pigs.entries()) {
    p.tube([[.57,.22,-.49],[.57,.7,-.47],[.57,.86,0],[.57,.7,.47],[.57,.22,.49]], 0x293042, .085, pig.group);
    for (const side of [-1, 1]) {
      p.ball(0x293042, [.57,.24,side*.49], [.25,.29,.115], pig.group);
      p.ball(0x8ed1cf, [.57,.24,side*.58], [.17,.2,.05], pig.group);
    }
    for (let j = 0; j < 3; j++) {
      const note = p.add(new THREE.Group()); notes.push(note);
      p.ball(j % 2 ? 0xf7cf7b : 0x96ddd5, [0,0,0], [.1,.065,.04], note);
      p.mesh(new THREE.BoxGeometry(.025,.35,.035), 0xf7cf7b, [.07,.15,0], note);
      p.mesh(new THREE.BoxGeometry(.15,.035,.035), 0xf7cf7b, [.13,.31,0], note).rotation.z = -.3;
      note.userData = { pig: i, step: j };
    }
  }
  return { dispose: p.dispose, update(seconds, reduced) {
    const t = reduced ? 0 : seconds;
    slice.pigs.forEach((_, i) => p.pose(i, i ? 1.5 : -1.5, 0, i ? .35 : -.35, Math.sin(t*3.5+i)*.045, Math.abs(Math.sin(t*3.5+i))*.035));
    notes.forEach(note => {
      const phase = reduced ? note.userData.step / 3 : (t*.3 + note.userData.step/3) % 1;
      note.position.set((note.userData.pig ? 1.5 : -1.5) + .3 + Math.sin(phase*5)*.25, 1.2 + phase*1.35, -.15);
      note.scale.setScalar(.8 + phase*.4);
    });
  } };
};

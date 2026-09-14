import * as THREE from "three";
import { propsFor, type IdleFactory } from "./props";
export const sleeping: IdleFactory = slice => {
  const p=propsFor(slice), snores: THREE.Group[]=[];
  p.hideEyes();
  for (const [i,pig] of slice.pigs.entries()) {
    // Small closed eyelids follow the face even while lying on a flank.
    for (const side of [-1,1]) p.tube([[.79,.215,side*.344],[.86,.19,side*.35],[.93,.215,side*.344]],0x49383a,.016,pig.group);
    p.ball(i ? 0xc2b2d2 : 0xa6c6d2,[(i ? 1.45 : -1.45)+.6,.085,0],[.65,.085,.5]);
    for (let j=0;j<3;j++) {
      const letter=p.add(new THREE.Group()); letter.userData={pig:i,step:j}; snores.push(letter);
      for (const y of [-.12,.12]) p.mesh(new THREE.BoxGeometry(.21,.03,.025),0xdbe3ef,[0,y,0],letter);
      const diagonal=p.mesh(new THREE.BoxGeometry(.027,.29,.025),0xdbe3ef,[0,0,0],letter); diagonal.rotation.z=-.62;
    }
  }
  return { dispose:p.dispose, update(seconds,reduced) {
    const t=reduced ? 0 : seconds;
    slice.pigs.forEach((pig,i)=> {
      p.pose(i,i ? 1.45 : -1.45,0,0,0,.07,"dot-up");
      const breath=reduced ? 1 : 1+Math.sin(t*1.4+i)*.016;
      pig.group.scale.set(1,breath,1); pig.group.position.y*=breath;
    });
    snores.forEach(letter=> {
      const phase=reduced ? letter.userData.step/3 : (t*.2+letter.userData.step/3)%1;
      letter.position.set((letter.userData.pig ? 1.45 : -1.45)+.7+phase*.25,1+phase*1.25,.1);
      letter.scale.setScalar(.55+phase*.55);
    });
  } };
};

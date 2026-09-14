import * as THREE from "three";
import { propsFor, type IdleFactory } from "./props";
export const sunbathing: IdleFactory = slice => {
  const p=propsFor(slice);
  for (const [i,pig] of slice.pigs.entries()) {
    const x=i ? 1.45 : -1.45;
    p.mesh(new THREE.BoxGeometry(2.6,.035,1.55),i ? 0xefb98b : 0x91c8cf,[x,.019,0]);
    for (let stripe=0;stripe<6;stripe++) p.mesh(new THREE.BoxGeometry(.12,.008,1.5),0xf4ead6,[x-1+stripe*.4,.042,0]);
    for (const side of [-1,1]) {
      p.ball(0xe8c779,[.875,.225,side*.35],[.145,.12,.055],pig.group);
      p.ball(0x253340,[.88,.228,side*.395],[.12,.095,.026],pig.group);
      p.tube([[.85,.27,side*.39],[.63,.29,side*.4],[.47,.23,side*.34]],0xe8c779,.026,pig.group);
    }
    p.tube([[.9,.24,-.36],[1.03,.23,0],[.9,.24,.36]],0xe8c779,.024,pig.group);
  }
  p.mesh(new THREE.BoxGeometry(.28,.44,.2),0xf5ca71,[0,.24,1.5]);
  p.mesh(new THREE.BoxGeometry(.2,.1,.17),0xf3eee0,[0,.51,1.5]);
  p.ball(0xe89851,[0,.29,1.61],[.075,.075,.012]);
  return { dispose:p.dispose, update(seconds,reduced) {
    const t=reduced ? 0 : seconds;
    slice.pigs.forEach((_,i)=>p.pose(i,i ? 1.45 : -1.45,0,0,Math.sin(t*.75+i)*.015,.055,"razorback"));
  } };
};

import * as THREE from "three";
import { propsFor, type IdleFactory } from "./props";
export const reading: IdleFactory = slice => {
  const p=propsFor(slice), pages: THREE.Group[]=[];
  for (let i=0;i<2;i++) {
    const book=p.add(new THREE.Group()); book.position.set(.85,.16,i ? .98 : -.98);
    for (const side of [-1,1]) {
      const half=p.add(new THREE.Group(),book); half.position.z=side*.32; half.rotation.x=side*.14;
      p.mesh(new THREE.BoxGeometry(.96,.055,.66),i ? 0xc38473 : 0x6f9cae,[0,0,0],half);
      p.mesh(new THREE.BoxGeometry(.87,.045,.6),0xf4e9d2,[0,.04,0],half);
      for (let row=0;row<6;row++) p.mesh(new THREE.BoxGeometry(.018,.008,row%3 ? .43 : .3),0xb6a992,[-.32+row*.125,.067,0],half);
    }
    p.mesh(new THREE.BoxGeometry(.98,.07,.06),0xa57553,[0,.005,0],book);
    const page=p.add(new THREE.Group(),book); page.position.y=.086;
    p.mesh(new THREE.BoxGeometry(.87,.018,.6),0xfff7e3,[0,0,.31],page); pages.push(page);
    p.mesh(new THREE.BoxGeometry(.09,.012,.25),0xcb6b69,[.2,.074,.7],book);
  }
  return { dispose:p.dispose, update(seconds,reduced) {
    const t=reduced ? 0 : seconds;
    slice.pigs.forEach((_,i)=>p.pose(i,-.85,i ? .98 : -.98,0,-.18+Math.sin(t*.9+i)*.025));
    pages.forEach((page,i)=> {
      const cycle=reduced ? 0 : (t+i*2)%7;
      const turn=Math.max(0,Math.min(1,(cycle-4.8)/1.6));
      page.rotation.x=-Math.PI*turn;
      page.visible=cycle<6.45;
    });
  } };
};

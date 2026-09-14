import * as THREE from "three";
import { propsFor, type IdleFactory } from "./props";
export const jumping: IdleFactory = slice => {
  const p = propsFor(slice), outline = new THREE.Shape();
  const points = Array.from({ length: 33 }, (_, i) => {
    const a = i/32*Math.PI*2, wobble = 1+Math.sin(a*5)*.045;
    return new THREE.Vector2(Math.cos(a)*3.2*wobble, Math.sin(a)*1.45*wobble);
  });
  outline.moveTo(points[0]!.x,points[0]!.y); outline.splineThru(points.slice(1)); outline.closePath();
  const mud = p.mesh(new THREE.ShapeGeometry(outline,40),0x62432f,[0,.028,0]); mud.rotation.x=-Math.PI/2; mud.castShadow=false;
  const splashes: THREE.Mesh[] = [];
  for (let i=0;i<2;i++) {
    for (let j=0;j<10;j++) {
      const drop=p.ball(j%2 ? 0x99704a : 0x765234,[0,.1,0],[.07,.11,.065]);
      drop.userData={pig:i,step:j}; splashes.push(drop);
    }
    for (const side of [-1,1]) p.ball(0x795434,[-.35,.05,side*.467],[.16,.12,.018],slice.pigs[i]!.group);
  }
  return { dispose:p.dispose, update(seconds,reduced) {
    const t=reduced ? 0 : seconds;
    slice.pigs.forEach((_,i)=> {
      const hop=reduced ? 0 : Math.max(0,Math.sin(t*3+i*.8));
      p.pose(i,i ? 1.45 : -1.45,0,i ? .2 : -.2,0,hop*.8+.03);
    });
    splashes.forEach(drop=> {
      const {pig,step}=drop.userData, angle=step/10*Math.PI*2;
      const phase=reduced ? .18 : (t*.95+pig*.27)%1;
      const spread=.22+phase*1.1;
      drop.position.set((pig ? 1.45 : -1.45)+Math.cos(angle)*spread,.045+Math.sin(phase*Math.PI)*(.3+(step%3)*.12),Math.sin(angle)*spread);
      drop.scale.set(.07*(1-phase*.6),.1*(1-phase*.6),.065*(1-phase*.6));
      drop.visible=reduced || phase<.8;
    });
  } };
};

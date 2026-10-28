// Bounded circular (Dubins CSC) spiral candidates with tangent lead-in/out.
// This is deliberately separate from short-route bows: a spiral has a radius,
// a turn budget and 3D clearance, not an unconstrained lateral displacement.
import * as T from 'three';
import { fitConnectorElevation } from './road-connector-elevation.js';
const TAU=2*Math.PI,mod=x=>(x%TAU+TAU)%TAU;
const left=v=>new T.Vector3(-v.z,0,v.x);
function directions(anchor,toward){
  const t=new T.Vector3(anchor.tangent.x,0,anchor.tangent.z).normalize();
  if(anchor.end!==undefined)return[t.multiplyScalar(anchor.end===0?-1:1)];
  const n=anchor.outwardNormal?new T.Vector3(anchor.outwardNormal.x,0,anchor.outwardNormal.z).normalize():left(t);
  if(!anchor.outwardNormal&&n.dot(toward)<0)n.negate();
  return [-1,1].map(sign=>n.clone().multiplyScalar(.6).addScaledVector(t,.8*sign).normalize());
}
function appendLine(points,a,b){
  const n=Math.max(1,Math.ceil(a.distanceTo(b)/1.5));for(let i=1;i<=n;i++)points.push(a.clone().lerp(b,i/n));
}
function appendArc(points,center,start,angle,sign,radius){
  const n=Math.max(1,Math.ceil(angle*radius/1.5));for(let i=1;i<=n;i++){const theta=start+sign*angle*i/n;points.push(new T.Vector3(center.x+radius*Math.cos(theta),0,center.z+radius*Math.sin(theta)));}
}
// Nonlocal road strips need clearance, not only non-crossing centre lines.
// Neighbouring stations belong to the same continuous piece and are exempt.
export function connectorSelfClearance(points,stations,halfWidth,clearance=5.5){
  const width=2*halfWidth+.5;
  for(let i=1;i<points.length;i++)for(let j=i+2;j<points.length;j++){
    if(stations[j-1]-stations[i]<width+2)continue;
    const a=points[i-1],b=points[i],c=points[j-1],d=points[j];
    const ux=b.x-a.x,uz=b.z-a.z,vx=d.x-c.x,vz=d.z-c.z,wx=a.x-c.x,wz=a.z-c.z;
    const aa=ux*ux+uz*uz,bb=ux*vx+uz*vz,cc=vx*vx+vz*vz,dd=ux*wx+uz*wz,ee=vx*wx+vz*wz,den=aa*cc-bb*bb;
    if(aa<1e-12||cc<1e-12)continue;
    let s=T.MathUtils.clamp(den>1e-12?(bb*ee-cc*dd)/den:0,0,1),t=(bb*s+ee)/cc;
    if(t<0){t=0;s=T.MathUtils.clamp(-dd/aa,0,1);}else if(t>1){t=1;s=T.MathUtils.clamp((bb-dd)/aa,0,1);}
    const dx=wx+s*ux-t*vx,dz=wz+s*uz-t*vz,dy=a.y+s*(b.y-a.y)-c.y-t*(d.y-c.y);
    if(Math.abs(dy)<clearance&&Math.hypot(dx,dz)<width)return false;
  }
  return true;
}
export function automaticSpiralPath(a,b,{halfWidth=2.5,maxGrade=.18,halfExtent=160,terrainHeight=null,accept=()=>true}={}){
  const A=new T.Vector3(...a.position).setY(0),B=new T.Vector3(...b.position).setY(0),delta=B.clone().sub(A);
  const rise=Math.abs(a.position[1]-b.position[1]);
  if(rise<5.5)throw new Error('螺旋连接需要足够层间高差（至少 5.5m），否则上下层可能穿插。');
  const minimum=Math.max(12,halfWidth*3,rise/(TAU*maxGrade));let best=null;
  for(const radius of [minimum,minimum*1.4,minimum*2,minimum*2.8])for(const factor of [1.2,2.4]){
    const lead=radius*factor+Math.max(a.deckHalf||0,b.deckHalf||0)+halfWidth;
    for(const da of directions(a,delta))for(const db of directions(b,delta.clone().negate())){
      const P=A.clone().addScaledVector(da,lead),Q=B.clone().addScaledVector(db,lead),end=db.clone().negate();
      for(const s1 of [-1,1])for(const s2 of [-1,1]){
        const c1=P.clone().addScaledVector(left(da),s1*radius),c2=Q.clone().addScaledVector(left(end),s2*radius),v=c2.clone().sub(c1),d=v.length(),k=(s1-s2)*radius/d;
        if(d<.1||Math.abs(k)>=1)continue;
        const theta=Math.atan2(v.z,v.x)+Math.asin(k),u=new T.Vector3(Math.cos(theta),0,Math.sin(theta)),n=left(u);
        const t1=c1.clone().addScaledVector(n,-s1*radius),t2=c2.clone().addScaledVector(n,-s2*radius);
        const start1=Math.atan2(P.z-c1.z,P.x-c1.x),end1=Math.atan2(t1.z-c1.z,t1.x-c1.x),start2=Math.atan2(t2.z-c2.z,t2.x-c2.x),end2=Math.atan2(Q.z-c2.z,Q.x-c2.x);
        const arc1=mod(s1*(end1-start1)),arc2=mod(s2*(end2-start2));
        for(const extra of [0,1,2]){
          const turn1=arc1+(extra===1?TAU:0),turn2=arc2+(extra===2?TAU:0),turn=turn1+turn2;
          if(turn<1.5*Math.PI||turn>4*Math.PI+.001)continue;
          const expected=lead*2+radius*turn+t1.distanceTo(t2);
          if(expected>600||best&&expected>=best.length)continue;
          const points=[A.clone()];appendLine(points,A,P);appendArc(points,c1,start1,turn1,s1,radius);appendLine(points,t1,t2);appendArc(points,c2,start2,turn2,s2,radius);appendLine(points,Q,B);
          const stations=[0];let valid=true;
          for(let i=0;i<points.length;i++){
            const p=points[i];if(Math.max(Math.abs(p.x),Math.abs(p.z))+halfWidth>halfExtent){valid=false;break;}
            if(i){const distance=p.distanceTo(points[i-1]);if(distance<1e-4){valid=false;break;}stations.push(stations.at(-1)+distance);}
          }
          if(!valid)continue;
          const elevation=fitConnectorElevation(points,stations,a,b,{halfWidth,maxGrade,terrainHeight,leadDistance:lead});
          if(!elevation||!connectorSelfClearance(points,stations,halfWidth)||!accept(points,stations,halfWidth))continue;
          best={points:points.map(p=>p.toArray()),...elevation,length:stations.at(-1),score:stations.at(-1),minRadius:radius,spiralRadius:radius,totalTurn:turn,turns:turn/TAU,shape:'spiral',clearance:5.5,nominalHeadroom:4.5};
        }
      }
    }
  }
  if(!best)throw new Error('当前接点周围没有满足螺旋半径、坡度、占地与 5.5m 设计标高间隔的路线。请换接点或腾出空间；原道路未修改。');
  return best;
}

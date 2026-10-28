import * as THREE from 'three';
import { subtractRoadPrism } from './road-prism-clip.js';

import { roadDesignHeight as designHeight, endpointRoadContact } from './road-contact.js';
export class FreewayLaneCurve extends THREE.Curve {
  constructor(source,offset){super();this.source=source;this.offset=offset;}
  getPoint(t,target=new THREE.Vector3()){
    const p=this.source.getPointAt(t),d=this.source.getTangentAt(Math.max(1e-6,Math.min(1-1e-6,t))).setY(0).normalize();
    return target.set(p.x+d.z*this.offset,designHeight(this.source,t),p.z-d.x*this.offset);
  }
  getPointAt(t,target){return this.getPoint(t,target);}
  getTangentAt(t,target=new THREE.Vector3()){const a=this.getPoint(Math.max(0,t-1e-5)),b=this.getPoint(Math.min(1,t+1e-5));return target.copy(b).sub(a).normalize();}
  getSpacedPoints(n=60){return Array.from({length:n+1},(_,i)=>this.getPointAt(i/n));}
}
function refine(lane,branch,ta,tb){
  for(let k=0;k<18;k++){
    const a=lane.getPointAt(ta),b=branch.getPointAt(tb),dx=b.x-a.x,dz=b.z-a.z;
    if(Math.hypot(dx,dz)<1e-5)break;
    const e=1e-5,a0=lane.getPointAt(Math.max(0,ta-e)),a1=lane.getPointAt(Math.min(1,ta+e)),b0=branch.getPointAt(Math.max(0,tb-e)),b1=branch.getPointAt(Math.min(1,tb+e));
    const da=Math.min(1,ta+e)-Math.max(0,ta-e),db=Math.min(1,tb+e)-Math.max(0,tb-e);
    const ax=(a1.x-a0.x)/da,az=(a1.z-a0.z)/da,bx=(b1.x-b0.x)/db,bz=(b1.z-b0.z)/db,den=ax*bz-az*bx;
    if(Math.abs(den)<1e-9)break;
    const nextA=THREE.MathUtils.clamp(ta+(dx*bz-dz*bx)/den,0,1),nextB=THREE.MathUtils.clamp(tb+(dx*az-dz*ax)/den,0,1);
    if(Math.abs(nextA-ta)+Math.abs(nextB-tb)<1e-10)break;ta=nextA;tb=nextB;
  }
  const a=lane.getPointAt(ta),b=branch.getPointAt(tb);return{ta,tb,a,b,distance:Math.hypot(a.x-b.x,a.z-b.z)};
}
/** Independent near-carriageway ports. Never use the 20m-wide freeway as a single
 * two-way intersection arm, and never cut an at-grade portal through its median. */
export function freewayConnections(args) {return carriagewayConnections(args);}
// Generated ramp -> ordinary TWO-WAY street: same near-carriageway topology,
// but no invented physical median and no opening through the opposing lane.
export function streetMergeConnections(args){
  const rampNew=args.newType.junctionStyle==='merge',rampOld=args.existing.roadType.junctionStyle==='merge';
  if(rampNew===rampOld)return null;
  const mainType=rampNew?args.existing.roadType:args.newType;
  if(!['asphalt','concrete'].includes(mainType.id))return null;
  return carriagewayConnections(args,{street:true,newMain:!rampNew});
}
function carriagewayConnections({newCurve,newWidth,newType,existing},settings={}) {
  const street=!!settings.street,newMain=settings.newMain??(newType.id==='freeway'),main=newMain?newCurve:existing.curve,branch=newMain?existing.curve:newCurve;
  const branchType=newMain?existing.roadType:newType,branchWidth=newMain?existing.width:newWidth;
  if(branchType.id==='freeway')return [];
  const mainType=newMain?newType:existing.roadType;
  const width=street||mainType.section?(newMain?newWidth:existing.width):Math.max(20,newMain?newWidth:existing.width),medianHalf=street?0:2,laneWidth=(width-2*medianHalf)/2,offset=medianHalf+laneWidth/2,inner=street?.3:2.02;
  const out=[],n=Math.min(256,Math.max(80,Math.ceil(main.getLength()/2))),m=Math.min(256,Math.max(80,Math.ceil(branch.getLength()/2)));
  const B=Array.from({length:m+1},(_,i)=>branch.getPointAt(i/m));
  for(const side of [-1,1]){
    const lane=new FreewayLaneCurve(main,offset*side),A=lane.getSpacedPoints(n),seeds=[];let closest=null;
    for(let i=0;i<=n;i++)for(let j=0;j<=m;j++){
      const dist=Math.hypot(A[i].x-B[j].x,A[i].z-B[j].z);if(!closest||dist<closest.dist)closest={ta:i/n,tb:j/m,dist};
      if(i===n||j===m)continue;
      const ax=A[i+1].x-A[i].x,az=A[i+1].z-A[i].z,bx=B[j+1].x-B[j].x,bz=B[j+1].z-B[j].z,den=ax*bz-az*bx;
      if(Math.abs(den)<1e-9)continue;const dx=B[j].x-A[i].x,dz=B[j].z-A[i].z,u=(dx*bz-dz*bx)/den,v=(dx*az-dz*ax)/den;
      if(u< -1e-8||u>1+1e-8||v< -1e-8||v>1+1e-8)continue;
      const ta=(i+THREE.MathUtils.clamp(u,0,1))/n,tb=(j+THREE.MathUtils.clamp(v,0,1))/m;
      if(!seeds.some(s=>Math.abs(s[0]-ta)<1/n&&Math.abs(s[1]-tb)<1/m))seeds.push([ta,tb]);
    }
    if(!seeds.length && closest && closest.dist<laneWidth/2+branchWidth/2+.5){
      const c=main.getPointAt(closest.ta),d=main.getTangentAt(closest.ta).setY(0).normalize(),p=branch.getPointAt(closest.tb);
      if(((p.x-c.x)*d.z-(p.z-c.z)*d.x)*side>inner)seeds.push([closest.ta,closest.tb]);
    }
    for(const [ta,tb]of seeds){
      const r=refine(lane,branch,ta,tb),md=main.getTangentAt(r.ta).setY(0).normalize(),bd=branch.getTangentAt(r.tb).setY(0).normalize();
      if(r.distance>laneWidth/2+branchWidth/2+.5 || Math.abs(md.x*bd.z-md.z*bd.x)<.08)continue;
      const hA=designHeight(main,r.ta),hB=designHeight(branch,r.tb);
      if(branchType.connectorRouting?.shape==='spiral'&&Math.abs(hA-hB)>.08)continue;
      const endpointContact=endpointRoadContact(branch,r.tb,main,r.ta,width/2,branchWidth/2);
      if(Math.abs(hA-hB)>.08 && !(main._terrainProfile?.follow&&branch._terrainProfile?.follow) && !endpointContact)continue;
      const point=r.a.clone().setY(endpointContact?hA:(hA+hB)/2),origin=main.getPointAt(r.ta),normal={x:md.z*side,z:-md.x*side};
      if(out.some(q=>q.point.distanceTo(point)<.5))continue;
      out.push({point,endpointContact,joinHeight:endpointContact?hA:undefined,tNew:newMain?r.ta:r.tb,tExisting:newMain?r.tb:r.ta,newCurve,existingCurve:existing.curve,newWidth,existingWidth:existing.width,newRoadType:newType,existingRoadType:existing.roadType,
        [street?'streetMerge':'freeway']:{street,graded:Math.abs(designHeight(branch,0)-designHeight(branch,1))>.15,curve:main,laneCurve:lane,width:laneWidth,side,origin:{x:origin.x,z:origin.z},normal,t:r.ta,branchT:r.tb,branchCurve:branch,inner}});
    }
  }
  return out;
}
export function applyFreewayCuts(root,curve,gaps) {
  const seen=new Set();
  for(const gap of gaps){const is=gap.isect,f=is?.freeway||is?.streetMerge;if(!f||seen.has(is))continue;seen.add(is);
    const plan=is.plan;if(!plan)continue;
    const isMain=curve===f.curve;
    let polygons=[plan.hull],lo=gap.t0,hi=gap.t1;
    if(!isMain){
      const n=f.normal,d={x:-n.z,z:n.x};
      const reach=Math.max(8,...plan.hull.map(p=>Math.abs((p.x-f.origin.x)*d.x+(p.z-f.origin.z)*d.z)))+4;
      const bd=curve.getTangentAt(f.branchT).setY(0).normalize();
      const dt=(f.width/2+f.inner*2+4)/Math.max(.08,Math.abs(bd.x*n.x+bd.z*n.z))/Math.max(curve.getLength(),1);lo=f.branchT-dt;hi=f.branchT+dt;
      // Sweep the actual median, not its infinite tangent at the connection. This
      // also prevents a wide branch from reappearing over a curved median.
      const mainDt=reach/Math.max(f.curve.getLength(),1),steps=Math.min(128,Math.max(4,Math.ceil(reach))),stations=[];
      for(let i=0;i<=steps;i++){
        const t=THREE.MathUtils.clamp(f.t-mainDt+2*mainDt*i/steps,0,1),p=f.curve.getPointAt(t),dir=f.curve.getTangentAt(t).setY(0).normalize(),w=f.inner+.03;
        stations.push([{x:p.x+dir.z*w,z:p.z-dir.x*w},{x:p.x-dir.z*w,z:p.z+dir.x*w}]);
      }
      polygons=stations.slice(1).map((s,i)=>[stations[i][0],stations[i][1],s[1],s[0]]);
    }
    const lip=2/Math.max(curve.getLength(),1);
    for(const span of root.children){
      const range=span.userData.roadRange || [span.userData.endpoint,span.userData.endpoint];
      if(range[0]===undefined||range[1]<lo-lip||range[0]>hi+lip)continue;
      if(!isMain&&!f.street&&plan.merge){
        // The original highway owns the whole deck, not just the small core.
        // Remove the ramp's co-level slab/curb/paint under that deck, including
        // the acute wedge outside the hull. Keep genuine lower/upper crossings.
        const reach=Math.max(12,...plan.hull.map(p=>Math.hypot(p.x-f.origin.x,p.z-f.origin.z)))+f.width;
        const steps=Math.max(8,Math.ceil(reach)),dt=reach/Math.max(f.curve.getLength(),1);
        for(let i=0;i<steps;i++){
          const ta=THREE.MathUtils.clamp(f.t-dt+2*dt*i/steps,0,1),tb=THREE.MathUtils.clamp(f.t-dt+2*dt*(i+1)/steps,0,1);
          if(tb-ta<1e-8)continue;
          const a=f.curve.getPointAt(ta),b=f.curve.getPointAt(tb),dir=b.clone().sub(a).setY(0).normalize(),n={x:dir.z*f.side,z:-dir.x*f.side};
          const at=(p,w)=>({x:p.x+n.x*w,z:p.z+n.z*w});
          const poly=[at(a,f.inner),at(a,f.width+2),at(b,f.width+2),at(b,f.inner)],y=designHeight(f.curve,ta),seg=Math.hypot(b.x-a.x,b.z-a.z),grade=(designHeight(f.curve,tb)-y)/(seg||1);
          subtractRoadPrism(span,poly,null,{origin:{x:a.x,y,z:a.z},gradient:{x:dir.x*grade,z:dir.z*grade},below:.3,above:1.6});
        }
      }
      for(const poly of polygons)subtractRoadPrism(span,poly,
        isMain&&f.street&&f.graded?mesh=>mesh.userData.roadRole==='pavement':
        isMain&&!f.street?mesh=>mesh.userData.freewaySide!==f.side||(plan.merge&&['pavement','marking'].includes(mesh.userData.roadRole)):null);
    }
  }
}

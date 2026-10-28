// The road plan is horizontal, but a junction deck must not remain flat when its
// fixed-height approaches are graded. Work in this crossing's owning stations,
// never nearest-XZ on a possibly self-stacked alignment.
function designY(curve,t){
 const p=curve._terrainProfile;if(!p?.follow)return curve.getPointAt(t).y;
 const s=t*(p.points.length-1),i=Math.min(p.points.length-2,Math.floor(s)),f=s-i;
 return p.points[i].y+(p.points[i+1].y-p.points[i].y)*f;
}
export function junctionHeightField(plan,baseHeight=0){
 const C=plan.center,arms=plan.arms.filter(a=>a.curve&&Number.isFinite(a.t)),samples=[];
 if(!arms.length)return null;
 const fields=arms.map(a=>{
  const tan=a.curve.getTangentAt(a.t),scale=a.curve.getLength()*Math.hypot(tan.x,tan.z)/(tan.length()||1),travel=Math.min(Math.max(a.c,...plan.hull.map(p=>(p.x-C.x)*a.dir.x+(p.z-C.z)*a.dir.z))+3,a.available);
  const values=[{u:0,y:baseHeight}];
  for(let i=0;i<=24;i++){
   const t=Math.max(0,Math.min(1,a.t+a.sign*(travel*i/24)/(scale||1))),q=a.curve.getPointAt(t),u=(q.x-C.x)*a.dir.x+(q.z-C.z)*a.dir.z;
   if(u>values.at(-1).u+1e-5){const y=designY(a.curve,t);values.push({u,y});samples.push({x:a.dir.x*u,z:a.dir.z*u,y:y-baseHeight});}
  }
  const at=u=>{if(u<=0)return baseHeight;for(let i=1;i<values.length;i++)if(u<=values[i].u){const l=values[i-1],r=values[i];return l.y+(r.y-l.y)*(u-l.u)/(r.u-l.u);}return values.at(-1).y;};
  let mouth={x:C.x+a.dir.x*a.c,z:C.z+a.dir.z*a.c};
  if(plan.compact){
    let lo=0,hi=travel;for(let i=0;i<32;i++){const u=(lo+hi)/2,t=Math.max(0,Math.min(1,a.t+a.sign*u/(scale||1))),q=a.curve.getPointAt(t);if(plan.insideHull(q))lo=u;else hi=u;}
    const t=Math.max(0,Math.min(1,a.t+a.sign*lo/(scale||1)));mouth=a.curve.getPointAt(t);
  }
  return{a,at,mouth};
 });
 // A merge patch never pulls the host deck toward the ramp's lower grade.
 // Original host pavement owns this footprint; the lower patch is only a filler.
 const wrap=field=>{
  const f=plan.freeway;if(!f||f.street||!plan.merge)return field;
  const curve=f.curve,L=Math.max(1,curve.getLength()),reach=Math.max(12,...plan.arms.map(a=>a.c))+f.width;
  const lo=Math.max(0,f.t-reach/L),hi=Math.min(1,f.t+reach/L),n=24;
  const samples=Array.from({length:n+1},(_,i)=>{const t=lo+(hi-lo)*i/n;return{t,p:curve.getPointAt(t)};});
  return(x,z)=>{
   let best=samples[0],d=Infinity;for(const s of samples){const q=(s.p.x-x)**2+(s.p.z-z)**2;if(q<d){d=q;best=s;}}
   let l=Math.max(lo,best.t-(hi-lo)/n),r=Math.min(hi,best.t+(hi-lo)/n);
   const dist=t=>{const p=curve.getPointAt(t);return (p.x-x)**2+(p.z-z)**2;};
   for(let i=0;i<12;i++){const a=(2*l+r)/3,b=(l+2*r)/3;if(dist(a)<dist(b))r=b;else l=a;}
   const t=(l+r)/2;
   return dist(t)<=(f.width+2+.03)**2?designY(curve,t)-baseHeight:field(x,z);
  };
 };
 if(!samples.some(s=>Math.abs(s.y)>1e-7))return null;
 let xx=0,xz=0,zz=0,xy=0,zy=0;for(const s of samples){xx+=s.x*s.x;xz+=s.x*s.z;zz+=s.z*s.z;xy+=s.x*s.y;zy+=s.z*s.y;}
 const den=xx*zz-xz*xz;
 if(Math.abs(den)>1e-8){const gx=(xy*zz-zy*xz)/den,gz=(zy*xx-xy*xz)/den;
  if(samples.every(s=>Math.abs(s.x*gx+s.z*gz-s.y)<.025))return wrap((x,z)=>(x-C.x)*gx+(z-C.z)*gz);
 }
 // Nonlinear ramps blend from a shared centre to their actual approach heights.
 // A mouth's weight tends to one at its boundary, rather than flattening the deck.
 return wrap((x,z)=>{
  const dx=x-C.x,dz=z-C.z;let sum=0,weight=1/(Math.hypot(dx,dz)+.05)**(plan.compact?12:4);
  for(const {a,at,mouth}of fields){const u=dx*a.dir.x+dz*a.dir.z,v=dx*a.dir.z-dz*a.dir.x;
   const mx=plan.compact?x-mouth.x:dx-a.dir.x*a.c,mz=plan.compact?z-mouth.z:dz-a.dir.z*a.c;
   const distance=Math.hypot(mx*a.dir.x+mz*a.dir.z,Math.max(0,Math.abs(mx*a.dir.z-mz*a.dir.x)-a.half)),w=1/(distance+.05)**(plan.compact?12:4);
   sum+=(at(u)-baseHeight)*w;weight+=w;
  }return sum/weight;
 });
}

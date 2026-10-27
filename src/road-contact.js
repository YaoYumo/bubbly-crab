// Crossing heights are station-specific. Endpoint intent is a separate test:
// a graded ramp may reach a road's edge/centre at the right height even though
// its height at the offset carriageway axis is already lower. Do not relax the
// global crossing-height gate (that would join real overpasses).
export function roadDesignHeight(curve,t){
 const profile=curve._terrainProfile;
 if(!profile?.follow)return curve.getPointAt(t).y;
 const s=t*(profile.points.length-1),i=Math.min(profile.points.length-2,Math.floor(s)),f=s-i;
 return profile.points[i].y+(profile.points[i+1].y-profile.points[i].y)*f;
}
export function endpointRoadContact(branch,tBranch,target,tTarget,targetHalf,branchHalf){
 const bdir=branch.getTangentAt(tBranch).setY(0).normalize(),tdir=target.getTangentAt(tTarget).setY(0).normalize();
 const sin=Math.abs(bdir.x*tdir.z-bdir.z*tdir.x);
 if(sin<.08)return null;
 const reach=(2*targetHalf+2*branchHalf+2)/sin;
 const tangent=branch.getTangentAt(tBranch),horizontalLength=branch.getLength()*Math.hypot(tangent.x,tangent.z);
 const targetTan=target.getTangentAt(tTarget),targetLength=target.getLength()*Math.hypot(targetTan.x,targetTan.z);
 for(const end of [0,1]){
  if(Math.abs(tBranch-end)*horizontalLength>reach)continue;
  const p=branch.getPointAt(end),window=reach/Math.max(1,targetLength),lo=Math.max(0,tTarget-window),hi=Math.min(1,tTarget+window),n=48;
  const distance=t=>{const q=target.getPointAt(t);return (p.x-q.x)**2+(p.z-q.z)**2;};
  let best=lo,dist=Infinity;
  for(let i=0;i<=n;i++){const t=lo+(hi-lo)*i/n,d=distance(t);if(d<dist){dist=d;best=t;}}
  let l=Math.max(lo,best-(hi-lo)/n),r=Math.min(hi,best+(hi-lo)/n);
  for(let i=0;i<32;i++){const a=l+(r-l)/3,b=r-(r-l)/3;if(distance(a)<distance(b))r=b;else l=a;}
  const t=(l+r)/2,q=target.getPointAt(t),dir=target.getTangentAt(t).setY(0).normalize();
  const lateral=Math.abs((p.x-q.x)*dir.z-(p.z-q.z)*dir.x),along=Math.abs((p.x-q.x)*dir.x+(p.z-q.z)*dir.z);
  // Test the finite road's deck, not the infinite tangent or its remote endcap.
  if(lateral>targetHalf+.1||along>.15)continue;
  const height=roadDesignHeight(target,t),delta=Math.abs(roadDesignHeight(branch,end)-height);
  if(delta>.15)continue; // small deck/coordinate rounding tolerance, not metres of elevation clearance
  return{branch,target,end,targetT:t,height,delta};
 }
 return null;
}

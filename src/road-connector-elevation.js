import * as THREE from 'three';

// Keep a complete ramp cross-section on its host deck until it clears the edge.
// A zero slope at just the endpoint does not prevent a sunken/intersecting lip.
export function fitConnectorElevation(points, stations, a, b, {halfWidth, maxGrade, terrainHeight, leadDistance=0}) {
  const A=new THREE.Vector3(...a.position),B=new THREE.Vector3(...b.position),length=stations.at(-1);
  const lead=(anchor,reverse)=>{
    const i0=reverse?points.length-1:0;
    if(!leadDistance&&(anchor.end!==undefined||!anchor.outwardNormal||!Number.isFinite(anchor.deckHalf)))return {s:0,i:i0};
    const n=anchor.outwardNormal,origin=new THREE.Vector3(...anchor.position),need=Number.isFinite(anchor.deckHalf)&&anchor.end===undefined?anchor.deckHalf-(anchor.lateral||0)+halfWidth+.5:0;
    for(let k=0;k<points.length;k++){
      const i=reverse?points.length-1-k:k,p=points[i];
      if((reverse?length-stations[i]:stations[i])>=leadDistance-1e-6&&(!n||((p.x-origin.x)*n.x+(p.z-origin.z)*n.z>=need)))return {s:reverse?length-stations[i]:stations[i],i};
    }
    return {s:Infinity,i:i0};
  };
  const la=lead(a,false),lb=lead(b,true),start=la.s,end=lb.s,run=length-start-end;
  if(!(run>1))return null;
  const deckY=(anchor,p)=>{
    if(anchor.deckHeight)return anchor.deckHeight(p);
    const t=anchor.tangent,h2=t.x*t.x+t.z*t.z||1;
    return anchor.position[1]+((p.x-anchor.position[0])*t.x+(p.z-anchor.position[2])*t.z)*t.y/h2;
  };
  const yA=start?deckY(a,points[la.i]):A.y,yB=end?deckY(b,points[lb.i]):B.y,dy=yB-yA;
  const grade=(anchor,sign)=>anchor.end===undefined?0:anchor.tangent.y/(Math.hypot(anchor.tangent.x,anchor.tangent.z)||1)*sign*(anchor.end===0?-1:1);
  const limit=3*Math.abs(dy)/run,bounded=g=>Math.sign(g)===Math.sign(dy)?Math.sign(g)*Math.min(Math.abs(g),limit):0;
  const leadGrade=(anchor,i)=>{
    const lo=points[Math.max(0,i-1)],hi=points[Math.min(points.length-1,i+1)];
    return (deckY(anchor,hi)-deckY(anchor,lo))/(Math.hypot(hi.x-lo.x,hi.z-lo.z)||1);
  };
  const ga=start?leadGrade(a,la.i):bounded(grade(a,1)),gb=end?leadGrade(b,lb.i):bounded(grade(b,-1));let steepest=0;
  for(let i=0;i<points.length;i++){
    const s=stations[i],t=THREE.MathUtils.clamp((s-start)/run,0,1),t2=t*t,t3=t2*t;
    points[i].y=s<start?deckY(a,points[i]):s>length-end?deckY(b,points[i]):(2*t3-3*t2+1)*yA+(t3-2*t2+t)*run*ga+(-2*t3+3*t2)*yB+(t3-t2)*run*gb;
    if(terrainHeight&&i&&i<points.length-1)points[i].y=Math.max(points[i].y,terrainHeight(points[i].x,points[i].z)+.02);
    if(i)steepest=Math.max(steepest,Math.abs(points[i].y-points[i-1].y)/(s-stations[i-1]));
  }
  points[0].copy(A);points.at(-1).copy(B);
  // Include the exact endpoints after terrain adjustment in the grade check.
  for(const i of [1,points.length-1])steepest=Math.max(steepest,Math.abs(points[i].y-points[i-1].y)/(stations[i]-stations[i-1]));
  return steepest<=maxGrade+.002?{maxGrade:steepest,flatStart:start,flatEnd:end}:null;
}

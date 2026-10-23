// Solid sloping stair cheeks (垂带石): same construction language as the uploaded pagoda.
// Only the stair sides change; callers retain their own treads, landings and materials.
import * as THREE from 'three';
export function addStairCheek(parent,{x,zHigh,zLow,yHigh,yLow,baseY=0,width,material}) {
  if(![x,zHigh,zLow,yHigh,yLow,baseY,width].every(Number.isFinite)||width<=0||Math.abs(zLow-zHigh)<1e-6||yHigh<=yLow||yLow<=baseY)throw Error('Invalid sloping stair cheek profile');
  const length=zLow-zHigh,shape=new THREE.Shape();
  // Shape X becomes -Z after rotating extrusion to X; signed length supports either slope direction.
  shape.moveTo(0,baseY);shape.lineTo(-length,baseY);shape.lineTo(-length,yLow);shape.lineTo(0,yHigh);shape.closePath();
  const geo=new THREE.ExtrudeGeometry(shape,{depth:width,bevelEnabled:false,steps:1,curveSegments:1});
  geo.rotateY(Math.PI/2);geo.translate(-width/2,0,0);
  const p=geo.attributes.position,n=geo.attributes.normal,uv=new Float32Array(p.count*2);
  for(let i=0;i<p.count;i++){
    const ax=Math.abs(n.getX(i)),ay=Math.abs(n.getY(i)),az=Math.abs(n.getZ(i));
    uv[2*i]=(ay>=ax&&ay>=az?p.getX(i):ax>=az?p.getZ(i):p.getX(i))/.85;
    uv[2*i+1]=(ay>=ax&&ay>=az?p.getZ(i):p.getY(i))/.85;
  }
  geo.setAttribute('uv',new THREE.BufferAttribute(uv,2));geo.userData.detFit=1;geo.computeBoundingBox();geo.computeBoundingSphere();
  const mesh=new THREE.Mesh(geo,material);mesh.name='斜边垂带石';mesh.position.set(x,0,zHigh);mesh.castShadow=true;mesh.receiveShadow=true;
  const profile={style:'sloped',x,zHigh,zLow,yHigh,yLow,baseY,width};mesh.userData.stairCheek=profile;
  parent.add(mesh);(parent.userData.stairCheeks ||= []).push({...profile});return mesh;
}

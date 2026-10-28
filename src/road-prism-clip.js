import * as THREE from 'three';

export function prismEdges(polygon) {
  let area=0;for(let i=0;i<polygon.length;i++){const a=polygon[i],b=polygon[(i+1)%polygon.length];area+=a.x*b.z-b.x*a.z;}
  return polygon.map((a,i)=>{const b=polygon[(i+1)%polygon.length],dx=b.x-a.x,dz=b.z-a.z,l=Math.hypot(dx,dz)||1,sign=area>=0?1:-1;return {a,b,n:{x:-dz/l*sign,z:dx/l*sign}};});
}
function split(poly,edge,positionOffset) {
  const inside=[],outside=[],f=v=>(v[positionOffset]-edge.a.x)*edge.n.x+(v[positionOffset+2]-edge.a.z)*edge.n.z+(edge.n.y||0)*(v[positionOffset+1]-(edge.a.y||0));
  for(let i=0;i<poly.length;i++){
    const a=poly[i],b=poly[(i+1)%poly.length],fa=f(a),fb=f(b);
    if(fa>=-1e-8)inside.push(a);if(fa<=1e-8)outside.push(a);
    if((fa>1e-8&&fb< -1e-8)||(fa< -1e-8&&fb>1e-8)){
      const t=fa/(fa-fb),v=a.map((x,k)=>x+(b[k]-x)*t);inside.push(v);outside.push(v);
    }
  }
  return {inside,outside};
}
/** Subtract a convex XZ prism from owned, freshly generated road geometry. Preserve
 * the complete position/normal/UV interpolation and material groups, not just centroids. */
export function subtractRoadPrism(root,polygon,keep=null,heightBand=null) {
  if(polygon.length<3)return;
  const edges=prismEdges(polygon);
  if(heightBand){const {origin,gradient,below,above}=heightBand;
    edges.push({a:{...origin,y:origin.y-below},n:{x:-gradient.x,y:1,z:-gradient.z}},
      {a:{...origin,y:origin.y+above},n:{x:gradient.x,y:-1,z:gradient.z}});
  }
  root.updateWorldMatrix(true,true);
  const minX=Math.min(...polygon.map(p=>p.x)),maxX=Math.max(...polygon.map(p=>p.x)),minZ=Math.min(...polygon.map(p=>p.z)),maxZ=Math.max(...polygon.map(p=>p.z));
  const bounds=new THREE.Box3();
  root.traverse(mesh=>{
    const g=mesh.geometry;if(!mesh.isMesh||mesh.isInstancedMesh||!g?.attributes.position)return;
    if(keep?.(mesh))return;
    if(!g.boundingBox)g.computeBoundingBox();bounds.copy(g.boundingBox).applyMatrix4(mesh.matrixWorld);
    if(bounds.max.x<minX||bounds.min.x>maxX||bounds.max.z<minZ||bounds.min.z>maxZ)return;
    const attrs=Object.entries(g.attributes),layout=[];let size=0;
    for(const [name,a]of attrs){layout.push({name,a,offset:size});size+=a.itemSize;}
    const offset=layout.find(a=>a.name==='position').offset;
    const count=g.index?g.index.count:g.attributes.position.count,rows=[],groups=[];
    const inv=mesh.matrixWorld.clone().invert(),point=new THREE.Vector3();
    let changed=false;
    const read=index=>{const row=new Array(size);for(const {a,offset:o}of layout)for(let k=0;k<a.itemSize;k++)row[o+k]=a.getComponent(index,k);
      point.set(row[offset],row[offset+1],row[offset+2]).applyMatrix4(mesh.matrixWorld);row[offset]=point.x;row[offset+1]=point.y;row[offset+2]=point.z;return row;};
    for(let i=0;i+2<count;i+=3){
      let pending=[read(g.index?g.index.getX(i):i),read(g.index?g.index.getX(i+1):i+1),read(g.index?g.index.getX(i+2):i+2)];
      const kept=[];
      for(const edge of edges){if(pending.length<3)break;const {inside,outside}=split(pending,edge,offset);if(outside.length>=3)kept.push(outside);pending=inside;}
      // Boundary-only triangles must survive; a prism has no volume outside its interior.
      if(pending.length>=3)changed=true;
      const start=rows.length,materialIndex=g.groups.find(r=>i>=r.start&&i<r.start+r.count)?.materialIndex||0;
      for(const poly of kept)for(let k=1;k+1<poly.length;k++)for(const row of [poly[0],poly[k],poly[k+1]]){
        const v=row.slice();point.set(v[offset],v[offset+1],v[offset+2]).applyMatrix4(inv);v[offset]=point.x;v[offset+1]=point.y;v[offset+2]=point.z;rows.push(v);
      }
      const added=rows.length-start;if(added){const prev=groups.at(-1);if(prev&&prev.materialIndex===materialIndex)prev.count+=added;else groups.push({start,count:added,materialIndex});}
    }
    if(!changed)return;
    const out=new THREE.BufferGeometry();for(const {name,a,offset:o}of layout){const data=new Float32Array(rows.length*a.itemSize);rows.forEach((r,i)=>{for(let k=0;k<a.itemSize;k++)data[i*a.itemSize+k]=r[o+k];});out.setAttribute(name,new THREE.BufferAttribute(data,a.itemSize));}
    out.groups=groups;if(out.attributes.normal)out.normalizeNormals();out.computeBoundingBox();out.computeBoundingSphere();mesh.geometry=out;g.dispose();
  });
}

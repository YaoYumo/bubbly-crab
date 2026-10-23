import * as THREE from 'three';
import { createPagodaGeometry, PAGODA_INFO } from './build.js';
import { PAGODA_PARTS } from './parts.js';
import { applyDetail } from '../../detail.js';

export const PAGODA_WOOD_KEY='cn:pagoda_wood_uploaded:楼阁式佛塔·木构变体';
export const PAGODA_WOOD_PALETTE={
  stone:{name:'台基·踏跺·底层石栏',kind:'stone',param:'stoneColor',color:'#a9a599',roughness:.94,metalness:0,tile:.85},
  timber:{name:'木柱·斗拱·檐板·楼板·上层木栏',kind:'wood',param:'woodColor',color:'#81502f',roughness:.76,metalness:0,tile:.22},
  panel:{name:'塔身木壁板',kind:'wood',param:'panelColor',color:'#ac8052',roughness:.83,metalness:0,tile:.22},
  joinery:{name:'深色木门·门框·佛龛',kind:'wood',param:'doorColor',color:'#493022',roughness:.7,metalness:0,tile:.22},
  roof:{name:'深灰瓦面·屋脊',kind:'tile',param:'roofColor',color:'#353d43',roughness:.87,metalness:.01,tile:.42},
  bronze:{name:'铜铃·铃舌',kind:'metal',param:'bronzeColor',color:'#896738',roughness:.46,metalness:.78,tile:.7},
  gilt:{name:'佛像·铜金塔刹',kind:'metal',param:'giltColor',color:'#b39a60',roughness:.39,metalness:.82,tile:.7},
  iron:{name:'塔刹金属拉索',kind:'metal',color:'#44474a',roughness:.66,metalness:.72,tile:.7},
  cord:{name:'檐铃悬绳',kind:'fabric',color:'#554838',roughness:.98,metalness:0,tile:.32},
};

// New UVs only on the variant. Source/gray geometry and all authored normals stay intact.
// Project each triangle consistently; vertical columns/panels follow Y, horizontal
// fascia/rail members rotate the wood grain. Never rely on the source's missing UVs.
function projectUV(geo,parts,tile) {
  const p=geo.attributes.position,uv=new Float32Array(p.count*2);
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),n=new THREE.Vector3();
  let offset=0;
  for(const part of parts) {
    for(let i=offset;i<offset+part.count;i+=3) {
      a.fromBufferAttribute(p,i);b.fromBufferAttribute(p,i+1);c.fromBufferAttribute(p,i+2);
      n.crossVectors(b.sub(a),c.sub(a)).normalize();
      const up=Math.abs(n.y)>.7,side=Math.abs(n.x)>Math.abs(n.z);
      for(let j=i;j<i+3;j++) {
        let u=up?p.getZ(j):side?p.getZ(j):p.getX(j),v=up?p.getX(j):p.getY(j);
        if(!up && part.grain==='horizontal')[u,v]=[v,u];
        uv[j*2]=u/tile;uv[j*2+1]=v/tile;
      }
    }
    offset+=part.count;
  }
  geo.setAttribute('uv',new THREE.BufferAttribute(uv,2));
  geo.userData.detFit=1; // Already projected in meters / texture period; no bbox stretching.
}

export function buildPagodaWood(params={}) {
  const source=createPagodaGeometry(),root=new THREE.Group();root.name='楼阁式佛塔·木构变体';
  const height=Number.isFinite(Number(params.height))?THREE.MathUtils.clamp(Number(params.height),1,120):PAGODA_INFO.sourceBounds.size[1];
  for(const [role,def] of Object.entries(PAGODA_WOOD_PALETTE)) {
    const parts=PAGODA_PARTS.filter(p=>p.role===role),count=parts.reduce((s,p)=>s+p.count,0),geo=new THREE.BufferGeometry();
    for(const name of ['position','normal']) {
      const src=source.getAttribute(name),array=new Float32Array(count*src.itemSize);let offset=0;
      for(const p of parts){array.set(src.array.subarray(p.start*src.itemSize,(p.start+p.count)*src.itemSize),offset);offset+=p.count*src.itemSize;}
      geo.setAttribute(name,new THREE.BufferAttribute(array,src.itemSize));
    }
    projectUV(geo,parts,def.tile);geo.computeBoundingBox();geo.computeBoundingSphere();
    const input=def.param?params[def.param]:null,color=typeof input==='string' && /^#[0-9a-f]{6}$/i.test(input)?input:def.color;
    const mat=new THREE.MeshStandardMaterial({color,roughness:def.roughness,metalness:def.metalness});
    mat.name=def.name;mat.userData.detail=def.kind;mat.userData.pagodaRole=role;
    const mesh=new THREE.Mesh(geo,mat);mesh.name=def.name;mesh.scale.setScalar(height/PAGODA_INFO.sourceBounds.size[1]);
    mesh.castShadow=true;mesh.receiveShadow=true;
    mesh.userData.pagodaRole=role;mesh.userData.sourceNodes=parts.map(p=>p.node);root.add(mesh);
  }
  source.dispose();
  root.userData.userModel={id:'pagoda-wood-v1',source:'Pagoda.gltf',sourceSHA256:PAGODA_INFO.sourceSHA256,sourceMaterialsMissing:true,authoredMaterials:true,unitAssumption:'source unit interpreted as meter',staticMergedByRole:true};
  root.userData.variantOf='cn:pagoda:楼阁式佛塔';
  // Browser-only procedural maps use the existing shared detail cache and quality toggles.
  // Plain Node construction remains available for source/geometry/ownership unit tests.
  if(typeof document!=='undefined') {
    applyDetail(root,{nrmScale:.3});
    // Structural timber is smooth/weathered wood, not deep bark corrugation.
    for(const mesh of root.children)if(mesh.material.userData.detail==='wood')mesh.material.normalScale.set(.08,.08);
  }
  return root;
}

// 路网封闭区域的纯几何部分：对实际道路/路口占地做布尔并集，其内部洞才是地块。
// 不把开放路网的包围盒当街区；保留凹边界和内部道路岛，便于严格验证建筑占地。
import ClipperLib from 'clipper-lib';
const SCALE = 1000; // 毫米整数布尔运算，避免重合路缘在浮点扫描线中产生微小退化边。
const toPath = ring => ring.map(p=>({X:Math.round(p[0]*SCALE),Y:Math.round(p[1]*SCALE)}));
const fromPath = path => {const ring=path.map(p=>[p.X/SCALE,p.Y/SCALE]);return [...ring,ring[0]];};

export const ringArea = ring => Math.abs(ring.reduce((a,p,i) => {
  const q=ring[(i+1)%ring.length]; return a+p[0]*q[1]-q[0]*p[1];
},0))/2;
export const polygonArea = poly => ringArea(poly[0])-poly.slice(1).reduce((s,r)=>s+ringArea(r),0);
function buffer(points,radius,filled=false) {
  const co=new ClipperLib.ClipperOffset(100,.05*SCALE);
  let path=toPath(points);
  path=path.filter((p,i)=>!i||p.X!==path[i-1].X||p.Y!==path[i-1].Y);
  const closed=path.length>2&&path[0].X===path.at(-1).X&&path[0].Y===path.at(-1).Y;
  if(closed)path.pop();
  if(path.length<2)return [];
  const end=filled?ClipperLib.EndType.etClosedPolygon:closed?ClipperLib.EndType.etClosedLine:ClipperLib.EndType.etOpenRound;
  if(filled&&!ClipperLib.Clipper.Orientation(path))path.reverse();
  // 道路跨段是斜接（miter），不能用圆角缓冲低估尖角外侧的真实铺装。
  // 路口凸轮廓则以圆角外扩 2m，给建筑保留退让。
  co.AddPath(path,filled?ClipperLib.JoinType.jtRound:ClipperLib.JoinType.jtMiter,end);
  const paths=[];co.Execute(paths,radius*SCALE);return paths;
}
export function parcelId(poly) {
  const rings=poly.map(r=>{
    const pts=r.slice(0,-1).map(p=>p.map(v=>Math.round(v*20)/20).join(','));
    const min=pts.indexOf([...pts].sort()[0]);
    const forward=pts.slice(min).concat(pts.slice(0,min)).join(';');
    const reverse=[pts[min],...pts.slice(0,min).reverse(),...pts.slice(min+1).reverse()].join(';');
    return [forward,reverse].sort()[0];
  });
  let hash=2166136261;
  for(const c of rings.sort().join('|')) { hash^=c.charCodeAt(0);hash=Math.imul(hash,16777619); }
  return `parcel-${(hash>>>0).toString(16)}`;
}
export function detectRoadParcels(roads,junctions=[],setback=2) {
  const paths=[];
  for(const road of roads)if(road.points.length>1)paths.push(...buffer(road.points,road.half+setback));
  for(const hull of junctions)if(hull.length>=3)paths.push(...buffer(hull,setback,true));
  if(!paths.length)return [];
  const c=new ClipperLib.Clipper(),tree=new ClipperLib.PolyTree();
  c.AddPaths(paths,ClipperLib.PolyType.ptSubject,true);
  c.Execute(ClipperLib.ClipType.ctUnion,tree,ClipperLib.PolyFillType.pftNonZero,ClipperLib.PolyFillType.pftNonZero);
  const found=new Map();
  const visit=node=>{
    if(node.IsHole()) {
      // 洞才是闭合地块；洞内独立道路岛作为地块的孔保留。
      const polygon=[fromPath(node.Contour()),...node.Childs().map(n=>fromPath(n.Contour()))];
      const area=polygonArea(polygon);
      if(area>=25) {
        const id=parcelId(polygon),xs=polygon[0].map(p=>p[0]),zs=polygon[0].map(p=>p[1]);
        found.set(id,{id,polygon,area,bounds:{minX:Math.min(...xs),maxX:Math.max(...xs),minZ:Math.min(...zs),maxZ:Math.max(...zs)}});
      }
    }
    node.Childs().forEach(visit);
  };
  tree.Childs().forEach(visit);
  return [...found.values()].sort((a,b)=>b.area-a.area);
}
function inRing(x,z,ring) {
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const a=ring[i],b=ring[j];
    if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }
  return inside;
}
export const inParcel = (x,z,poly) => inRing(x,z,poly[0])&&!poly.slice(1).some(r=>inRing(x,z,r));
export const boxPolygon = b => [[[b.minX,b.minZ],[b.maxX,b.minZ],[b.maxX,b.maxZ],[b.minX,b.maxZ],[b.minX,b.minZ]]];
export function footprintFits(bounds,polygon) {
  const c=new ClipperLib.Clipper(),result=[];
  c.AddPaths(boxPolygon(bounds).map(toPath),ClipperLib.PolyType.ptSubject,true);
  const clip=polygon.map((ring,i)=>{const path=toPath(ring);if(ClipperLib.Clipper.Orientation(path)!==(i===0))path.reverse();return path;});
  c.AddPaths(clip,ClipperLib.PolyType.ptClip,true);
  c.Execute(ClipperLib.ClipType.ctDifference,result,ClipperLib.PolyFillType.pftNonZero,ClipperLib.PolyFillType.pftNonZero);
  return Math.abs(result.reduce((s,p)=>s+ClipperLib.Clipper.Area(p),0))/SCALE**2<1e-6;
}
export const boxesOverlap = (a,b) => a.minX<b.maxX&&a.maxX>b.minX&&a.minZ<b.maxZ&&a.maxZ>b.minZ;

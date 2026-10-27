import { roadDesignHeight } from './road-contact.js';
import { subtractRoadPrism, prismEdges } from './road-prism-clip.js';

// A compact merge is NOT a full-width gap: retain the original road corridors
// outside the small core and cut their geometry exactly at the core boundary.
// Long acute overlap wedges are only trimmed where a curb/marking would otherwise
// stand inside the OTHER carriageway. No giant convex slab fills the empty wedge.
export function tagRoadRoles(piece, pavementHalf) {
  piece.traverse(mesh => {
    if (!mesh.isMesh || mesh.userData.roadRole) return;
    const g = mesh.geometry;
    if (!g?.boundingBox) g?.computeBoundingBox();
    const b = g?.boundingBox;
    if (!b) return;
    const x = mesh.position.x + (b.min.x + b.max.x) / 2;
    if (Math.abs(x) > pavementHalf + .05) mesh.userData.roadRole = 'side';
    else if (b.max.y + mesh.position.y > .15 && b.min.y + mesh.position.y >= .14) mesh.userData.roadRole = 'marking';
    else mesh.userData.roadRole = 'pavement';
  });
}
const strip = (origin, dir, lo, hi, half) => [
  { x: origin.x + dir.x * lo + dir.z * half, z: origin.z + dir.z * lo - dir.x * half },
  { x: origin.x + dir.x * hi + dir.z * half, z: origin.z + dir.z * hi - dir.x * half },
  { x: origin.x + dir.x * hi - dir.z * half, z: origin.z + dir.z * hi + dir.x * half },
  { x: origin.x + dir.x * lo - dir.z * half, z: origin.z + dir.z * lo + dir.x * half },
];
// A 3cm overlap hides float32 edge/raycast round-off on graded decks. The
// uncut original pavement wins depth there, exactly like ordinary mouth lips.
function insetPolygon(poly, amount=.03) {
  let result=poly;
  for(const edge of prismEdges(poly)){
    const out=[],f=p=>(p.x-edge.a.x)*edge.n.x+(p.z-edge.a.z)*edge.n.z-amount;
    for(let i=0;i<result.length;i++){
      const a=result[i],b=result[(i+1)%result.length],fa=f(a),fb=f(b);
      if(fa>=0)out.push(a);
      if((fa<0)!==(fb<0)){const t=fa/(fa-fb);out.push({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t});}
    }result=out;if(result.length<3)break;
  }return result;
}
export function applyCompactCuts(root, curve, gaps) {
  const seen = new Set(), length = Math.max(1, curve.getLength());
  for (const gap of gaps) {
    const is = gap.isect, plan = is?.plan;
    if (!plan?.compact || seen.has(is)) continue;
    seen.add(is);
    const t = curve === is.newCurve ? is.tNew : is.tExisting;
    const f = is.freeway, main = f && curve === f.curve;
    const own = plan.arms.filter(a => a.curve === curve || (main && a.curve === f.laneCurve));
    const reach = Math.max(...own.map(a => a.overlapReach || a.c), 1);
    const keepMedian = main ? mesh => mesh.userData.freewaySide !== f.side : null;
    for (const span of root.children) {
      const range = span.userData.roadRange || [span.userData.endpoint, span.userData.endpoint];
      if (range[0] === undefined) continue;
      if (range[1] >= gap.t0 - 2 / length && range[0] <= gap.t1 + 2 / length) subtractRoadPrism(span, insetPolygon(plan.hull), keepMedian);
      if (range[1] < t - (reach + 2) / length || range[0] > t + (reach + 2) / length) continue;
      for (const arm of plan.arms) {
        if (own.includes(arm)) continue;
        // Sweep the finite *actual* other road, rather than its infinite tangent.
        // Matching height planes protect bridges/underpasses at the same XZ.
        const l = Math.max(1, arm.curve.getLength()), distance = Math.min(arm.overlapReach || arm.c, arm.available ?? Infinity);
        const steps = Math.max(1, Math.ceil(distance / 3));
        for (let i = 0; i < steps; i++) {
          const start = Math.max(0, Math.min(1, arm.t + arm.sign * distance * i / steps / l));
          const end = Math.max(0, Math.min(1, arm.t + arm.sign * distance * (i + 1) / steps / l));
          const a = arm.curve.getPointAt(start), b = arm.curve.getPointAt(end);
          const seg = Math.hypot(b.x - a.x, b.z - a.z); if (seg < .01) continue;
          const dir = { x: (b.x - a.x) / seg, z: (b.z - a.z) / seg };
          // Fixed roads use their designed grades; following roads use the sampled
          // corridor elevation. Curbs only disappear at a genuinely shared level.
          const y = roadDesignHeight(arm.curve,start);
          const grade = (roadDesignHeight(arm.curve,end) - y) / seg;
          subtractRoadPrism(span, strip(a, dir, -.03, seg + .03, Math.max(0, arm.pav - .03)), mesh =>
            (keepMedian?.(mesh) || !['side', 'marking'].includes(mesh.userData.roadRole)),
          { origin: { x: a.x, y, z: a.z }, gradient: { x: dir.x * grade, z: dir.z * grade }, below: .15, above: .6 });
        }
      }
    }
  }
}

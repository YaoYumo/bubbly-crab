import * as THREE from "three";
export const TERRAIN_MATERIALS = [
  { id: "grass", name: "草地", color: "#668846", roughness: 0.96 },
  { id: "soil", name: "泥土", color: "#795138", roughness: 1 },
  { id: "gravel", name: "碎石", color: "#8b8477", roughness: 0.92 },
  { id: "rock", name: "岩石", color: "#676970", roughness: 0.85 },
  { id: "sand", name: "沙地", color: "#cfb780", roughness: 1 },
  { id: "snow", name: "积雪", color: "#e5edf3", roughness: 0.72 },
];
/** Automatic base and manual overlays have separate attributes; paint never gets baked into the base. */
export function terrainMaterial() {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.96,
    metalness: 0.02,
  });
  mat._terrainOverlay = { texture: { value: null }, enabled: { value: 0 }, opacity: { value: 1 }, flip: { value: new THREE.Vector2() } };
  mat._terrainColors = TERRAIN_MATERIALS.map((m) => new THREE.Color(m.color));
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.terrainOverlayTexture = mat._terrainOverlay.texture;
    shader.uniforms.terrainOverlayEnabled = mat._terrainOverlay.enabled;
    shader.uniforms.terrainOverlayOpacity = mat._terrainOverlay.opacity;
    shader.uniforms.terrainOverlayFlip = mat._terrainOverlay.flip;
    shader.uniforms.terrainAutoColors = { value: mat._terrainColors };
    shader.vertexShader =
      "varying vec2 vTerrainOverlayUV; attribute vec3 terrainWeightsA, terrainWeightsB, terrainAutoA, terrainAutoB; varying vec3 vTerrainA,vTerrainB,vAutoA,vAutoB,vTerrainWorld;\n" +
      shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      "#include <begin_vertex>\nvTerrainOverlayUV=uv;vTerrainA=terrainWeightsA;vTerrainB=terrainWeightsB;vAutoA=terrainAutoA;vAutoB=terrainAutoB;vTerrainWorld=(modelMatrix*vec4(position,1.0)).xyz;",
    );
    shader.fragmentShader =
      "uniform sampler2D terrainOverlayTexture; uniform float terrainOverlayEnabled,terrainOverlayOpacity; uniform vec2 terrainOverlayFlip; varying vec2 vTerrainOverlayUV; uniform vec3 terrainAutoColors[6];varying vec3 vTerrainA,vTerrainB,vAutoA,vAutoB,vTerrainWorld;\nfloat terrainNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);vec4 v=fract(sin(vec4(dot(i,vec2(127.1,311.7)),dot(i+vec2(1.,0.),vec2(127.1,311.7)),dot(i+vec2(0.,1.),vec2(127.1,311.7)),dot(i+1.,vec2(127.1,311.7))))*43758.5453);return mix(mix(v.x,v.y,f.x),mix(v.z,v.w,f.x),f.y); }\n" +
      shader.fragmentShader;
    const colors = TERRAIN_MATERIALS.map((m) => {
      const c = new THREE.Color(m.color);
      return `vec3(${c.r.toFixed(7)},${c.g.toFixed(7)},${c.b.toFixed(7)})`;
    });
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <color_fragment>",
      `#include <color_fragment>
      vec3 ta=max(vTerrainA,vec3(0.)),tb=max(vTerrainB,vec3(0.)),aa=max(vAutoA,vec3(0.)),ab=max(vAutoB,vec3(0.));
      float total=dot(ta+tb,vec3(1.)),autoTotal=dot(aa+ab,vec3(1.));ta/=max(1.,total);tb/=max(1.,total);aa/=max(1.,autoTotal);ab/=max(1.,autoTotal);
      vec2 q=vTerrainWorld.xz;float coarse=terrainNoise(q*2.5),fine=terrainNoise(q*30.);
      float grassGrain=.82+.25*terrainNoise(q*vec2(20.,3.)),soilGrain=.8+.3*coarse,gravelGrain=.65+.55*terrainNoise(q*16.);
      float rockGrain=.7+.35*terrainNoise(q*1.8)+.1*fine,sandGrain=.93+.07*sin(q.x*34.+coarse*4.),snowGrain=.94+.06*fine;
      vec3 surface=ta.x*${colors[0]}*grassGrain+ta.y*${colors[1]}*soilGrain+ta.z*${colors[2]}*gravelGrain+tb.x*${colors[3]}*rockGrain+tb.y*${colors[4]}*sandGrain+tb.z*${colors[5]}*snowGrain;
      vec3 base=aa.x*terrainAutoColors[0]*grassGrain+aa.y*terrainAutoColors[1]*soilGrain+aa.z*terrainAutoColors[2]*gravelGrain+ab.x*terrainAutoColors[3]*rockGrain+ab.y*terrainAutoColors[4]*sandGrain+ab.z*terrainAutoColors[5]*snowGrain;
      diffuseColor.rgb=(diffuseColor.rgb*(1.-min(1.,autoTotal))+base)*(1.-min(1.,total))+surface;
      if(terrainOverlayEnabled>.5){vec2 overlayUV=mix(vTerrainOverlayUV,vec2(1.)-vTerrainOverlayUV,terrainOverlayFlip);vec4 overlayColor=texture2D(terrainOverlayTexture,overlayUV);diffuseColor.rgb=mix(diffuseColor.rgb,overlayColor.rgb,terrainOverlayOpacity*overlayColor.a);}
    `,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <roughnessmap_fragment>",
      `#include <roughnessmap_fragment>
      float autoRough=roughnessFactor*(1.-min(1.,autoTotal))+dot(aa,vec3(.96,1.,.92))+dot(ab,vec3(.85,1.,.72));
      roughnessFactor=autoRough*(1.-min(1.,total))+dot(ta,vec3(.96,1.,.92))+dot(tb,vec3(.85,1.,.72));
    `,
    );
  };
  mat.customProgramCacheKey = () => "terrain-splat-auto-v3-overlay";
  return mat;
}
export function setTerrainPalette(mat, pal, biome) {
  const colors = [
    pal.mid,
    biome === "ash" ? pal.mid : TERRAIN_MATERIALS[1].color,
    pal.high,
    pal.rock,
    biome === "desert" ? pal.mid : TERRAIN_MATERIALS[4].color,
    pal.snow,
  ];
  mat._terrainColors?.forEach((c, i) => c.set(colors[i]));
}
export function packWeights(weights) {
  const bytes = Uint8Array.from(weights, (v) =>
    Math.round(Math.max(0, Math.min(1, v)) * 255),
  );
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
export function unpackWeights(text, count) {
  const weights = new Float32Array(count);
  if (!text) return weights;
  try {
    const bin = atob(text);
    if (bin.length !== count) throw new Error("地形材质尺寸不匹配");
    for (let i = 0; i < count; i++) weights[i] = bin.charCodeAt(i) / 255;
  } catch (e) {
    console.warn("terrain materials", e);
  }
  return weights;
}

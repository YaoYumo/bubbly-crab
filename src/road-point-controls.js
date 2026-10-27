import * as THREE from 'three';
import { hitCurvePoint } from './curve-handles.js';

// A separate, screen-sized Y grip makes per-point height editing discoverable and
// usable even in a top view (where a world-Y arrow projects to a zero-length line).
export const ROAD_HEIGHT_GRIP_OFFSET = 30;
export function roadHeightGuide(points) {
  const geometry = new THREE.BufferGeometry().setFromPoints(points.map(p=>new THREE.Vector3(...p)));
  const material = new THREE.ShaderMaterial({
    uniforms:{screenHeight:{value:800},pixelRatio:{value:1}},
    depthTest:false,depthWrite:false,transparent:true,
    vertexShader:`uniform float screenHeight; uniform float pixelRatio;
      void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
      gl_Position.y+=${ROAD_HEIGHT_GRIP_OFFSET*2}.0/screenHeight*gl_Position.w;gl_PointSize=22.0*pixelRatio;}`,
    fragmentShader:`void main(){vec2 p=gl_PointCoord-vec2(0.5);
      bool shaft=abs(p.x)<0.12&&p.y> -0.12&&p.y<0.43;
      bool head=p.y< -0.02&&p.y> -0.46&&abs(p.x)<(p.y+0.46);
      if(!(shaft||head))discard;gl_FragColor=vec4(0.12,0.86,0.40,1.0);}`,
  });
  const node=new THREE.Points(geometry,material);node.renderOrder=1001;node.frustumCulled=false;node.userData.pickIgnore=true;
  node.onBeforeRender=renderer=>{material.uniforms.screenHeight.value=renderer.domElement.clientHeight||800;material.uniforms.pixelRatio.value=renderer.getPixelRatio();};
  return node;
}
export function hitRoadHeightGrip(event,stage,points){
  return hitCurvePoint({clientX:event.clientX,clientY:event.clientY+ROAD_HEIGHT_GRIP_OFFSET},stage,points,11);
}

import * as THREE from "three";
// Fixed screen-size guides remain pickable at both scene and close-up scales.
export function pointGuide(points, color = 0x63ead5) {
  const geometry = new THREE.BufferGeometry().setFromPoints(
    points.map((p) => new THREE.Vector3(...p)),
  );
  const material = new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) } },
    depthTest: false,
    depthWrite: false,
    transparent: true,
    vertexShader:
      "void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);gl_PointSize=16.0;}",
    fragmentShader:
      "uniform vec3 color;void main(){float r=length(gl_PointCoord-vec2(0.5));if(r>0.49)discard;gl_FragColor=vec4(mix(color,vec3(1.0),step(0.34,r)),1.0);}",
  });
  const node = new THREE.Points(geometry, material);
  node.renderOrder = 1000;
  node.frustumCulled = false;
  node.userData.pickIgnore = true;
  return node;
}
export function hitCurvePoint(event, stage, points, radius = 14) {
  const rect = stage.canvas.getBoundingClientRect();
  let nearest = -1,
    distance = radius * radius;
  points.forEach((p, i) => {
    const v = new THREE.Vector3(...p).project(stage.view);
    if (v.z < -1 || v.z > 1) return;
    const dx = rect.left + ((v.x + 1) * rect.width) / 2 - event.clientX;
    const dy = rect.top + ((1 - v.y) * rect.height) / 2 - event.clientY;
    const d = dx * dx + dy * dy;
    if (d < distance) {
      distance = d;
      nearest = i;
    }
  });
  return nearest;
}
export function dragOnLevel(event, stage, y) {
  const rect = stage.canvas.getBoundingClientRect(),
    ray = new THREE.Raycaster();
  ray.setFromCamera(
    new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      1 - ((event.clientY - rect.top) / rect.height) * 2,
    ),
    stage.view,
  );
  return ray.ray.intersectPlane(
    new THREE.Plane(new THREE.Vector3(0, 1, 0), -y),
    new THREE.Vector3(),
  );
}

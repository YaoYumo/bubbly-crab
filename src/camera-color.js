import * as THREE from "three";
import { clamp } from "./util.js";

// Approximate Planckian white, suitable for preview lighting, not a spectral calibration.
export function kelvinColor(kelvin) {
  const t = clamp(Number(kelvin) || 6500, 1000, 20000) / 100;
  const r = t <= 66 ? 255 : 329.698727446 * (t - 60) ** -0.1332047592;
  const g =
    t <= 66
      ? 99.4708025861 * Math.log(t) - 161.1195681661
      : 288.1221695283 * (t - 60) ** -0.0755148492;
  const b =
    t >= 66
      ? 255
      : t <= 19
        ? 0
        : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  return new THREE.Color().setRGB(
    clamp(r, 0, 255) / 255,
    clamp(g, 0, 255) / 255,
    clamp(b, 0, 255) / 255,
    THREE.SRGBColorSpace,
  );
}

/** Camera-only white balance BEFORE tone mapping. Neutral during environment capture.
 * Chains existing terrain/alpha shader hooks; doesn't change original material colors.
 */
export class CameraColor {
  constructor(stage) {
    this.stage = stage;
    this.gain = new THREE.Vector3(1, 1, 1);
    this.patched = new WeakSet();
    this.sources = new WeakMap();
  }
  setWhiteBalance(k = 6500) {
    const white = kelvinColor(k),
      ref = kelvinColor(6500);
    this.gain.set(
      ref.r / Math.max(0.02, white.r),
      ref.g / Math.max(0.02, white.g),
      ref.b / Math.max(0.02, white.b),
    );
    this.gain.multiplyScalar(
      1 / (this.gain.x * 0.2126 + this.gain.y * 0.7152 + this.gain.z * 0.0722),
    );
    this.patchAll();
  }
  patchAll() {
    this.stage.scene.traverse((o) => {
      for (const mat of Array.isArray(o.material) ? o.material : [o.material])
        this.patch(mat);
    });
  }
  patch(mat) {
    if (!mat || this.patched.has(mat) || mat.isRawShaderMaterial) return;
    this.patched.add(mat);
    const old = mat.onBeforeCompile,
      key = mat.customProgramCacheKey();
    const source = { compile: old, cache: mat.customProgramCacheKey };
    this.sources.set(mat, source);
    const gain = this.gain;
    mat.onBeforeCompile = function (shader, renderer) {
      old?.call(this, shader, renderer);
      if (!shader.fragmentShader.includes("#include <tonemapping_fragment>"))
        return;
      shader.uniforms.previzCameraWhite = { value: gain };
      shader.fragmentShader =
        "uniform vec3 previzCameraWhite;\n" + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <tonemapping_fragment>",
        "gl_FragColor.rgb *= previzCameraWhite;\n#include <tonemapping_fragment>",
      );
    };
    mat.customProgramCacheKey = () => key + "|camera-white-v1";
    source.wrapper = mat.onBeforeCompile;
    source.wrapperCache = mat.customProgramCacheKey;
    mat.needsUpdate = true;
  }
  neutral(fn) {
    const old = this.gain.clone();
    this.gain.set(1, 1, 1);
    try {
      return fn();
    } finally {
      this.gain.copy(old);
    }
  }
}

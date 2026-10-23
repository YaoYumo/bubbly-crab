// ---------------------------------------------------------------------------
// 粒子天气系统：雨、雪、沙尘、暴风雨（闪电+雨+风）
// 雾效果使用 THREE.FogExp2 实现（在 main.js 中设置）
// ---------------------------------------------------------------------------
import * as THREE from "three";
import { makeRng } from "./util.js";

export const WEATHER = [
  {
    id: "rain",
    name: "雨 Rain",
    color: "#8ab4d8",
    size: 0.08,
    count: 8000,
    speed: 18,
    height: 30,
  },
  {
    id: "snow",
    name: "雪 Snow",
    color: "#ffffff",
    size: 0.15,
    count: 4000,
    speed: 2.5,
    height: 25,
  },
  {
    id: "sand",
    name: "沙尘 Sand",
    color: "#d4a574",
    size: 0.12,
    count: 5000,
    speed: 12,
    height: 8,
  },
  {
    id: "storm",
    name: "暴风雨 Storm",
    color: "#a0c4e0",
    size: 0.1,
    count: 12000,
    speed: 25,
    height: 35,
  },
];

export const WEATHER_BY_ID = Object.fromEntries(WEATHER.map((w) => [w.id, w]));

// A bounded camera-local simulation, but world-space drops: moving the camera
// only recycles drops outside the volume, never drags the whole rain field.
const wrap = (v, center, half) => {
  const lo = center - half,
    span = 2 * half;
  return v >= lo && v < lo + span
    ? v
    : lo + ((((v - lo) % span) + span) % span);
};

export class WeatherSystem {
  constructor(scene) {
    this.scene = scene;
    this.type = null;
    this.particles = null;
    this.geometry = null;
    this.material = null;
    this.velocities = null;
    this.bounds = { x: 50, y: 35, z: 50 };
    this.center = new THREE.Vector3();
    this.fieldHalf = new THREE.Vector3();
    this.enabled = false;

    this.lightningLight = null;
    this.lightningTimer = 0;
    this.lightningInterval = 0;
    this.lightningFlash = 0;
  }

  set(type, options = {}) {
    this.clear();
    this.type = null;
    this.enabled = false;
    this.style = options.style === "streaks" ? "streaks" : "points";
    this.seed = Number.isFinite(options.seed) ? options.seed : 1;
    this.random = makeRng(this.seed);
    if (!type || type === "none") {
      this.type = null;
      this.enabled = false;
      return;
    }
    const cfg = WEATHER_BY_ID[type];
    if (!cfg) return;
    this.type = type;
    this.enabled = true;
    this.create(cfg);

    if (type === "storm") {
      this.lightningLight = new THREE.PointLight(0xeef4ff, 0, 200);
      this.lightningLight.position.set(0, 40, 0);
      this.scene.add(this.lightningLight);
      this.lightningTimer = 2 + Math.random() * 4;
      this.lightningFlash = 0;
    }
  }

  toJSON() {
    return {
      type: this.type,
      style: this.style || "points",
      seed: this.seed ?? 1,
    };
  }
  fromJSON(value) {
    this.set(value?.type, value || {});
  }

  create(cfg) {
    const count = cfg.count;
    this.geometry = new THREE.BufferGeometry();
    const streak = this.type === "rain" && this.style === "streaks";
    const stride = streak ? 6 : 3,
      rand = this.random;
    const positions = new Float32Array(count * stride);
    const colors = new Float32Array(count * stride);
    this.velocities = new Float32Array(count * 3);

    const color = new THREE.Color(cfg.color);
    const bx = this.bounds.x,
      bz = this.bounds.z;
    // Precipitation surrounds the observer instead of ending at world Y=30/35.
    // Sand remains a low ground-level layer; don't turn it into a rain cloud.
    const by =
      this.type === "sand"
        ? cfg.height / 2
        : cfg.height * (this.type === "rain" || this.type === "storm" ? 2 : 1);
    this.center.set(0, this.type === "sand" ? by : 0, 0);
    this.fieldHalf.set(bx, by, bz);

    for (let i = 0; i < count; i++) {
      const i3 = i * stride,
        vi = i * 3;
      positions[i3] = (rand() - 0.5) * bx * 2;
      positions[i3 + 1] = this.center.y + (rand() - 0.5) * by * 2;
      positions[i3 + 2] = (rand() - 0.5) * bz * 2;

      colors[i3] = color.r;
      colors[i3 + 1] = color.g;
      colors[i3 + 2] = color.b;

      if (streak) {
        positions[i3 + 3] = positions[i3] - 0.08;
        positions[i3 + 4] = positions[i3 + 1] + 0.85;
        positions[i3 + 5] = positions[i3 + 2];
        colors.set(colors.subarray(i3, i3 + 3), i3 + 3);
      }
      if (this.type === "rain") {
        this.velocities[vi] = 0;
        this.velocities[vi + 1] = -cfg.speed * (0.8 + rand() * 0.4);
        this.velocities[vi + 2] = 0;
      } else if (this.type === "snow") {
        this.velocities[vi] = (rand() - 0.5) * 0.5;
        this.velocities[vi + 1] = -cfg.speed * (0.6 + rand() * 0.4);
        this.velocities[vi + 2] = (rand() - 0.5) * 0.5;
      } else if (this.type === "sand") {
        this.velocities[vi] = cfg.speed * (0.7 + rand() * 0.6);
        this.velocities[vi + 1] = (rand() - 0.5) * 0.3;
        this.velocities[vi + 2] = (rand() - 0.5) * 0.5;
      } else if (this.type === "storm") {
        this.velocities[vi] = -8 + (rand() - 0.5) * 4;
        this.velocities[vi + 1] = -cfg.speed * (0.8 + rand() * 0.4);
        this.velocities[vi + 2] = -3 + (rand() - 0.5) * 2;
      }
    }

    this.geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(positions, 3),
    );
    this.geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    this.material = streak
      ? new THREE.LineBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: 0.48,
          depthWrite: false,
        })
      : new THREE.PointsMaterial({
          size: cfg.size,
          vertexColors: true,
          transparent: true,
          opacity: this.type === "storm" ? 0.5 : 0.7,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          sizeAttenuation: true,
        });

    this.installVolumeFade();

    this.particles = streak
      ? new THREE.LineSegments(this.geometry, this.material)
      : new THREE.Points(this.geometry, this.material);
    this.particles.frustumCulled = false;
    this.scene.add(this.particles);
  }

  installVolumeFade() {
    // Soft boundaries hide the recycling box when looking up or flying high.
    // Works for Points and LineSegments without more particles/draw calls.
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.weatherCenter = { value: this.center };
      shader.uniforms.weatherHalf = { value: this.fieldHalf };
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nvarying vec3 vWeatherWorld;",
        )
        .replace(
          "#include <project_vertex>",
          "#include <project_vertex>\nvWeatherWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;",
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          "#include <common>\nvarying vec3 vWeatherWorld;\nuniform vec3 weatherCenter;\nuniform vec3 weatherHalf;",
        )
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
          vec3 weatherEdge = abs(vWeatherWorld - weatherCenter) / weatherHalf;
          float weatherDistance = max(max(weatherEdge.x, weatherEdge.y), weatherEdge.z);
          diffuseColor.a *= 1.0 - smoothstep(0.72, 1.0, weatherDistance);`,
        );
    };
    this.material.customProgramCacheKey = () => "weather-volume-fade-v1";
  }

  update(dt, cameraPos) {
    if (!this.enabled || !this.particles) return;
    const positions = this.geometry.attributes.position.array;
    const stride = this.particles.isLineSegments ? 6 : 3,
      rand = this.random;
    const count = positions.length / stride;
    const bx = this.fieldHalf.x,
      by = this.fieldHalf.y,
      bz = this.fieldHalf.z;
    const finite = (v) => (Number.isFinite(v) ? v : 0);
    const cx = finite(cameraPos?.x),
      cz = finite(cameraPos?.z);
    const cy = this.type === "sand" ? by : finite(cameraPos?.y);
    this.center.set(cx, cy, cz);
    dt = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.1)) : 0;

    for (let i = 0; i < count; i++) {
      const i3 = i * stride,
        vi = i * 3;
      positions[i3] += this.velocities[vi] * dt;
      positions[i3 + 1] += this.velocities[vi + 1] * dt;
      positions[i3 + 2] += this.velocities[vi + 2] * dt;

      if (this.type === "snow") {
        this.velocities[vi] += (rand() - 0.5) * 0.03;
        this.velocities[vi + 2] += (rand() - 0.5) * 0.03;
        const maxDrift = 1.0;
        this.velocities[vi] = Math.max(
          -maxDrift,
          Math.min(maxDrift, this.velocities[vi]),
        );
        this.velocities[vi + 2] = Math.max(
          -maxDrift,
          Math.min(maxDrift, this.velocities[vi + 2]),
        );
      }

      if (this.type === "storm") {
        this.velocities[vi] += (rand() - 0.5) * 0.5;
        this.velocities[vi + 2] += (rand() - 0.5) * 0.3;
      }

      // Wrap every axis, including upward/downward camera moves and teleports.
      // Uniform phase survives a large altitude change: no sheet of newborn
      // drops all spawning on the same horizontal plane.
      positions[i3] = wrap(positions[i3], cx, bx);
      positions[i3 + 1] = wrap(positions[i3 + 1], cy, by);
      positions[i3 + 2] = wrap(positions[i3 + 2], cz, bz);
      if (stride === 6) {
        positions[i3 + 3] = positions[i3] - 0.08;
        positions[i3 + 4] = positions[i3 + 1] + 0.85;
        positions[i3 + 5] = positions[i3 + 2];
      }
    }

    this.geometry.attributes.position.needsUpdate = true;

    if (this.type === "storm") {
      this.updateLightning(dt);
    }
  }

  updateLightning(dt) {
    if (!this.lightningLight) return;

    this.lightningTimer -= dt;

    if (this.lightningFlash > 0) {
      this.lightningFlash -= dt * 4;
      this.lightningLight.intensity = Math.max(0, this.lightningFlash) * 50;
      if (this.lightningFlash <= 0) {
        this.lightningLight.intensity = 0;
        this.lightningTimer = 1 + Math.random() * 5;
      }
    } else if (this.lightningTimer <= 0) {
      this.lightningFlash = 0.6 + Math.random() * 0.4;
      this.lightningLight.intensity = this.lightningFlash * 50;
      this.lightningLight.position.set(
        this.center.x + (Math.random() - 0.5) * 60,
        this.center.y + this.fieldHalf.y * 0.65 + Math.random() * 10,
        this.center.z + (Math.random() - 0.5) * 60,
      );
    }
  }

  clear() {
    if (this.particles) {
      this.scene.remove(this.particles);
      this.geometry?.dispose();
      this.material?.dispose();
      this.particles = null;
      this.geometry = null;
      this.material = null;
      this.velocities = null;
    }
    if (this.lightningLight) {
      this.scene.remove(this.lightningLight);
      this.lightningLight.dispose();
      this.lightningLight = null;
    }
    this.lightningFlash = 0;
    this.lightningTimer = 0;
  }

  dispose() {
    this.clear();
  }
}

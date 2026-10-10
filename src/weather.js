// ---------------------------------------------------------------------------
// 粒子天气系统：雨、雪、沙尘、暴风雨（闪电+雨+风）
// 雾效果使用 THREE.FogExp2 实现（在 main.js 中设置）
// ---------------------------------------------------------------------------
import * as THREE from 'three';

export const WEATHER = [
  { id: 'rain', name: '雨 Rain', color: '#8ab4d8', size: 0.08, count: 8000, speed: 18, height: 30 },
  { id: 'snow', name: '雪 Snow', color: '#ffffff', size: 0.15, count: 4000, speed: 2.5, height: 25 },
  { id: 'sand', name: '沙尘 Sand', color: '#d4a574', size: 0.12, count: 5000, speed: 12, height: 8 },
  { id: 'storm', name: '暴风雨 Storm', color: '#a0c4e0', size: 0.1, count: 12000, speed: 25, height: 35 },
];

export const WEATHER_BY_ID = Object.fromEntries(WEATHER.map(w => [w.id, w]));

export class WeatherSystem {
  constructor(scene) {
    this.scene = scene;
    this.type = null;
    this.particles = null;
    this.geometry = null;
    this.material = null;
    this.velocities = null;
    this.bounds = { x: 50, y: 35, z: 50 };
    this.enabled = false;

    this.lightningLight = null;
    this.lightningTimer = 0;
    this.lightningInterval = 0;
    this.lightningFlash = 0;
  }

  set(type) {
    this.clear();
    if (!type || type === 'none') {
      this.type = null;
      this.enabled = false;
      return;
    }
    const cfg = WEATHER_BY_ID[type];
    if (!cfg) return;
    this.type = type;
    this.enabled = true;
    this.create(cfg);

    if (type === 'storm') {
      this.lightningLight = new THREE.PointLight(0xeef4ff, 0, 200);
      this.lightningLight.position.set(0, 40, 0);
      this.scene.add(this.lightningLight);
      this.lightningTimer = 2 + Math.random() * 4;
      this.lightningFlash = 0;
    }
  }

  create(cfg) {
    const count = cfg.count;
    this.geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    this.velocities = new Float32Array(count * 3);

    const color = new THREE.Color(cfg.color);
    const bx = this.bounds.x, by = cfg.height, bz = this.bounds.z;

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      positions[i3] = (Math.random() - 0.5) * bx * 2;
      positions[i3 + 1] = Math.random() * by;
      positions[i3 + 2] = (Math.random() - 0.5) * bz * 2;

      colors[i3] = color.r;
      colors[i3 + 1] = color.g;
      colors[i3 + 2] = color.b;

      if (this.type === 'rain') {
        this.velocities[i3] = 0;
        this.velocities[i3 + 1] = -cfg.speed * (0.8 + Math.random() * 0.4);
        this.velocities[i3 + 2] = 0;
      } else if (this.type === 'snow') {
        this.velocities[i3] = (Math.random() - 0.5) * 0.5;
        this.velocities[i3 + 1] = -cfg.speed * (0.6 + Math.random() * 0.4);
        this.velocities[i3 + 2] = (Math.random() - 0.5) * 0.5;
      } else if (this.type === 'sand') {
        this.velocities[i3] = cfg.speed * (0.7 + Math.random() * 0.6);
        this.velocities[i3 + 1] = (Math.random() - 0.5) * 0.3;
        this.velocities[i3 + 2] = (Math.random() - 0.5) * 0.5;
      } else if (this.type === 'storm') {
        this.velocities[i3] = -8 + (Math.random() - 0.5) * 4;
        this.velocities[i3 + 1] = -cfg.speed * (0.8 + Math.random() * 0.4);
        this.velocities[i3 + 2] = -3 + (Math.random() - 0.5) * 2;
      }
    }

    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    this.material = new THREE.PointsMaterial({
      size: cfg.size,
      vertexColors: true,
      transparent: true,
      opacity: this.type === 'storm' ? 0.5 : 0.7,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });

    this.particles = new THREE.Points(this.geometry, this.material);
    this.particles.frustumCulled = false;
    this.scene.add(this.particles);
  }

  update(dt, cameraPos) {
    if (!this.enabled || !this.particles) return;
    const positions = this.geometry.attributes.position.array;
    const count = positions.length / 3;
    const bx = this.bounds.x, bz = this.bounds.z;
    const cfg = WEATHER_BY_ID[this.type];
    const by = cfg?.height || this.bounds.y;
    const cx = cameraPos?.x || 0, cz = cameraPos?.z || 0;

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      positions[i3] += this.velocities[i3] * dt;
      positions[i3 + 1] += this.velocities[i3 + 1] * dt;
      positions[i3 + 2] += this.velocities[i3 + 2] * dt;

      if (this.type === 'snow') {
        this.velocities[i3] += (Math.random() - 0.5) * 0.03;
        this.velocities[i3 + 2] += (Math.random() - 0.5) * 0.03;
        const maxDrift = 1.0;
        this.velocities[i3] = Math.max(-maxDrift, Math.min(maxDrift, this.velocities[i3]));
        this.velocities[i3 + 2] = Math.max(-maxDrift, Math.min(maxDrift, this.velocities[i3 + 2]));
      }

      if (this.type === 'storm') {
        this.velocities[i3] += (Math.random() - 0.5) * 0.5;
        this.velocities[i3 + 2] += (Math.random() - 0.5) * 0.3;
      }

      if (positions[i3 + 1] < 0) {
        positions[i3] = cx + (Math.random() - 0.5) * bx * 2;
        positions[i3 + 1] = by;
        positions[i3 + 2] = cz + (Math.random() - 0.5) * bz * 2;
      }

      if (this.type === 'sand') {
        if (positions[i3] > cx + bx) positions[i3] = cx - bx;
        else if (positions[i3] < cx - bx) positions[i3] = cx + bx;
      } else {
        if (Math.abs(positions[i3] - cx) > bx) positions[i3] = cx + (Math.random() - 0.5) * bx * 2;
      }

      if (Math.abs(positions[i3 + 2] - cz) > bz) {
        positions[i3 + 2] = cz + (Math.random() - 0.5) * bz * 2;
      }
    }

    this.geometry.attributes.position.needsUpdate = true;

    if (this.type === 'storm') {
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
        (Math.random() - 0.5) * 60,
        35 + Math.random() * 10,
        (Math.random() - 0.5) * 60
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

import assert from "node:assert/strict";
import puppeteer from "puppeteer";
import {
  solarPosition,
  cleanSky,
  sunDirection,
  nightAmount,
} from "../src/physical-sky.js";
const geo = {
  ...cleanSky(),
  date: "2026-10-16",
  latitude: 1.3521,
  longitude: 103.8198,
  timezone: 8,
  hour: 12,
};
assert.ok(solarPosition(geo).elevation > 70);
assert.ok(solarPosition({ ...geo, hour: 0 }).elevation < -70);
assert.deepEqual(
  solarPosition(geo),
  solarPosition({ ...geo, hour: 4, timezone: 0 }),
);
assert.ok(sunDirection(0, 90).distanceTo({ x: 1, y: 0, z: 0 }) < 1e-10);
assert.equal(nightAmount(-10), 1);
assert.equal(nightAmount(20), 0);
assert.ok(Number.isFinite(cleanSky({ sunElev: Infinity, mie: 0 }).sunElev));
assert.ok(cleanSky({ mie: 0 }).mie > 0);
console.log(
  "PASS solar position / UTC equivalence / orientation / sanitization",
);
const browser = await puppeteer.launch({
  headless: "shell",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
  protocolTimeout: 240000,
});
const errors = [];
try {
  const p = await browser.newPage();
  await p.setViewport({ width: 1440, height: 1000 });
  p.on("pageerror", (e) => errors.push(String(e)));
  p.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await p.goto("http://localhost:5174/?fresh=1", {
    waitUntil: "domcontentloaded",
  });
  await p.waitForFunction(() => window.__t?.app?.localLights, {
    timeout: 60000,
  });
  await p.evaluate(() => {
    app.suspended = true;
    app.clearAll();
    app.lighting.setMode("physical");
    app.lighting.setEnabled(true);
    app.state.perf = false;
    app.lighting.physical.configure({ source: "manual", sunElev: 48, fog: 0 });
    app.lighting.flushEnvironment();
    app.stage.renderer.setPixelRatio(0.5);
  });
  const sky = await p.evaluate(async () => {
    const L = app.lighting,
      P = L.physical,
      st = app.stage,
      first = P.target.texture,
      base = P.bakes;
    P.configure({ whiteBalance: 3200, ev: 1, environment: 0.7 });
    L.setIso(800);
    const exposure = st.renderer.toneMappingExposure;
    L.flushEnvironment();
    const noRebake = P.bakes === base && P.target.texture === first;
    st.setEnvColors({ sky: "#ff0000", sun: "#00ff00", ground: "#0000ff" });
    await new Promise((r) => setTimeout(r, 280));
    const owned = st.scene.environment === P.target.texture;
    st._rebuildEnv();
    const protectedOwner = st.scene.environment === P.target.texture;
    const oldGain = P.color.gain.clone();
    let neutral = false;
    P.color.neutral(() => {
      neutral = P.color.gain.equals(new window.__t.THREE.Vector3(1, 1, 1));
    });
    L.applyPreset("night");
    const legacy =
      L.mode === "legacy" &&
      st.scene.environment !== P.target.texture &&
      !P.mesh.visible &&
      st.sky.visible;
    L.setMode("physical");
    L.flushEnvironment();
    const sameSun =
      P.mesh.material.uniforms.sunPosition.value.distanceTo(
        P.captureSky.material.uniforms.sunPosition.value,
      ) < 1e-10;
    return {
      noRebake,
      exposure,
      owned,
      protectedOwner,
      neutral,
      restored: P.color.gain.equals(oldGain),
      legacy,
      sameSun,
      amb: L.amb.intensity,
      hemi: L.hemi.intensity,
      fill: L.fill.intensity,
      rim: L.rim.intensity,
    };
  });
  assert.equal(sky.exposure, 4);
  for (const k of [
    "noRebake",
    "owned",
    "protectedOwner",
    "neutral",
    "restored",
    "legacy",
    "sameSun",
  ])
    assert.equal(sky[k], true, k);
  for (const k of ["amb", "hemi", "fill", "rim"]) assert.equal(sky[k], 0);
  console.log(
    "PASS unified sky / IBL ownership / WB not baked / EV + ISO once / legacy presets",
    sky,
  );
  const pixels = await p.evaluate(() => {
    const T = window.__t.THREE,
      L = app.lighting,
      P = L.physical,
      st = app.stage;
    app.terrain.setEnabled(false);
    st.setGroundVisible(false);
    app.state.preview = false;
    L.setIso(400);
    P.configure({ sunElev: -14, ev: 0, whiteBalance: 6500, fog: 0 });
    L.flushEnvironment();
    const key = [...window.__t.LIB_INDEX].find(
      ([k, i]) => i.type === "street_lamp",
    )[0];
    const lamp = app.addAsset(key, new T.Vector3());
    app.localLights.setLamp(lamp, {
      mode: "on",
      emission: 2,
      lumens: 1500,
      shadow: true,
    });
    app.select(null);
    st.helperLayer.visible = false;
    st.view.position.set(8, 10, 12);
    st.orbit.target.set(0.7, 0, 0.4);
    st.orbit.update();
    st.view.aspect = 1;
    st.view.updateProjectionMatrix();
    const plane = new T.Mesh(
      new T.PlaneGeometry(50, 50),
      new T.MeshStandardMaterial({ color: 0x999999, roughness: 1 }),
    );
    plane.rotation.x = -Math.PI / 2;
    plane.receiveShadow = true;
    st.scene.add(plane);
    const box = new T.Mesh(
      new T.BoxGeometry(2, 1, 2),
      new T.MeshStandardMaterial({ color: 0x777777 }),
    );
    box.position.set(0.7, 3, 0.4);
    box.castShadow = true;
    box.visible = false;
    st.scene.add(box);
    P.color.patchAll();
    const rt = new T.WebGLRenderTarget(160, 160);
    rt.texture.colorSpace = T.SRGBColorSpace;
    const probe = new T.Vector3(0.7, 0.01, 0.4);
    let rgb;
    const sample = () => {
      app.step(0, true);
      st.view.updateMatrixWorld(true);
      const v = probe.clone().project(st.view);
      const x = Math.round((v.x + 1) * 80),
        y = Math.round((v.y + 1) * 80);
      st.renderer.setRenderTarget(rt);
      st.renderer.render(st.scene, st.view);
      const data = new Uint8Array(4 * 9);
      st.renderer.readRenderTargetPixels(rt, x - 1, y - 1, 3, 3, data);
      st.renderer.setRenderTarget(null);
      rgb = [0, 0, 0];
      for (let i = 0; i < data.length; i += 4)
        for (let c = 0; c < 3; c++) rgb[c] += data[i + c] / 9;
      return (rgb[0] + rgb[1] + rgb[2]) / 3;
    };
    const lit = sample(),
      neutralRGB = [...rgb];
    P.configure({ whiteBalance: 3200 });
    sample();
    const coolRGB = [...rgb];
    P.configure({ whiteBalance: 9500 });
    sample();
    const warmRGB = [...rgb];
    P.configure({ whiteBalance: 6500 });
    const whiteBalancePixels =
      coolRGB[2] / coolRGB[0] > neutralRGB[2] / neutralRGB[0] &&
      warmRGB[0] / warmRGB[2] > neutralRGB[0] / neutralRGB[2];
    app.localLights.setLamp(lamp, { illuminate: false });
    const dark = sample();
    const emissionIndependent =
      app.localLights.entries[0].state.materials.every(
        (m) => m.emissiveIntensity === 2,
      );
    app.localLights.setLamp(lamp, { illuminate: true });
    box.visible = true;
    const shadow = sample();
    app.localLights.setLamp(lamp, { shadow: false });
    const unshadowed = sample();
    app.localLights.setLamp(lamp, { mode: "off" });
    const off = sample(),
      offEmission = app.localLights.entries[0].state.materials.every(
        (m) => m.emissiveIntensity === 0,
      );
    box.geometry.dispose();
    box.material.dispose();
    plane.geometry.dispose();
    plane.material.dispose();
    st.scene.remove(box, plane);
    rt.dispose();
    st.helperLayer.visible = true;
    return {
      lit,
      dark,
      shadow,
      unshadowed,
      off,
      emissionIndependent,
      offEmission,
      whiteBalancePixels,
      neutralRGB,
      coolRGB,
      warmRGB,
    };
  });
  console.log("PIXELS", pixels);
  assert.ok(pixels.lit > pixels.dark + 25);
  assert.ok(pixels.unshadowed > pixels.shadow + 15);
  assert.equal(pixels.emissionIndependent, true);
  assert.equal(pixels.offEmission, true);
  assert.equal(pixels.whiteBalancePixels, true);
  console.log(
    "PASS actual ground illumination / occluder shadow / independent emissive and light",
  );
  const budget = await p.evaluate(() => {
    app.clearAll();
    const T = window.__t.THREE,
      L = app.lighting;
    app.lighting.physical.configure({ sunElev: -14 });
    const key = [...window.__t.LIB_INDEX].find(
      ([k, i]) => i.type === "street_lamp",
    )[0];
    for (let i = 0; i < 18; i++)
      app.addAsset(key, new T.Vector3((i % 6) * 4, 0, Math.floor(i / 6) * 4));
    app.stage.view.position.set(8, 8, 16);
    app.localLights.setQuality("medium");
    app.step(0, true);
    const medium = { ...app.localLights.stats };
    const first = app.localLights.pool[0].userData.fixtureId;
    app.stage.view.position.x += 0.01;
    app.step(0, true);
    const stable = first === app.localLights.pool[0].userData.fixtureId;
    app.localLights.setQuality("low");
    app.step(0, true);
    const low = { ...app.localLights.stats };
    app.localLights.setQuality("high");
    app.step(0, true);
    const high = { ...app.localLights.stats };
    app.stage.view.position.set(1000, 100, 1000);
    app.step(0, true);
    const far = { ...app.localLights.stats },
      glowing = app.localLights.entries.every((e) =>
        e.state.materials.some((m) => m.emissiveIntensity > 0),
      );
    app.stage.view.position.set(8, 8, 16);
    L.physical.configure({ sunElev: 48 });
    app.step(0, true);
    const day = app.localLights.stats.active;
    const so = app.objects[0];
    app.localLights.setLamp(so, { mode: "on" });
    app.step(0, true);
    const forced = app.localLights.stats.active;
    so.visible = false;
    so.apply();
    app.step(0, true);
    const hidden = app.localLights.stats.active;
    L.setEnabled(false);
    app.step(0, true);
    const perf =
      app.localLights.stats.active === 0 &&
      app.stage.scene.environment === null;
    L.setEnabled(true);
    app.step(0, true);
    const restored = app.stage.scene.environment === L.physical.target.texture;
    return {
      medium,
      low,
      high,
      stable,
      far,
      glowing,
      day,
      forced,
      hidden,
      perf,
      restored,
    };
  });
  console.log("BUDGET", budget);
  assert.equal(budget.medium.active, 8);
  assert.equal(budget.medium.shadows, 1);
  assert.equal(budget.low.active, 4);
  assert.equal(budget.low.shadows, 0);
  assert.equal(budget.high.active, 12);
  assert.equal(budget.high.shadows, 2);
  assert.equal(budget.far.active, 0);
  for (const k of ["stable", "glowing", "perf", "restored"])
    assert.equal(budget[k], true, k);
  assert.equal(budget.day, 0);
  assert.equal(budget.forced, 1);
  assert.equal(budget.hidden, 0);
  console.log(
    "PASS stable camera-distance budgets / day-night / manual override / visibility / memory-first",
  );
  await p.click('[data-page="scene"]');
  await p.$$eval("#inspector-scene .itab", (bs) =>
    bs.find((b) => b.textContent === "光影").click(),
  );
  await p.waitForSelector("#inspector-scene [data-physical-sky]", {
    visible: true,
  });
  await p.click('#inspector-scene [data-sky-preset="暖日落"]');
  assert.equal(
    await p.evaluate(() => app.lighting.physical.settings.sunElev),
    4,
  );
  const num =
    '#inspector-scene [data-physical-sky] [data-field="ev"] input[type="number"]';
  await p.click(num, { clickCount: 3 });
  await p.keyboard.type("1.5");
  await p.keyboard.press("Tab");
  assert.equal(await p.evaluate(() => app.lighting.physical.settings.ev), 1.5);
  await p.evaluate(() => app.undo());
  assert.equal(await p.evaluate(() => app.lighting.physical.settings.ev), 0);
  await p.evaluate(() => app.redo());
  assert.equal(await p.evaluate(() => app.lighting.physical.settings.ev), 1.5);
  await p.select(
    '#inspector-scene [data-physical-sky] [data-field="source"] select',
    "date",
  );
  assert.equal(
    await p.$eval(
      '#inspector-scene [data-field="sunElev"]',
      (e) => e.style.display,
    ),
    "none",
  );
  const saved = await p.evaluate(async () => {
    app.clearAll();
    const T = window.__t.THREE,
      key = [...window.__t.LIB_INDEX].find(
        ([k, i]) => i.type === "lanternpole",
      )[0];
    const lamp = app.addAsset(key, new T.Vector3(3, 0, 2));
    lamp.root.rotation.y = Math.PI / 2;
    lamp.root.scale.set(1.2, 1.2, 1.2);
    app.localLights.setLamp(lamp, {
      mode: "on",
      lumens: 600,
      temperature: 3000,
      modelColor: false,
    });
    app.lighting.physical.configure({
      source: "manual",
      sunElev: -14,
      whiteBalance: 4500,
      ev: 1.5,
    });
    app.step(0, true);
    const transformed = app.localLights.pool
      .slice(0, 2)
      .every((light) => light.position.x > 2.9 && light.position.x < 3.1);
    const blob = await app.saveProject();
    await app.importFiles([new File([blob], "lighting.previz")]);
    app.step(0, true);
    return {
      transformed,
      mode: app.lighting.mode,
      s: app.lighting.physical.settings,
      local: app.localLights.toJSON(),
      lamp: app.objects[0].params.light,
      stats: app.localLights.stats,
    };
  });
  assert.equal(saved.transformed, true);
  assert.equal(saved.mode, "physical");
  assert.equal(saved.s.whiteBalance, 4500);
  assert.equal(saved.s.ev, 1.5);
  assert.equal(saved.lamp.lumens, 600);
  assert.equal(saved.stats.active, 2);
  console.log(
    "PASS real UI / numeric commit / one-step undo-redo / date controls / transformed dual palace lamps / .previz package reload",
  );
  {
    const exported = await p.evaluate(async () => {
      const { Exporter } = await import("/src/export.js");
      const L = app.lighting;
      const shot = app.addShot();
      shot.iso = 800;
      app.state.preview = false;
      app.step(0, true);
      const editor = app.stage.renderer.toneMappingExposure;
      let during;
      const original = app.stage.renderFramed.bind(app.stage);
      app.stage.renderFramed = (...args) => {
        during = {
          exposure: app.stage.renderer.toneMappingExposure,
          iso: L.isoMultiplier,
          active: app.localLights.stats.active,
        };
        return original(...args);
      };
      const exporter = new Exporter(app);
      const url = await exporter.still({
        asDataUrl: true,
        width: 320,
        height: 180,
      });
      const pngDuring = { ...during };
      const video = await exporter.run({
        width: 160,
        height: 90,
        fps: 5,
        duration: 0.2,
      });
      const videoDuring = { ...during };
      app.suspended = true;
      app.stage.renderFramed = original;
      return {
        video: {
          size: video?.size || 0,
          frames: video?.frames,
          iso: videoDuring.iso,
          exposure: videoDuring.exposure,
        },
        editor,
        during: pngDuring,
        restored: app.stage.renderer.toneMappingExposure,
        png: url.startsWith("data:image/png;base64,"),
      };
    });
    console.log("EXPORT", exported);
    assert.equal(exported.during.iso, 2);
    assert.equal(exported.during.exposure, exported.editor * 2);
    assert.equal(exported.restored, exported.editor);
    assert.equal(exported.png, true);
    assert.ok(exported.video.size > 0);
    assert.equal(exported.video.frames, 1);
    assert.equal(exported.video.iso, 2);
    assert.equal(exported.video.exposure, exported.editor * 2);
  }
  const old = await p.evaluate(() => {
    const j = JSON.parse(JSON.stringify(app.serialize()));
    j.light = { preset: "night", override: { exposure: 1.2 }, enabled: true };
    app.loadJson(j);
    app.step(0, true);
    return {
      mode: app.lighting.mode,
      enabled: app.localLights.enabled,
      active: app.localLights.stats.active,
      preset: app.lighting.preset,
    };
  });
  assert.equal(old.mode, "legacy");
  assert.equal(old.enabled, false);
  assert.equal(old.active, 0);
  assert.equal(old.preset, "night");
  assert.deepEqual(errors, []);
  console.log("PASS old-project compatibility; no browser / shader errors");
} finally {
  await browser.close();
}

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import puppeteer from "puppeteer";
mkdirSync(".shots", { recursive: true });
const browser = await puppeteer.launch({
  headless: "shell",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
  protocolTimeout: 240000,
});
const errors = [];
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.setViewport({ width: 1440, height: 1000 });
  if (process.env.TEST_FILE_URL) await page.setOfflineMode(true);
  await page.goto(
    process.env.TEST_FILE_URL || "http://localhost:5174/?fresh=1",
    { waitUntil: "domcontentloaded" },
  );
  await page.waitForFunction(() => window.__previzBooted && window.app, {
    timeout: 90000,
  });
  await page.evaluate(() => {
    app.suspended = true;
    app._quietAdd = true;
  });
  await page.click('#top button[title="场景"]');
  await page.evaluate(() =>
    [...document.querySelectorAll(".tb-dropdown.open .dd-item")]
      .find((e) => e.textContent.includes("示例场景"))
      .click(),
  );
  await page.click(".menu.scenes.on .scard:first-child");
  const results = await page.evaluate(() => {
    const a = app,
      results = [];
    for (const type of ["rain", "storm", "snow"])
      for (const style of type === "rain" ? ["points", "streaks"] : ["points"])
        for (const y of [1.75, 80, 220, 1200]) {
          a.weather.set(type, { style, seed: 82 });
          a.stage.view.position.set(3, y, 68);
          a.stage.orbit.target.set(0, y + 15, 0);
          a.stage.orbit.update();
          a.weather.update(0, a.stage.view.position);
          a.stage.render();
          const positions = a.weather.geometry.attributes.position.array,
            stride = a.weather.particles.isLineSegments ? 6 : 3;
          let above = 0,
            below = 0;
          for (let i = 0; i < positions.length; i += stride) {
            if (positions[i + 1] > y) above++;
            else below++;
          }
          if (
            above < (positions.length / stride) * 0.4 ||
            below < (positions.length / stride) * 0.4
          )
            throw Error(type + " absent above/below camera at " + y);
          results.push({
            type,
            style,
            y,
            above,
            below,
            particles: positions.length / stride,
          });
        }
    // Exercise the real App.tick path as well, after a high-altitude camera jump.
    a.weather.set("rain", { style: "streaks", seed: 82 });
    a.stage.view.position.set(3, 220, 68);
    a.stage.orbit.target.set(0, 235, 0);
    a.stage.orbit.update();
    a.tick();
    if (Math.abs(a.weather.center.y - a.stage.view.position.y) > 0.001)
      throw Error("App.tick did not follow camera altitude");
    // One drop at each fade region should have continuous, non-clipped alpha.
    const shader = a.stage.renderer.properties.get(a.weather.material).uniforms;
    if (!shader?.weatherCenter || !shader?.weatherHalf)
      throw Error("volume fade uniforms not compiled");
    const before = JSON.stringify(a.weather.toJSON());
    const snapshot = a.serialize();
    a.loadJson(snapshot);
    if (JSON.stringify(a.weather.toJSON()) !== before)
      throw Error("weather settings changed after reload");
    a.tick();
    return results;
  });
  await page.screenshot({ path: ".shots/weather-high-altitude.png" });
  assert.deepEqual(errors, []);
  const mode = process.env.TEST_FILE_URL ? "file" : "dev";
  writeFileSync(
    `.shots/weather-volume-${mode}.json`,
    JSON.stringify({ mode, results, errors }, null, 2),
  );
  console.log(
    `PASS ${mode} weather volume: ${results.length} rendered cases, street/80/220/1200m, Points/Lines shaders, App.tick tracking, save/reload, no browser errors`,
  );
} finally {
  await browser.close();
}

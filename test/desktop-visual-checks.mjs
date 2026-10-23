// Shared UI assertions: run in Chromium with Tauri-like CSP and in the actual installed WebView2.
export async function inspectDesktopVisuals(page) {
  return await page.evaluate(async () => {
    const a = app,
      wasSuspended = a.suspended,
      wasPlaying = a.state.playing;
    a.suspended = true;
    a.state.playing = false;
    const backup = a.serialize({ assets: false }),
      oldPreview = a.state.preview;
    const violations = [];
    const onViolation = (e) =>
      violations.push({
        directive: e.effectiveDirective,
        blocked: e.blockedURI,
      });
    document.addEventListener("securitypolicyviolation", onViolation);
    const color = (n) => {
      const s = getComputedStyle(n);
      return {
        background: s.backgroundColor,
        image: s.backgroundImage,
        width: parseFloat(s.width),
        height: parseFloat(s.height),
      };
    };
    try {
      a.openViewportTools?.();
      const themes = [...document.querySelectorAll(".skin-dot")].map(color);
      document.querySelector(".viewport-tools-panel header button")?.click();
      a.clearAll();
      a.terrain.setEnabled(false);
      a.state.showHelpers = true;
      a.state.preview = false;
      const shot = a.addShot({ name: "Desktop Camera Label", duration: 1 });
      a.addShot({ name: "Second Camera", duration: 1 });
      a.setActiveShot(shot);
      a.select({ kind: "shot", shot });
      a.step(0, true);
      const cameras = [...document.querySelectorAll(".shot")].map((n) => ({
        name: n.querySelector(".snm")?.textContent,
        dot: n.querySelector(".dot") ? color(n.querySelector(".dot")) : null,
        tag: n.querySelector(".stag")?.textContent,
      }));
      const cv = shot.label.userData.cv,
        pixels = cv
          .getContext("2d")
          .getImageData(0, 0, cv.width, cv.height).data;
      let opaque = 0;
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) opaque++;
      const sprite = {
        bodyVisible: shot.body.visible,
        labelVisible: shot.label.visible,
        canvasOpaquePixels: opaque,
        textureWidth: cv.width,
        textureHeight: cv.height,
      };
      // Test real UI layout/string-created style attributes as well as el().
      a.setPreview(true); a.step(0, true);
      await new Promise(r => setTimeout(r, 1100));
      const hud = document.querySelector('.shot-tag');
      const previewTag = hud ? { text: hud.textContent, active: hud.classList.contains('on'), dot: hud.querySelector('i') ? color(hud.querySelector('i')) : null } : null;
      a.setPreview(false); a.step(0, true);
      const marker = document.createElement("div");
      marker.innerHTML =
        '<i style="background:rgb(10, 20, 30);width:9px;height:9px;display:inline-block"></i>';
      document.body.append(marker);
      const markup = color(marker.firstChild);
      marker.remove();
      const cameraIcons = [
        ...document.querySelectorAll("#camera-list .orow"),
      ].map((n) => ({
        name: n.querySelector(".onm")?.textContent,
        svg: !!n.querySelector(".odot svg"),
        icon: n.querySelector(".odot")?.textContent,
      }));
      const light = [
        ...document.querySelectorAll("#inspector-scene .itab"),
      ].find((n) => n.textContent === "光影");
      if (light) light.click();
      // The classic preset swatches are intentionally only rendered in legacy mode.
      const mode = a.lighting.mode;
      a.lighting.setMode("legacy");
      if (light) light.click();
      const atmos = [...document.querySelectorAll(".acard .sw")].map(color);
      a.lighting.setMode(mode);
      await new Promise((r) => setTimeout(r, 100));
      return {
        themes,
        cameras,
        cameraIcons,
        sprite,
        previewTag,
        markup,
        atmos,
        violations,
        webgl: a.stage.renderer
          .getContext()
          .getParameter(a.stage.renderer.getContext().VERSION),
        origin: location.origin,
      };
    } finally {
      document.removeEventListener("securitypolicyviolation", onViolation);
      a.loadJson(backup);
      await a.projectAssets.ready();
      a.state.preview = oldPreview;
      a.state.playing = wasPlaying;
      a.suspended = wasSuspended;
    }
  });
}
export function desktopVisualFailures(report, baseline = false) {
  const failures = [];
  if (
    report.themes.length !== 3 ||
    report.themes[0].background !== "rgb(244, 239, 231)" ||
    report.themes[1].background !== "rgb(40, 41, 64)" ||
    !report.themes[2].image.includes("linear-gradient")
  )
    failures.push("theme colors");
  if (
    !report.atmos.length ||
    report.atmos.some(
      (n) =>
        !n.image.includes("linear-gradient") || n.width <= 0 || n.height <= 0,
    )
  )
    failures.push("atmosphere swatches");
  if (
    report.cameras.length !== 2 ||
    report.cameras.some(
      (n) =>
        !n.name ||
        !n.tag ||
        !n.dot ||
        n.dot.background === "rgba(0, 0, 0, 0)" ||
        n.dot.width <= 0,
    )
  )
    failures.push("camera list color/name/tag");
  if (
    !baseline &&
    (report.cameraIcons.length !== 2 ||
      report.cameraIcons.some((n) => !n.svg || !n.name))
  )
    failures.push("camera SVG icon/name");
  if(!report.previewTag?.active||!report.previewTag.text.includes('Desktop Camera Label')||report.previewTag.dot?.background==='rgba(0, 0, 0, 0)') failures.push('preview camera label/color');
  if (
    !report.sprite.bodyVisible ||
    !report.sprite.labelVisible ||
    report.sprite.canvasOpaquePixels < 500
  )
    failures.push("3D camera body/nameplate");
  if (
    report.markup.background !== "rgb(10, 20, 30)" ||
    report.markup.width !== 9
  )
    failures.push("HTML markup style attributes");
  if (report.violations.some((v) => v.directive.startsWith("style-src")))
    failures.push("runtime inline style rejected by CSP");
  return failures;
}

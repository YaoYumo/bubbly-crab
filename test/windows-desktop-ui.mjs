process.on('uncaughtException', e => {
  console.log('::error title=Installed WebView2 probe error::'+String(e.stack||e).replaceAll('%','%25').replaceAll('\n','%0A').replaceAll('\r','%0D'));
  process.exit(1);
});
process.on('unhandledRejection', e => {
  console.log('::error title=Installed WebView2 probe rejection::'+String(e.stack||e).replaceAll('%','%25').replaceAll('\n','%0A').replaceAll('\r','%0D'));
  process.exit(1);
});
import {
  inspectDesktopVisuals,
  desktopVisualFailures,
} from "./desktop-visual-checks.mjs";
// Real installed WebView2, accessed only by a loopback CDP port in CI.
// No native debug flags are baked into the distributed executable.
import puppeteer from "puppeteer";
import { writeFileSync } from "node:fs";
const baseline = process.argv.includes("--baseline");
let browser, last;
for (let n = 0; n < 30; n++) {
  try {
    browser = await puppeteer.connect({
      browserURL: "http://127.0.0.1:9222",
      protocolTimeout: 90000,
    });
    break;
  } catch (e) {
    last = e;
    await new Promise((r) => setTimeout(r, 1000));
  }
}
if (!browser) throw last;
let report;
try {
  let page;
  for (let n = 0; n < 30; n++) {
    page = (await browser.pages()).find((p) =>
      p.url().includes("tauri.localhost"),
    );
    if (page) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!page) throw Error("Installed Tauri WebView page not found");
  await page.waitForFunction(() => window.__previzBooted && window.app, {
    timeout: 90000,
  });
  report = await inspectDesktopVisuals(page);
  const failures = desktopVisualFailures(report, baseline);
  report = {
    ...report,
    baseline,
    failures,
    status: failures.length ? "FAIL_VISUAL_CHECKS" : "PASS_REAL_WEBVIEW2_UI",
  };
  const file = baseline
    ? ".shots/windows-ui-baseline.json"
    : ".shots/windows-ui-fixed.json";
  writeFileSync(file, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
  // Annotation API is reachable from the sandbox even when artifact blob storage is not.
  console.log(
    "::notice title=Windows WebView2 visual checks::" +
      JSON.stringify(report)
        .replaceAll("%", "%25")
        .replaceAll("\n", "%0A")
        .replaceAll("\r", "%0D"),
  );
  if (failures.length && !baseline)
    throw Error("Native WebView2 visual regression: " + failures.join(", "));
} finally {
  browser.disconnect();
}

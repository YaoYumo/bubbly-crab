import puppeteer from 'puppeteer';
const b = await puppeteer.launch({ headless:'shell', args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const p = await b.newPage(); await p.setViewport({width:1400,height:860});
const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,160))});
await p.goto('http://localhost:5173/?fresh=1',{waitUntil:'networkidle2'});
await p.waitForFunction(()=>window.app&&window.app.objects.length>3,{timeout:60000});
await new Promise(r=>setTimeout(r,900));
console.log(JSON.stringify(await p.evaluate(async () => {
  const { app, THREE } = window.__t;
  const { motionJson } = await import('/src/prompts.js');
  const s = app.shots[0];
  app.setActiveShot(s); s.rig.updateMatrixWorld(true);
  app.state.time = 0; s.applyTo(app.stage.view, 0, 0, 1.85);
  const j = motionJson(app);
  const k0 = j.keyframes[0];
  // three 参考值
  const wp = new THREE.Vector3().fromArray(k0.pos_world);
  const real = s.rig.localToWorld(new THREE.Vector3().fromArray(k0.pos));
  const fwd = new THREE.Vector3(0,0,-1).applyQuaternion(s.rig.quaternion.clone().multiply(new THREE.Quaternion().fromArray(k0.quat)));
  const yaw = (Math.atan2(-fwd.x, -fwd.z) * 180) / Math.PI;
  const pitch = (Math.asin(THREE.MathUtils.clamp(fwd.y, -1, 1)) * 180) / Math.PI;
  return { keys: j.keyframes.length, worldPosErr: +wp.distanceTo(real).toFixed(4),
    yawErr: +Math.abs(k0.yaw_deg - yaw).toFixed(2), pitchErr: +Math.abs(k0.pitch_deg - pitch).toFixed(2),
    fwdErr: +Math.hypot(k0.forward_world[0] - fwd.x, k0.forward_world[1] - fwd.y, k0.forward_world[2] - fwd.z).toFixed(4),
    yaw: k0.yaw_deg, yawRef: +yaw.toFixed(1), pitch: k0.pitch_deg, pitchRef: +pitch.toFixed(1),
    subjects: j.subjects.map(x=>({n:x.name,anim:x.anim,keys:x.keys.length})), scene: !!j.scene, origin: j.world_origin,
    cam: j.camera, move: j.move, dur: j.duration_s };
}), null, 1));
console.log('errs', errs.slice(0,3));
await b.close();

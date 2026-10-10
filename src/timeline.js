// ---------------------------------------------------------------------------
// 时间轴：播放条 + 关键帧刻度 + 剪辑片段（当前机位 / 选中物体路径）
// ---------------------------------------------------------------------------
import { el, clear, clamp, fmt, timecode } from './util.js';

export function buildTimeline(app, host) {
  const wrap = el('div', { class: 'tl' });
  const playBtn = el('button', { class: 'pbtn sm', type: 'button', title: '播放/暂停 (空格)', html: '▶' });
  const stopBtn = el('button', { class: 'pbtn sm', type: 'button', title: '回到起点', html: '⏮' });
  const loopBtn = el('button', { class: 'pbtn sm' + (app.state.loop ? ' on' : ''), type: 'button', title: '循环', html: '↻' });
  loopBtn.addEventListener('click', () => { app.state.loop = !app.state.loop; loopBtn.classList.toggle('on', app.state.loop); });
  playBtn.addEventListener('click', () => toggle());
  stopBtn.addEventListener('click', () => { app.state.time = 0; app.state.playing = false; app.bus.emit('time'); });

  /* 2-track container */
  const tracks = el('div', { class: 'tracks' });
  const trackLabels = [
    { icon: '📷', label: 'Video' },
    { icon: '🎵', label: 'Audio' },
  ];
  const trackRows = [];
  for (const tl of trackLabels) {
    const row = el('div', { class: 'track-row' });
    const label = el('div', { class: 'track-label' }, [el('span', { class: 'i', text: tl.icon }), tl.label]);
    const track = el('div', { class: 'track' });
    const fill = el('div', { class: 'tfill' });
    const head = el('div', { class: 'thead' });
    const ticks = el('div', { class: 'tticks' });
    const clips = el('div', { class: 'tclips' });
    track.append(ticks, clips, fill, head);
    row.append(label, track);
    tracks.appendChild(row);
    trackRows.push({ row, track, fill, head, ticks, clips, label: tl.label });
  }

  /* timeline clips state */
  if (!app.timeline.clips) app.timeline.clips = [];
  const DEFAULT_CLIP_DUR = 0.15;

  const tc = el('span', { class: 'tc' });
  const dur = el('input', { class: 'nml', type: 'number', min: 0.5, max: 60, step: 0.5, value: app.state.duration });
  dur.addEventListener('input', () => { app.state.duration = clamp(parseFloat(dur.value) || 6, 0.5, 120); redraw(); app.bus.emit('time'); });
  const fps = el('select', { class: 'nsl' });
  for (const f of [24, 25, 30, 50, 60]) fps.appendChild(el('option', { value: f, selected: f === app.state.fps, text: f + 'fps' }));
  fps.addEventListener('change', () => { app.state.fps = +fps.value; app.bus.emit('fps'); });
  const spd = el('select', { class: 'nsl' });
  for (const s of [0.25, 0.5, 1, 2]) spd.appendChild(el('option', { value: s, selected: s === app.state.speed, text: s + '×' }));
  spd.addEventListener('change', () => { app.state.speed = +spd.value; });

  wrap.append(
    el('div', { class: 'tl-l' }, [playBtn, stopBtn, loopBtn, el('span', { class: 'tsep' }), spd]),
    el('div', { class: 'tl-c' }, [tracks]),
    el('div', { class: 'tl-r' }, [
      tc,
      el('span', { class: 'tsep' }),
      el('button', {
        class: 'pbtn sm wide', type: 'button', title: '关键帧曲线：拖点改快慢（快捷键 V）', text: '📈 曲线',
        onclick: () => { if (!app.curve) return; app.curve.toggle(); curveBtn.classList.toggle('on', app.curve.isOpen); if (app.curve.isOpen) app.curve.draw(); },
      }),
      el('span', { class: 'tsep' }),
      el('label', { class: 'mni', text: '时长' }), dur,
      el('span', { class: 'tsep' }), fps,
    ]),
  );
  host.appendChild(wrap);
  const curveBtn = wrap.querySelector('.tl-r button');

  function toggle() {
    app.state.playing = !app.state.playing;
    playBtn.innerHTML = app.state.playing ? '❚❚' : '▶';
    if (app.state.playing && app.activeShot && !app.state.preview) {
      app._viewSave = app._viewSave || { p: app.stage.view.position.toArray(), q: app.stage.view.quaternion.toArray(), f: app.stage.view.fov, t: app.stage.orbit.target.toArray() };
      app.state.preview = true;
      app.stage.preview = true;
      app.stage.previewControls.activate();
      app.bus.emit('preview');
    }
    if (!app.state.playing && app.state.preview) {
      app.stage.previewControls.deactivate();
    }
    app.stage.orbit.enabled = !app.state.playing && !app.state.preview;
  }
  let dragging = false;
  const seek = (clientX) => {
    const r = trackRows[0].track.getBoundingClientRect();
    const u = clamp((clientX - r.left) / r.width, 0, 1);
    app.state.time = u * app.state.duration;
    app.bus.emit('time');
  };
  for (const tr of trackRows) {
    tr.track.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.tclip')) return;
      dragging = true; tr.track.setPointerCapture(e.pointerId); seek(e.clientX);
    });
    tr.track.addEventListener('pointermove', (e) => { if (dragging) seek(e.clientX); });
    tr.track.addEventListener('pointerup', (e) => { dragging = false; });
  }

  /* Video track: drop to create clip */
  const camTrack = trackRows[0].track;
  camTrack.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; camTrack.classList.add('dragover'); });
  camTrack.addEventListener('dragleave', () => { camTrack.classList.remove('dragover'); });
  camTrack.addEventListener('drop', (e) => {
    e.preventDefault();
    camTrack.classList.remove('dragover');
    const shotIdx = e.dataTransfer.getData('text/shot');
    if (shotIdx === '') return;
    const s = app.shots[+shotIdx];
    if (!s) return;
    const r = camTrack.getBoundingClientRect();
    const u = clamp((e.clientX - r.left) / r.width, 0, 1);
    const clip = { shotIdx: +shotIdx, start: u, end: Math.min(1, u + DEFAULT_CLIP_DUR), color: s.colorHex || '#4A90D9' };
    app.timeline.clips.push(clip);
    app.setActiveShot(s);
    app.state.time = u * app.state.duration;
    app.bus.emit('time');
    app.bus.emit('clips');
  });

  /* right-click context menu for clips */
  let ctxMenu = null;
  function showClipMenu(clip, x, y) {
    removeClipMenu();
    const u = app.timeline.u;
    const canSplit = u > clip.start + 0.005 && u < clip.end - 0.005;
    const items = [
      el('button', { class: 'tl-ctx-item', text: '删除片段', onclick: () => { removeClip(clip); removeClipMenu(); } }),
      el('button', { class: 'tl-ctx-item', text: '设为当前机位', onclick: () => { app.setActiveShot(app.shots[clip.shotIdx]); removeClipMenu(); } }),
    ];
    if (canSplit) {
      items.push(el('button', { class: 'tl-ctx-item', text: '在此分割', onclick: () => { splitClip(clip, u); removeClipMenu(); } }));
    }
    ctxMenu = el('div', { class: 'tl-ctx' }, items);
    ctxMenu.style.left = x + 'px';
    ctxMenu.style.top = y + 'px';
    document.body.appendChild(ctxMenu);
    setTimeout(() => document.addEventListener('pointerdown', removeClipMenu, { once: true }), 10);
  }
  function removeClipMenu() { if (ctxMenu) { ctxMenu.remove(); ctxMenu = null; } }
  function removeClip(clip) {
    const i = app.timeline.clips.indexOf(clip);
    if (i >= 0) { app.timeline.clips.splice(i, 1); app.bus.emit('clips'); }
  }
  function splitClip(clip, u) {
    const newClip = { shotIdx: clip.shotIdx, start: u, end: clip.end, color: clip.color };
    clip.end = u;
    const idx = app.timeline.clips.indexOf(clip);
    app.timeline.clips.splice(idx + 1, 0, newClip);
    app.bus.emit('clips');
  }

  /* clip dragging */
  let clipDrag = null;
  function onClipPointerDown(e, clip) {
    e.stopPropagation();
    if (e.button === 2) { showClipMenu(clip, e.clientX, e.clientY); return; }
    const r = trackRows[0].track.getBoundingClientRect();
    const startX = e.clientX;
    const startLeft = clip.start;
    const w = clip.end - clip.start;
    clipDrag = { clip, r, startX, startLeft, w };
    const onMove = (e2) => {
      if (!clipDrag) return;
      const dx = (e2.clientX - clipDrag.startX) / clipDrag.r.width;
      let newStart = clamp(clipDrag.startLeft + dx, 0, 1 - clipDrag.w);
      clip.start = newStart;
      clip.end = newStart + clipDrag.w;
      app.bus.emit('clips');
    };
    const onUp = () => {
      clipDrag = null;
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  function drawClips() {
    const camTrackRow = trackRows[0];
    clear(camTrackRow.clips);
    app.timeline.clips.forEach((clip) => {
      const shot = app.shots[clip.shotIdx];
      const name = shot ? shot.name : `机位 ${clip.shotIdx + 1}`;
      const clipEl = el('div', {
        class: 'tclip',
        style: `left:${(clip.start * 100).toFixed(2)}%;width:${((clip.end - clip.start) * 100).toFixed(2)}%;background:${clip.color || '#4A90D9'}`,
        title: `${name} · ${fmt(clip.start * app.state.duration, 1)}s – ${fmt(clip.end * app.state.duration, 1)}s · 拖边缘裁剪 · 右键分割/删除`,
      }, [
        el('span', { class: 'tclip-nm', text: name }),
        el('div', { class: 'tclip-trim tclip-trim-l', 'data-side': 'l' }),
        el('div', { class: 'tclip-trim tclip-trim-r', 'data-side': 'r' }),
      ]);
      clipEl.addEventListener('pointerdown', (e) => {
        if (e.target.classList.contains('tclip-trim')) {
          e.stopPropagation();
          startTrim(e, clip, e.target.dataset.side);
          return;
        }
        onClipPointerDown(e, clip);
      });
      clipEl.addEventListener('contextmenu', (e) => { e.preventDefault(); showClipMenu(clip, e.clientX, e.clientY); });
      camTrackRow.clips.appendChild(clipEl);
    });
  }

  /* trim dragging */
  let trimDrag = null;
  function startTrim(e, clip, side) {
    const r = trackRows[0].track.getBoundingClientRect();
    trimDrag = { clip, side, r, startX: e.clientX, origStart: clip.start, origEnd: clip.end };
    const onMove = (e2) => {
      if (!trimDrag) return;
      const dx = (e2.clientX - trimDrag.startX) / trimDrag.r.width;
      if (trimDrag.side === 'l') {
        clip.start = clamp(trimDrag.origStart + dx, 0, clip.end - 0.01);
      } else {
        clip.end = clamp(trimDrag.origEnd + dx, clip.start + 0.01, 1);
      }
      app.bus.emit('clips');
    };
    const onUp = () => {
      trimDrag = null;
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  /* determine active shot from clips + playhead */
  function syncClipPlayback() {
    const u = app.timeline.u;
    const activeClip = app.timeline.clips.find(c => u >= c.start && u < c.end);
    if (activeClip && app.shots[activeClip.shotIdx]) {
      if (app.activeShot !== app.shots[activeClip.shotIdx]) {
        app.setActiveShot(app.shots[activeClip.shotIdx]);
      }
    }
  }

  function redraw() {
    dur.value = app.state.duration;
    const u = app.timeline.u;
    for (const tr of trackRows) {
      tr.fill.style.width = (u * 100).toFixed(3) + '%';
      tr.head.style.left = (u * 100).toFixed(3) + '%';
    }
    tc.textContent = `${timecode(app.state.time, app.state.fps)} / ${fmt(app.state.duration, 1)}s`;
    playBtn.innerHTML = app.state.playing ? '❚❚' : '▶';
    if (app.state.playing) syncClipPlayback();
  }
  function drawTicks() {
    for (const tr of trackRows) clear(tr.ticks);
    const s = app.activeShot;
    if (s) {
      const camTrack = trackRows[0];
      s.keys.forEach((k, i) => camTrack.ticks.appendChild(el('i', { class: 'tk' + (i === s.selKey ? ' on' : ''), style: `left:${(k.t * 100).toFixed(2)}%`, title: `K${i + 1} · ${(k.t * 100).toFixed(0)}%`, onclick: (e) => { e.stopPropagation(); app.selectKey(s, i); app.state.time = k.t * app.state.duration; app.bus.emit('time'); } })));
    }
    for (const so of app.objects) {
      if (so.motion?.active) {
        const vidTrack = trackRows[0];
        so.motion.keys.forEach((k) => vidTrack.ticks.appendChild(el('i', { class: 'tk o', style: `left:${((k.t || 0) * 100).toFixed(2)}%`, title: `${so.name} 走位` })));
      }
    }
  }
  app.bus.on('time', () => { redraw(); drawTicks(); });
  app.bus.on('tick', () => { redraw(); });
  app.bus.on('select', drawTicks);
  app.bus.on('shot-change', () => { drawTicks(); drawClips(); });
  app.bus.on('objects', drawTicks);
  app.bus.on('shots', () => { drawTicks(); drawClips(); });
  app.bus.on('preview', redraw);
  app.bus.on('clips', drawClips);
  redraw();
  drawTicks();
  drawClips();
  return { redraw, drawTicks, toggle };
}

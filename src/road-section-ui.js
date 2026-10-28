import { el } from './util.js';
import { LANE_ROADS, sectionForRoad, sectionDimensions } from './road-section.js';

export function roadSectionControls(app, so = null) {
  const rb = app.roadBrush, root = el('div', { class: 'road-section-controls' });
  const road = () => (so&&(app.byId(so.id)||so)?._roadData) || { roadType: rb.roadType, width: rb.roadWidth };
  const controls = {};
  const fields = [
    ['laneCount', '车道总数', 1, 12, 1], ['laneWidth', '单车道宽 m', 2, 5, .1],
    ['shoulderWidth', '单侧路肩 m', 0, 5, .1], ['sidewalkWidth', '单侧步道 m', 0, 6, .1],
  ];
  const commit = (key, value) => {
    const rd = road();
    const section = sectionForRoad(rd.roadType.id, rd.width, rd.roadType.section);
    if (!section || !Number.isFinite(value)) { render(); return; }
    section[key] = value;
    if (so) rb.updateRoadProperties(app.byId(so.id)||so, { section }); else rb.setSection(section);
    render();
  };
  for (const [key, label, min, max, step] of fields) {
    const input = controls[key] = el('input', { class: 'num', type: 'number', min, max, step, dataset: { roadProperty: key },
      'aria-label': label, onchange: e => commit(key, e.target.valueAsNumber) });
    root.append(el('div', { class: 'row' }, [el('label', { class: 'lab', text: label }), el('div', { class: 'ctl' }, [input])]));
  }
  const path = el('input', { class: 'num', type: 'number', min: 1, max: 20, step: .5, dataset: { roadProperty: 'pathWidth' },
    'aria-label': '非机动车道铺装宽度 m', onchange: e => { if (so) rb.updateRoadProperties(app.byId(so.id)||so, { width: e.target.valueAsNumber }); else rb.setWidth(e.target.valueAsNumber); render(); } });
  const pathRow = el('div', { class: 'row' }, [el('label', { class: 'lab', text: '铺装宽 m' }), el('div', { class: 'ctl' }, [path])]);
  const summary = el('div', { class: 'fnote', dataset: { roadSectionSummary: '1' }, 'aria-live': 'polite' });
  root.append(pathRow, summary);
  function render() {
    const rd = road(), id = rd.roadType.id, section = sectionForRoad(id, rd.width, rd.roadType.section);
    for (const [key] of fields) {
      const input = controls[key]; input.closest('.row').hidden = !section;input.closest('.row').style.display=section?'':'none';
      input.disabled = !!so?.locked || (id === 'freeway' && key === 'sidewalkWidth');
      if (section&&input!==document.activeElement) input.value = section[key];
    }
    controls.laneCount.min = id === 'oneway' ? 1 : 2; controls.laneCount.step = id === 'oneway' ? 1 : 2;
    pathRow.hidden = !!section;pathRow.style.display=section?'none':''; path.value = rd.width; path.disabled = !!so?.locked;
    if (section) {
      const d = sectionDimensions(id, section);
      summary.textContent = `车行铺装 ${d.pavementWidth.toFixed(2)} m · 含路侧总宽 ${d.outerWidth.toFixed(2)} m。${id === 'oneway' ? '' : '双向按两侧均分车道。'}增加车道、路肩或步道均不拉伸单条车道。${rd.roadType.section ? '' : '旧路保留原几何；修改分项后启用此截面。'}`;
    } else summary.textContent = '花园小径、碎石路为非标车道铺装，单独设置铺装宽度。';
  }
  render();
  if (!so) {
    const off = app.bus.on('road-section', () => { if (!root.isConnected) { off(); return; } render(); });
    const offEdit = app.bus.on('road-edit', () => { if (!root.isConnected) { offEdit(); return; } render(); });
  }
  return root;
}

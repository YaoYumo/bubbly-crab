// ---------------------------------------------------------------------------
// 「一句话生成街区」对话框（Scene 页）
// 纯本地解析 → 实时预览参数 chips → 一次生成（一步撤销）
// ---------------------------------------------------------------------------

import { el, clear } from './util.js';
import { parsePromptLocally, describeSchema, randomSeed } from './towngen.js';
import { generateTown } from './townbuild.js';
import { TEMPLATES, matchTemplate, templateById } from './templates.js';
import { autoCamera } from './autocam.js';

// 示例按「布局展示」排序：前三个分别演示方格 / 中轴 / 放射（点第一个即是整齐无环路的路网）
const EXAMPLES = [
  '棋盘格的现代城区，林荫，商业20%',
  '中轴对称的仿古小镇，棋盘格局',
  '放射状路网的老城区，黄昏',
  '现代住宅区与中式古建混搭，林荫',
  '黄昏的加州林荫小镇，商业30%，丘陵',
  '下雨的新英格兰老城区，晚上，纯住宅',
  '沙漠小镇，512米，稀疏，正午，种子 4242',
];

/** 打开对话框；返回关闭函数 */
export function openTownDialog(app) {
  if (document.querySelector('.tg-mask')) return () => {};

  let seedOverride = 0;          // 0 = 跟随文本里的种子 / 随机
  let layoutPick = null;         // 手动「道路布局」点选（最高优先；输入文字即清除）
  let templatePick = null;       // 手动「场景模板」点选（最高优先；输入文字即清除）
  let parsed = parsePromptLocally('');

  const ta = el('textarea', {
    class: 'tg-input', rows: 3, spellcheck: 'false',
    placeholder: '例：黄昏的加州林荫小镇，512米，商业30%，丘陵\n（只认关键词，认不出的词会明确列出来，不会偷偷丢掉）',
  });
  const matchedBox = el('div', { class: 'tg-chips' });
  const noteBox = el('div', { class: 'tg-note' });
  const genBtn = el('button', { class: 'tg-btn pri', type: 'button', text: '生成街区' });
  const cancelBtn = el('button', { class: 'tg-btn', type: 'button', text: '取消' });
  const statusEl = el('div', { class: 'tg-status', text: '' });

  // ---- 道路布局：显式点选（不依赖关键词/防抖；高亮 = 当前生效拓扑） ----
  const LAYOUTS = [
    ['grid', '方格网'], ['axis', '中轴对称'], ['radial', '放射状'], ['spine_and_loop', '主干道+环路'],
  ];
  const layoutBtns = [];
  const layoutRow = el('div', { class: 'tg-lrow' });
  for (const [v, label] of LAYOUTS) {
    const b = el('button', { class: 'tg-chip act', type: 'button', title: `路网布局：${label}`, text: label });
    b.onclick = () => { layoutPick = layoutPick === v ? null : v; render(); };
    layoutBtns.push({ b, v });
    layoutRow.appendChild(b);
  }

  // ---- 场景模板：点选覆盖 / 关键词自动命中（方案 A 的入口） ----
  const tplBtns = [];
  const tplRow = el('div', { class: 'tg-lrow' });
  for (const t of TEMPLATES) {
    const b = el('button', { class: 'tg-chip act', type: 'button', title: t.hint, text: t.label });
    b.onclick = () => { templatePick = templatePick === t.id ? null : t.id; render(); };
    tplBtns.push({ b, id: t.id });
    tplRow.appendChild(b);
  }

  function render() {
    const schema = { ...parsed.schema, seed: seedOverride || parsed.schema.seed };
    if (layoutPick) schema.roadTopology = layoutPick;   // 点选覆盖文本解析结果
    const eff = schema.roadTopology;
    for (const { b, v } of layoutBtns) b.classList.toggle('on', v === eff);
    const effTpl = templatePick || matchTemplate(ta.value)?.id || null;
    for (const { b, id } of tplBtns) b.classList.toggle('on', id === effTpl);
    clear(matchedBox);
    for (const c of describeSchema(schema)) matchedBox.appendChild(el('span', { class: 'tg-chip', text: c.label }));
    const reroll = el('button', { class: 'tg-chip act', type: 'button', title: '换一个随机种子', text: '⟳ 种子' });
    reroll.onclick = () => { seedOverride = randomSeed(); render(); };
    matchedBox.appendChild(reroll);

    clear(noteBox);
    if (parsed.unsupported.length) {
      noteBox.appendChild(el('div', {
        class: 'tg-warnline',
        text: '暂不支持（已忽略）：' + parsed.unsupported.map((u) => `${u.text}→${u.hint}`).join('、'),
      }));
    }
    if (parsed.ignored.length) {
      noteBox.appendChild(el('div', { class: 'tg-warnline dim', text: '没看懂：' + parsed.ignored.join('、') }));
    }
    if (!parsed.matched.length && !parsed.unsupported.length && !parsed.ignored.length) {
      noteBox.appendChild(el('div', { class: 'tg-warnline dim', text: '用默认参数生成一座 256m 郊区小镇' }));
    }
    genBtn.textContent = parsed.matched.length || ta.value.trim() ? '生成街区' : '生成默认小镇';
  }

  // 同步解析：不设防抖。预览 iframe / 后台页的 setTimeout 会被 Chrome 节流到 1s+，
  // 防抖会导致「解析结果停在默认（主干道+环路）」和「点生成时用旧 parsed」两类事故。
  // 输入法组合期（isComposing）跳过，compositionend 再解析一次。
  const parseNow = () => {
    seedOverride = 0;
    layoutPick = null;
    templatePick = null;
    parsed = parsePromptLocally(ta.value);
    render();
  };
  ta.addEventListener('input', (e) => { if (!e.isComposing) parseNow(); });
  ta.addEventListener('compositionend', parseNow);

  const examples = el('div', { class: 'tg-examples' });
  for (const ex of EXAMPLES) {
    const b = el('button', { class: 'tg-chip act', type: 'button', text: ex });
    b.onclick = () => { ta.value = ex; seedOverride = 0; layoutPick = null; templatePick = null; parsed = parsePromptLocally(ex); render(); ta.focus(); };
    examples.appendChild(b);
  }

  const modal = el('div', { class: 'tg-modal', role: 'dialog' }, [
    el('div', { class: 'tg-head' }, [
      el('b', { text: '一句话生成街区' }),
      el('span', { class: 'tg-sub', text: '本地关键词解析 · 不联网 · 不消耗积分' }),
      (() => { const x = el('button', { class: 'tg-x', type: 'button', text: '✕' }); x.onclick = close; return x; })(),
    ]),
    el('div', { class: 'tg-body' }, [
      ta, examples,
      el('div', { class: 'tg-plabel', text: '场景模板' }), tplRow,
      el('div', { class: 'tg-plabel', text: '道路布局' }), layoutRow,
      el('div', { class: 'tg-plabel', text: '解析结果' }), matchedBox, noteBox, statusEl,
    ]),
    el('div', { class: 'tg-foot' }, [
      el('span', { class: 'tg-hint', text: '生成会清空当前场景，Ctrl+Z 可一次退回 · Ctrl+Enter 生成' }),
      cancelBtn, genBtn,
    ]),
  ]);
  const mask = el('div', { class: 'tg-mask' }, [modal]);
  document.body.appendChild(mask);
  requestAnimationFrame(() => mask.classList.add('on'));

  function close() {
    mask.classList.remove('on');
    document.removeEventListener('keydown', onKey, true);
    setTimeout(() => mask.remove(), 160);
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); run(); }
  }
  document.addEventListener('keydown', onKey, true);
  mask.addEventListener('pointerdown', (e) => { if (e.target === mask) close(); });
  cancelBtn.onclick = close;
  genBtn.onclick = run;

  function run() {
    // 生成前同步重解析：以输入框当前内容为准 + 布局点选覆盖，绝不依赖防抖定时器
    parsed = parsePromptLocally(ta.value);
    if (layoutPick) parsed.schema.roadTopology = layoutPick;
    render();
    const schema = { ...parsed.schema, seed: seedOverride || parsed.schema.seed };
    genBtn.disabled = cancelBtn.disabled = true;
    statusEl.textContent = '生成中…';
    // 让「生成中」先绘制出来：生成本身是同步的重活
    setTimeout(() => {
      let stats, tpl = null;
      try {
        const tplId = templatePick || matchTemplate(ta.value)?.id || null;
        tpl = tplId ? templateById(tplId) : null;
        if (tpl) {
          // 方案 A：模板槽位搭建（内部已含方案 C 的自动运镜，一步撤销）
          const r = tpl.build(app, { seed: schema.seed });
          stats = { tpl: true, label: tpl.label, ...r, schema, ms: 0 };
        } else {
          stats = generateTown(app, schema, {
            onProgress: (p, label) => { statusEl.textContent = `生成中… ${Math.round(p * 100)}% ${label}`; },
          });
          // 方案 C：为一句话生成的街区离线自动配机位（独立撤销组）
          const before = app.shots.length;
          app.batchOp('自动运镜', () => { autoCamera(app, {}); app.select(null); });
          stats.autoShots = app.shots.length - before;
        }
      } catch (e) {
        console.error('[towngen]', e);
        statusEl.textContent = '';
        genBtn.disabled = cancelBtn.disabled = false;
        app.notify('生成失败：' + (e?.message || e), 'err');
        return;
      }
      close();
      genBtn.disabled = cancelBtn.disabled = false;   // 成功也复位：disabled 会吞掉后续点击
      const msg = tpl
        ? `已用模板「${tpl.label}」搭建：${stats.objects} 物体 · ${stats.shots} 机位（${stats.auto} 自动） · ${stats.motions} 段运动 · Ctrl+Z 可整场退回`
        : `已生成 ${stats.schema.mapSize}m 街区：${stats.roads} 条路 / ${stats.houses} 栋建筑${stats.towers ? `（含 ${stats.towers} 塔楼）` : ''} / ${stats.trees} 棵树 · 自动配 ${stats.autoShots || 0} 个机位（${stats.ms}ms）`;
      app.notify(stats.warnings?.length ? msg + ' · ' + stats.warnings.join('；') : msg, 'ok');
      window.__townStats = stats;
    }, 30);
  }

  render();
  ta.focus();
  return close;
}

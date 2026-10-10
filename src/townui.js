// ---------------------------------------------------------------------------
// 「一句话生成街区」对话框（Scene 页）
// 纯本地解析 → 实时预览参数 chips → 一次生成（一步撤销）
// ---------------------------------------------------------------------------

import { el, clear } from './util.js';
import { parsePromptLocally, describeSchema, randomSeed } from './towngen.js';
import { generateTown } from './townbuild.js';

const EXAMPLES = [
  '黄昏的加州林荫小镇，商业30%，丘陵',
  '下雨的新英格兰老城区，晚上，纯住宅',
  'a grid suburb at noon, flat, dense, no trees',
  '沙漠小镇，512米，稀疏，正午，种子 4242',
];

/** 打开对话框；返回关闭函数 */
export function openTownDialog(app) {
  if (document.querySelector('.tg-mask')) return () => {};

  let seedOverride = 0;          // 0 = 跟随文本里的种子 / 随机
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

  function render() {
    const schema = { ...parsed.schema, seed: seedOverride || parsed.schema.seed };
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

  let timer = 0;
  ta.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { seedOverride = 0; parsed = parsePromptLocally(ta.value); render(); }, 110);
  });

  const examples = el('div', { class: 'tg-examples' });
  for (const ex of EXAMPLES) {
    const b = el('button', { class: 'tg-chip act', type: 'button', text: ex });
    b.onclick = () => { ta.value = ex; seedOverride = 0; parsed = parsePromptLocally(ex); render(); ta.focus(); };
    examples.appendChild(b);
  }

  const modal = el('div', { class: 'tg-modal', role: 'dialog' }, [
    el('div', { class: 'tg-head' }, [
      el('b', { text: '一句话生成街区' }),
      el('span', { class: 'tg-sub', text: '本地关键词解析 · 不联网 · 不消耗积分' }),
      (() => { const x = el('button', { class: 'tg-x', type: 'button', text: '✕' }); x.onclick = close; return x; })(),
    ]),
    el('div', { class: 'tg-body' }, [ta, examples, el('div', { class: 'tg-plabel', text: '解析结果' }), matchedBox, noteBox, statusEl]),
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
    const schema = { ...parsed.schema, seed: seedOverride || parsed.schema.seed };
    genBtn.disabled = cancelBtn.disabled = true;
    statusEl.textContent = '生成中…';
    // 让「生成中」先绘制出来：生成本身是同步的重活
    setTimeout(() => {
      let stats;
      try {
        stats = generateTown(app, schema, {
          onProgress: (p, label) => { statusEl.textContent = `生成中… ${Math.round(p * 100)}% ${label}`; },
        });
      } catch (e) {
        console.error('[towngen]', e);
        statusEl.textContent = '';
        genBtn.disabled = cancelBtn.disabled = false;
        app.notify('生成失败：' + (e?.message || e), 'err');
        return;
      }
      close();
      const msg = `已生成 ${stats.schema.mapSize}m 街区：${stats.roads} 条路 / ${stats.houses} 栋建筑 / ${stats.trees} 棵树（${stats.ms}ms）`;
      app.notify(stats.warnings.length ? msg + ' · ' + stats.warnings.join('；') : msg, 'ok');
      window.__townStats = stats;
    }, 30);
  }

  render();
  ta.focus();
  return close;
}

// 把模板里「该运镜预设其实不认」的参数键从 p:{} 里删掉（这些键在运行时会被忽略，留着只是噪音）
// 用法：node scripts/strip-dead-move-params.mjs
import fs from 'fs';
const { MOVES } = await import('../src/camera.js');
const declared = {};
for (const m of MOVES) declared[m.id] = (m.params || []).map((p) => p.k);

let touched = 0, dropped = 0;
for (const f of ['src/scenes.js', 'src/scenes2.js']) {
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  const out = lines.map((line) => {
    const mv = /mv: '([a-zA-Z]+)'/.exec(line);
    const pp = /p: \{([^}]*)\}/.exec(line);
    if (!mv || !pp || !declared[mv[1]]) return line;
    const keep = [];
    const drops = [];
    for (const seg of pp[1].split(',')) {
      const s = seg.trim();
      if (!s) continue;
      const k = /^([a-zA-Z0-9_]+):/.exec(s);
      if (k && !declared[mv[1]].includes(k[1])) { drops.push(k[1]); continue; }
      keep.push(s);
    }
    if (!drops.length) return line;
    touched++; dropped += drops.length;
    return line.replace(pp[0], `p: { ${keep.join(', ')} }`.replace(/\{ \}/, '{ }'));
  });
  fs.writeFileSync(f, out.join('\n'));
}
console.log(`模板行改动 ${touched} 处，删掉被忽略的参数键 ${dropped} 个`);

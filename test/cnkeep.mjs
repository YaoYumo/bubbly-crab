// 导演台中式古建组守卫：替换件/保留件名单护栏（node test/cnkeep.mjs）
import { GROUP_CN, CN_FROZEN } from '../src/arch.js';
const expect = ['hall', 'hall2', 'pavilion', 'paifang', 'pagoda', 'gate', 'citywall', 'corridor', 'archbridge', 'drumtower', 'courtyard', 'moongate', 'lanternpole', 'earthterrace', 'folkhouse', 'streetshop', 'ding', 'spiritway'];
const types = GROUP_CN.items.map(i => i.type);
let fail = 0;
const ck = (n, ok, x = '') => { if (!ok) fail++; console.log(`${ok ? '✓' : '✗'} ${n}${x ? ' · ' + x : ''}`); };
ck('中式组 18 件齐全', JSON.stringify(types.slice().sort()) === JSON.stringify(expect.slice().sort()), types.length + ' 件');
ck('保留件名单 = 牌楼/神道', JSON.stringify(CN_FROZEN.slice().sort()) === JSON.stringify(['paifang', 'spiritway']));
for (const t of CN_FROZEN) {
  const it = GROUP_CN.items.find(i => i.type === t);
  ck(`${t} 在库且带 frozen 标记`, !!it && it.frozen === true);
  ck(`${t} builder 为初版原函数`, ['buildPaifang', 'buildSpiritWay'].includes(it.build.name), it.build.name);
}
for (const it of GROUP_CN.items) if (!CN_FROZEN.includes(it.type)) ck(`${it.type} 非保留件无 frozen 误标`, it.frozen !== true);
console.log(fail ? `CNKEEP FAIL ${fail}` : 'CNKEEP ALL PASS');
process.exit(fail ? 1 : 0);

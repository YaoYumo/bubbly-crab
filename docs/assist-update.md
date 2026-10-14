# 3D 导演台模型提交 · 协助更新说明

- 日期：2026-10-14　分支：`arena/569e88f3-bubbly-crab`　乙方：视觉编码代理（甲方：导演台使用方）
- 依据：`docs/model-handoff.md` 合同（§1.5 参数化、§3 红线 A–J、§4.3 修补单、§4.4 白名单）

## 1. 提交范围

导演台（:5174「3D 导演工作室」）模型库 **中式古建组（cat `cn`）共 18 件** 全量提交：
其中 **16 件为本轮重建/升级替换**，**2 件按甲方指定保留不替换**。
替换件与保留件共用同一套 builder 入口（`src/arch.js` → `GROUP_CN` → `src/assets.js` LIB），
导演台面板、中式城镇主题、出图画廊自动同步，无需另外导入。

## 2. 替换清单（16 件）

| type | 名称 | 依据 |
|---|---|---|
| hall / hall2 | 宫殿大殿 / 歇山殿宇 | 图板 01/02 + 修补单（重檐庑殿三重台基、山花博风）；二层平座木平台+木栏杆、下檐屋面按平台截断 |
| pavilion | 攒尖亭 | 图板 03（风铃檐椽葫芦顶） |
| pagoda | 楼阁式佛塔 | 图板 04（刹链风铃佛龛；下层屋顶外环_only） |
| gate | 城门 | 图板 05（券洞门钉铺首；券脸连续） |
| citywall | 城墙 | 图板 06（夯土芯垛口石嘴） |
| corridor | 游廊 | 图板 07（漏窗雀替美人靠） |
| archbridge | 拱桥 | 图板 08（螭首抱鼓水面） |
| drumtower | 鼓楼·钟楼 | 图板 09 + 修补单 09（十字券洞真穿透、券衬半筒 YXZ、铜钟/滴漏、木平座+木地板+木栏杆、屋面按平台截断、脊件截断、檐口沉量） |
| courtyard | 四合院 | 图板 10（垂花门、影壁、门墩抱鼓石、厢房格窗） |
| folkhouse | 民居 | 图板 11（硬山相重整：山面出檐收、博风/悬鱼/脊端帽） |
| moongate | 月亮门 | 图板 12（环面券脸、漏窗、门额、卵石铺地、波浪墙帽） |
| lanternpole | 宫灯杆 | 图板 13（莲花座、云头挑臂、丝灯、中国结） |
| streetshop | 街铺 | 图板 14（招牌檐篷柜台） |
| earthterrace | 土台 | 图板 15（夯土台基磴道） |
| ding | 铜鼎 | 库内修整轮次 |

## 3. 保留清单（2 件，不替换）

| type | 名称 | 状态 |
|---|---|---|
| paifang | 牌楼牌坊 | `frozen: true`，builder `buildPaifang` 保持初版（64ed1a0）原样 |
| spiritway | 石像生神道 | `frozen: true`，builder `buildSpiritWay` 保持初版（64ed1a0）原样 |

护栏（防未来误替换）：
- `src/arch.js`：`export const CN_FROZEN = ['paifang', 'spiritway']` + 条目 `frozen: true` 标记；
- `test/cnkeep.mjs`：守卫测试——中式组 18 件名单、保留件 frozen 标记、保留件 builder 必须仍为初版原函数、非保留件不得误标 frozen。`node test/cnkeep.mjs` → `CNKEEP ALL PASS`。
- 解冻流程：需甲方书面解除 → 同步删除 `frozen` 标记与 `CN_FROZEN` 条目并改 `test/cnkeep.mjs` 期望，缺一不可。

## 4. 验证结果（提交时点）

- `node test/cnkeep.mjs`：CNKEEP ALL PASS；
- `test/libblock.mjs`：175 模型 0 问题；`test/libaudit.mjs`：42/286 不增（历史遗留不追）；
- `test/imgcheck.mjs`【A】：与基线逐字一致（无新增剪影碎块）；
- `test/_float.mjs`（cn 全件）：无浮空/游离构件（四合院 2 件历史 Extrude 例外，甲方已知）；
- `test/entry.mjs` / `test/townstyle.mjs`（withchrome，:5174）：ALL PASS；`test/_editbench.mjs`：33/33；
- `test/towngen.mjs` / `test/townbuild.mjs` / `test/roadcross.mjs`：ALL PASS / ALL CLEAN；
- 四视图 sheets（`shots/cn_*.png`，画廊 :5180）人工复核：屋顶坐合、平座截断、无穿插。

## 5. 服务与端口

| 端口 | 服务 | 启动命令 |
|---|---|---|
| 5174 | 3D 导演工作室（导演台） | `npx vite --host 0.0.0.0 --port 5174 --strictPort` |
| 5175 | 新模型工作区（Showcase，两排 15 件陈列 + 部件编辑） | `npx vite showcase --host 0.0.0.0 --port 5175 --strictPort` |
| 5180 | 模型库出图画廊 | `node test/gallery.mjs 5180` |

浏览器测试统一 `bash test/withchrome.sh node test/<name>.mjs`（Chrome 走 npm 域 @sparticuz/chromium，不依赖外网 CDN）。

## 6. 后续协作流程

1. 甲方在导演台「部件编辑」导出修补单（§4.3 格式）→ 乙方参数化烘焙进 builder（不开运行时补丁）；
2. 每轮提交 = 主体 commit + `test/out` 截图 follow-up commit（惯例）；
3. 保留件（牌楼/神道）如出现缺陷：默认**只修红线级问题**（浮空/断开/穿模），不改风格；任何改动须先解冻；
4. 门禁基线以本说明第 4 节为锚，新增失败须当轮清零或经甲方书面豁免。

## 7. 本轮提交索引（节选）

`b12ea6e`(16a 新建三件) → `f5d6b8d`(16b 四件升级) → `a04a542`(showcase 两排) → `df60aec`(编辑态落排修复) →
`ba7b8ba`(鼓楼结构) → `79f586c`(木平座) → `cf55164`(平座截断屋面) → `2dc50ae`(脊件截断) →
`1b39b73`(修补单 09 烘焙) → 本提交（提交导演台 + 保留件冻结 + 守卫 + 本说明）。

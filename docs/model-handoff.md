# 模型库双 AI 协作交付规范（model-handoff）

> 版本：2026-10-12 ｜ 适用分支：`arena/3f9ececc-bubbly-crab`（含 main 的一句话生成）
> 读者：**负责产模型的外部 AI**（下称「乙方」）与**负责集成验收的代理**（下称「甲方」）。
> 这份文档就是两边的合同：交付什么、长什么样、怎么算合格、不合格怎么回传。

---

## 0. 结论先行：推荐与分工

### 0.1 工具推荐

本仓库的模型是 **three.js 程序化构建器（代码）**，不是静态网格文件 —— 所以选乙方的三条硬判据：

1. **有视觉**：能直接看 PNG（`shots/` 渲染图），能自己发现"悬浮/缝隙"；
2. **能在仓库里干活**：能跑命令（`node test/shots.mjs`）、能改文件、能看 diff；
3. **three.js / 程序化建模**水平过关（坐标系、Euler 旋转顺序、参数化尺寸）。

| 推荐 | 工具 | 为什么 |
|---|---|---|
| **首选** | **带视觉的编程代理：Gemini CLI**（或同级：Claude Code、ChatGPT Codex） | 同时满足三条判据；直接在仓库里渲染→看图→改代码，闭环最短 |
| 备选 | 网页版多模态对话（任意）+ 手工贴图 | 没有仓库权限时用；只适合当"眼睛"出缺陷单（模式甲） |
| 不推荐当主力 | 文生 3D 网格工具（Meshy / Tripo / Rodin / 混元3D 等） | 产出是**静态网格**，与本仓库"程序化 + 参数化 + 无外部资源"架构不匹配；只有走 §2.2 路线 B 才能接入 |

**选型方法**：别先批量。用 §6 的启动提示词让候选工具做一个**试点模型**（推荐 `furniture:dining_set`，小、有典型缺陷），甲方跑一遍 §4 验收，谁合格用谁。

### 0.2 三种分工模式

| 模式 | 乙方做什么 | 甲方做什么 | 适用阶段 |
|---|---|---|---|
| **甲（推荐起步）** | **当眼睛**：看 `shots/` 渲染图 + `imgcheck` 输出，产出标准缺陷单（§4.3） | 按缺陷单改代码、几何复核定性、跑全量验收 | 现在——缺陷多、你懒得描述的阶段 |
| **乙** | **当手**：直接写/修构建器代码（§2.1 交付） | 只跑验收流水线，出缺陷单回传，迭代 | 乙方通过试点之后 |
| **丙（远期）** | 文生 3D 出网格（`.glb`） | 先实现 glTF 导入路径，再按 §2.2 契约验收 | 仅限有机形状/道具补型 |

你（人类）始终是最终裁决：`http://<预览>:5180/` 画廊翻图，一句话定位即可（格式同 §4.3）。

---

## 1. 仓库与模型架构（乙方必读）

### 1.1 模型 = 程序化构建器，没有外部资源

```js
// 每个模型是一个函数：参数 → THREE.Group（全部几何现场生成）
function buildCapeCod(p) {
  const g = new THREE.Group();
  // p.width / p.depth / p.wallColor / ... 来自参数表
  g.add(box(w, wallH, d, wallMat, 0, foundH + wallH / 2, 0));
  ...
  return shade(g);
}
// 注册进模型库（组 → 条目）
{ type: 'cape_cod', name: 'Cape Cod 鳕鱼角式', icon: 'house',
  build: buildCapeCod, params: [PR('width', '宽 m', 6, 14, 0.5, 9), ...] }
```

- 运行时 `buildAsset(item, defaultsFor(item))` 重建实例。
- **`SceneObj.serialize()` 只存 `key + params`** —— 拖进场景的模型每次都是重新执行构建函数。
  ⚠️ 推论：**静态网格（glb/obj）目前无法持久化**，这是路线 B 要先改架构的原因。
- 全库 **16 组 / 172 个模型**：`house suburban functional garage furniture road traffic vegetation bld cn cls in nat war sci fx`。

### 1.2 单位、坐标、落地

- 单位**米**，**Y 轴向上**，原点在**落地中心**（底面 y=0），模型"站"在地面上。
- 正面朝 **+Z**；正面视图 = 从 +Z 往 −Z 看。
- 对称模型（大多数房屋/家具）**左右对称**是硬要求（烟囱、侧门廊等明确不对称的除外）。

### 1.3 工具箱（就用这些，别引新依赖）

| 类别 | API | 位置 |
|---|---|---|
| 基本体 | `box / cyl / sph / cone / planeXZ / row / ring / seg` | `src/geo.js` |
| 材质 | `M.paint / metal / stone / wood / concrete / dark / glassy / glass / leaf / glow / emissive / water / tile`（`M.glass` 会给构件打 `userData.role='glass'`，供遮挡检查用） | `src/geo.js`、`src/assets.js` |
| 屋面/中式 | `curvedRoof / roofSurf / eaveCornice / hipRidge / gableSlabs / dougong / ridgeOrnament / stoneRail` | `src/geo.js` |
| 收尾 | `shade(g)`（顶点明暗）、`cnShade(g)`（中式）、`mergeSimilar / bakeMerge`（同材质合批降 drawcall） | `src/geo.js` |
| 参数助手 | `PR(键,标签,最小,最大,步进,默认)` / `PI`(整数) / `PB`(布尔) / `PC`(颜色) | 各构建文件顶部 |
| 入口 | `buildAsset(item, params)`、`defaultsFor(item)`、`LIB` | `src/assets.js` |

### 1.4 文件地图

| 文件 | 内容 |
|---|---|
| `src/assets.js` | 美式库（house/suburban/functional/garage/furniture/road/traffic/... 构建器）+ 汇总 `LIB` |
| `src/arch.js` | 中式 `cn` / 古典 `cls` / 室内 `in` |
| `src/bld.js` | 通用构件 `bld`（墙、门、楼梯、塔吊…）+ `wallRun` |
| `src/nature.js` | 自然 `nat` / 植被 `vegetation` |
| `src/props.js` | 战争 `war` / 科幻 `sci` / 特效 `fx` |
| `src/panels.js` | 库面板 `buildLibrary`、分类 `SCENE_CATS` |
| `src/detail.js` | 细节档位 `lite / std / fine`（默认 `std`）——同一构建函数按档位调分段数 |
| `test/*.mjs` | 验收工具（§4） |

⚠️ **行号会漂移**：一律 `grep -n '^function buildXxx'` 定位，别记行号。

### 1.5 参数化是硬约束

滑动任何一个参数滑块，结构必须依然成立。**所有"缝、搭接、贴合"必须用参数表达式算出来**，禁止：

```js
// ❌ 硬编码凑合：换参数就悬空/穿插
g.add(box(1.1, 0.39, 0.05, m, 0, 0.195, 0));
// ✅ 从 p 推导：接触量写成公式
const legH = sY;                      // 腿顶 = 座板底，sY 变化腿跟着变
g.add(box(0.05, legH, 0.05, m, x, legH / 2, z));
```

---

## 2. 交付规范

### 2.1 路线 A（首选）：代码交付

**交付物**：对仓库的 git diff（或一个分支/PR），包含：

1. 构建函数 `buildXxx(p)`，放在该组对应的文件（§1.4）；
2. 注册条目 `{ type, name, icon, build, params }`（图标沿用同组现有值）；
3. 自检已通过（§2.3 清单）+ 三角预算说明。

**编码规约**：

- 单模型三角形数 ≤ 同类现有模型的 1.2×（用 `node test/_heavy.mjs <grp> <type>` 对比）；先 `bakeMerge` 合批，再降 `qseg/segments`；
- 禁止零厚度单面 `PlaneGeometry` 承担**结构**角色（地板、墙、台面必须有厚度；贴花除外，且贴花要 `side` 正确）；
- 新模型必须能被 4 视图渲染器收进 bbox（无游离到很远的构件）；
- 中式屋顶遵守既有决策：**单曲面 + 程序化瓦纹贴图**，只保留 3D 瓦当/滴水/脊兽（`tex` 路线），不要新增逐片瓦几何。

**交付自检（乙方必须先跑）**：

```bash
node --check src/xxx.js                                   # 语法
node test/shots.mjs <grp> <type> --ascii                  # ASCII 四视图，肉眼/视觉自查
node test/imgcheck.mjs <grp> <type> --parts 6             # 孤立块 + 对称（见 §4）
node test/libblock.mjs <grp> <type>                       # 门窗遮挡
```

### 2.2 路线 B（远期）：网格交付契约

只有甲方先实现 glTF 导入 + 序列化路径之后才生效。届时网格必须满足：

- **`.glb`（glTF 2.0）**，Y-up，单位米，**包围盒底面 y=0、几何中心 x=z=0**；
- 三角数 **≤ 8k/件**（建筑类 ≤ 20k），无退化面、无自穿插；
- 材质：**单张 PBR**（baseColor+metallicRoughness）**或顶点色**；透明玻璃单独 material 并命名 `glass_*`；
- 语义命名可选但强烈建议：`window_* / door_* / glass_*`（甲方的遮挡检查依赖命名/角色）；
- 附一张 4 视图渲染图（可用 `test/shots.mjs` 的渲染器出）。

### 2.3 合格标准（验收阈值）

| 检查 | 命令 | 阈值 |
|---|---|---|
| 语法 | `node --check src/*.js` | 0 错 |
| 门窗遮挡 | `node test/libblock.mjs` | **0 新增**（现基线 1：`sci:planet`） |
| 结构审计 | `node test/libaudit.mjs` | 不高于基线（`grep '^✗' \| wc -l` 对比 main） |
| 图片体检 | `node test/imgcheck.mjs --top 30` | 建筑/家具类**无 >0.5% 孤立块**；对称模型正视不对称 **<1%**（散点/有机体/天然不对称除外，见 §4.4 白名单） |
| 出图 | `node test/shots.mjs` | 全量出图无 crash；画廊可翻页 |
| 视觉抽查 | `5180` 画廊 / 乙方看图 | 缺陷单格式回传（§4.3） |

---

## 3. 质量红线：历史真实缺陷模式（每一条都发生过）

以下全部是本仓库修过的真实 bug，**验收时逐条对照**：

| # | 模式 | 真实案例 | 规则 |
|---|---|---|---|
| A | **悬浮/脱开** | `in:chair` 四条腿比座板短 3 cm，整椅悬空；`roll_top_desk` 侧板中心写成 `(deskH-0.08)/2`，桌面离板底 5.5 cm；`stairswitch` 休息平台只做了一跑宽，第二跑 10 踏步 + 2 斜梁整段没搭头 | 任何构件到地面必须有**连续支撑链**（互搭 ≥5 mm）；改动高度/中心公式后重新核两端 |
| B | **缝隙累积** | `doorroll` 帘片高 0.15 < 片距 0.16，整条帘子缝成虚线；`wallRun` 玻璃四周各留 2 cm 空气 | 应接触处**重叠 5–12 mm**（共面贴合视觉上算接上，但 3D 里要实体相交才算稳） |
| C | **贴面缩进** | `cape_cod` 山墙三角底边贴着墙顶，但外表面比墙面缩进 7 cm，侧看是道凹台 | 立面构件**外表面与所在墙面齐平**（x=±墙外皮）；"贴合"要三维核，不只核一条边 |
| D | **旋转符号/轴向** | craftsman 斜撑 `rotation.z = -s*0.6` 反号飞出柱外；`roll_top_desk` 卷帘 `rotation.y` 多转 90°，筒身横穿进深 | 对称件用 `s * θ`（s=±1）生成同侧异号；three.js Euler 默认 XYZ 顺序，**Rz 先于 Ry 生效** —— 加第二个旋转轴必须渲染验证 |
| E | **遮挡/穿插** | 12 处门窗被屋檐/招牌/腰线挡住 | 门窗玻璃前不得有实体；用 `libblock` 验；`M.glass` 的 role 标记别丢 |
| F | **零厚度单面** | `southern_colonial` 门廊地板是 plane，侧看等于没有 | 承力/可见面一律有厚度的 Box |
| G | **方向参数** | `stairRun` 沿 −Z 上升，`position.z` 加大会把楼梯推离房子 | 用带方向的工具（楼梯/坡道/卷帘）先读实现，渲染确认方向再调位置 |
| H | **比例失真** | 门 2.1 m、踏步 0.15×0.30、座高 0.45、桌高 0.75 —— 违反人机尺度一眼假 | 同组现有模型就是比例参照物 |
| I | **浮点精确匹配** | `params.radiusTop === 0.29` 匹配不到（实际 0.294） | 查 `geometry.parameters` 一律带容差（1e-6 或相对 1%），先 dump 全部候选再断言 |
| J | **参数稳健** | `roll_top_desk` 的帘片搭接写死 0.15 在 open 参数变化下失效 | 搭接量 = 表达式（`sh = show/n + 0.012`），随参数联动 |

**图片体检的定位原则**（甲方与乙方共用）：
> 图片筛查出**可疑名单** → 几何端点计算**定性**。
> 图片是有损投影（470px 正交 + z-buffer），历史上出现过误报（spanish_colonial 空 16 cm、post_office 空 28 cm）；**只凭截图不许改代码**。

---

## 4. 验收流水线（甲方执行）

### 4.1 自动检查

```bash
node --check src/assets.js src/arch.js src/bld.js src/nature.js src/props.js
node test/libblock.mjs                 # 门窗遮挡（171 模型，秒级）
node test/libaudit.mjs                 # 结构审计，VERBOSE=1 看明细
node test/imgcheck.mjs --top 30 --parts 6   # 全库 ~6s：孤立块 + 对称
node test/shots.mjs                    # 全量出图 171 张 ~11s → shots/
node test/imgcheck.mjs <grp> <type> --parts 8   # 对可疑模型单查
```

### 4.2 放大与几何核

```bash
node test/_zoom.mjs <grp> <type> "<x0,x1,y0,y1,z0,z1>" <视图0-3> <宽字符>   # 局部放大 ASCII 显微镜
# 视图: 0=正视 1=右侧 2=背面 3=轴测；先用 imgcheck 的像素框换算世界坐标
```

几何定性一律写临时脚本放 `test/` 下（ESM 导入 `three` 必须在仓库内运行），用 `Box3.setFromObject` 算端点，**不许只看图下结论**。

### 4.3 缺陷单格式（乙方→甲方，机器可消费）

```text
模型： bld:wall
视图： 正视 400²  像素框 x[77,142] y[167,232]
现象： 悬浮（玻璃离洞口内壁 2cm 四周漏风）
构件： BoxGeometry 1.10×1.10×0.02 @(-1.50, 1.50, -0.04)   ← imgcheck --parts 原样粘贴
定位： wallRun() 中 glass 尺寸 o.w-0.1（grep 可得）
```

人类手写也可以，只要带上 **`组:类型` + 哪个视图 + 现象** 三要素；甲方会自己渲染放大 + 几何复核。

### 4.4 孤立块/不对称白名单（别报了）

- **合法多块**：`nat:grass/flowers/reeds/rockpile`、`sci:debris`、`fx:clouds/lanterns`、`vegetation:*` —— 散点/有机体本就如此；
- **合法不对称**：烟囱、侧门廊、`bld:stairswitch`（双跑错位 ~96%）、`traffic:street_lamp`、`fx:lanterns`；
- **已知误报**：`in:bed` 曾因床头柜独立摆放被报（现已贴床沿）；地面标线（`doorroll` 的黄线）孤立属正常。

---

## 5. 给乙方的提示词（可直接复制）

```text
你在维护一个 three.js 程序化模型库（16 组 172 个模型，米制、Y-up、原点落地）。
先读 docs/model-handoff.md（交付规范 + 历史缺陷模式 + 验收命令），再动手。

本次任务（二选一）：
[模式甲] 打开 shots/ 画廊渲染图（或跑 node test/shots.mjs <组> 重出），
         对下列模型逐个出缺陷单（格式见文档 §4.3）：
         <模型列表>
         要求：每条缺陷必须附 imgcheck --parts 的构件行；只报图上可见的；
         报之前用 node test/_zoom.mjs 放大确认，分不清悬浮 vs 正常独立构件就标 [待核]。

[模式乙] 修复/新写下列构建器：<列表>
         要求：遵守文档 §1.5 参数化规则与 §3 质量红线（历史真实 bug 清单）；
         交付 = git diff；交付前自行跑 §2.3 四条自检并附输出。

禁止：引入外部资源/网络请求/新 npm 依赖；用 PlaneGeometry 做承力结构；
      对 geometry.parameters 做无容差的浮点相等判断。
```

---

## 6. 甲方联系与回归基线

- 集成分支：`arena/3f9ececc-bubbly-crab`，PR 目标 `main`（当前 PR #1 待合）。
- 回归基线命令与当前值（2026-10-12）：
  - `libblock`：1 flag（`sci:planet`）
  - `imgcheck`：建筑/家具类最大孤立块 < 0.5%（`roll_top_desk` 0、`stairswitch` 0.17% 栏杆立柱已修等）
  - `shots`：171 张
- 预览：编辑器 `5173`（带 no-store 防缓存头）、渲染画廊 `5180`。

---

*文档随仓库演进更新；改动质量阈值前先在本文件改，别只改代码。*

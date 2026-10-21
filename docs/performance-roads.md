# 道路性能专项：绘制调用与地形增量更新

> 本文保留上一轮测量与失败记录。旧远景路口门禁现已修复，重复建筑实例化也已加入，最新验证见 [按序开发记录](ordered-development.md)。

2026-10-16，接续[首轮性能诊断](performance.md)。本轮仅优先处理道路碎片 draw call 和地形编辑触发的道路全量重建；不改模型库，不扩展建筑实例化、LOD、复杂天空、窗灯或 Bloom。

## 同场景前后测量

原始记录及验证清单见 [evidence/manifest.json](performance-roads-evidence/manifest.json)，其中保留完整 before / after、源码与正式离线回归 JSON。环境为 Chromium 131 / Linux / ANGLE SwiftShader 软件渲染；GPU timer 不可用。沿用四个固定 fixture 的布局、960×540、DPR 1、std 和灯光预算。本轮对照预热 2 帧、采样 3 帧；不是硬件 FPS、稳定 p95 或跨设备加速承诺。

### 1. 绘制调用

计数含主场景及阴影通道；道路分类由 mesh 的所属道路对象归因。测试场景关闭后处理，类别合计与 renderer 调用总数相符。

| 固定场景 | 全帧 calls，前 → 后 | 道路 calls，前 → 后 | 提交三角形，前 → 后 |
| --- | ---: | ---: | ---: |
| 普通小镇 | 2,160 → 1,468 | 860 → 168 | 117,230 → 117,230 |
| 密集城区 | 6,846 → 5,466 | 1,716 → 336 | 344,030 → 344,078 |
| 地形植被 | 869 → 177 | 860 → 168 | 646,522 → 646,522 |
| 夜景多灯 | 1,075 → 785 | 425 → 135 | 62,542 → 66,226 |

密集城区道路调用下降 **80.4%**，全帧调用下降 **20.2%**。优化后 adobe 建筑仍占 5,088 次调用，是该 fixture 剩余的主要来源；本轮没有将其一并实例化。

合批让渲染包围球和视锥裁剪粒度变粗，故密集城区、夜景可能提交更多原有三角形；不能宣称所有场景的提交三角形都不变，也不是用删减几何换取 calls。独立的 110m 固定道路 A/B：全帧 **356 → 82 calls**，道路主场景＋阴影 **354 → 80**，三角形均 **11,462**；世界几何指纹 hash **1353071472**、计数 **17,172** 相同，320×180 输出像素采样差异 **0**。这一画面对照不代表覆盖全部道路角度和所有硬件。

### 2. 局部地形编辑 CPU

场景：129 网格、hills / amplitude 12 / seed 731；四条 140m、8m 宽的 asphalt 随地形道路，z = −45 / −15 / 15 / 45m。对 `(35,45)` 连续做三笔 raise，半径 8m、强度 0.6。计时包住 `paintAt + terrain 事件 + objects 事件`，不含随后 RAF / GPU 渲染。

| 项目 | 优化前 | 最终实现 |
| --- | ---: | ---: |
| 三次完整编辑 CPU，ms | 905.2 / 995.9 / 911.6 | 245.6 / 228.4 / 261.5 |
| 中位数，ms | 911.6 | 245.6 |
| 三笔合计替换道路 root | 12 | 3 |
| 细分 / 贴地变形合计，ms | 2,157.5（12 次） | 333.4（3 次） |
| 道路几何构建合计，ms | 2,199.7 | 432.4 |
| 网络更新合计，ms | 2,495.9 | 684.6 |
| 桥墩更新方法合计，ms | 541.4 | 236.0 |
| 障碍收集合计 | 24 次 / 18.7ms | 6 次 / 2.4ms |

完整编辑中位数约下降 **73.1%**。各计时包含子调用，**不能相加**；桥墩方法调用中含 busy / 缓存快速返回，不能将九次方法调用说成九次实际重建。三短样本仍有 JIT、GC 和沙箱负载波动；约 246ms 的编辑仍可感知，并非已经实现实时流畅拖动。

## 实现与正确性边界

### 分段内、严格兼容的几何合批

- 只处理新生成道路的单个 span / endcap，不跨整条道路或整个路网合并；保留道路对象、端点元数据及分段作用域。
- 精确比较材质属性、材质名、userData、纹理 / shader hook 身份以及阴影、层、renderOrder、顶点属性布局等；不按近似颜色或 roughness 粗略归并。透明、自定义回调 / 深度材质等不适合路径跳过。索引和非索引几何分桶，不为非索引几何额外生成无用索引。
- 合并后的渲染包围盒可能比原逐零件包围盒的并集更宽。`roadCollisionBounds` 通过 WeakMap 单独记录原逐零件 box / 矩阵，让桥墩碰撞和植被清理继续使用原语义；记录不持有已移除 mesh 或几何缓冲。变换后的边界也有专项对照。
- 释放已不再被道路引用的旧几何 / 材质；不释放仍在使用的共享资源，不改变全局纹理所有权。

### 减少细分分配

保留原最长边递归拆分、同样的插值与 Float32 落盘顺序，使用 typed-array 写入缓冲和标量距离运算，减少每顶点字典 / 数组及临时 Vector3。以旧参考算法对 indexed / non-indexed Box、三种缩放及旋转平移逐一比较所有 Float32 属性和 groups，结果完全相同；不是放宽细分阈值。

### 地形变化后的组件更新

- 对比路口处理之前的原始横断面高程采样，避免把上次路口整平结果误认为地形变化。
- 以路径范围扩张 `half + 3m` 做保守连通组件传播；连同可能相交的道路重建，使固定 / 跟随道路之间的平交与立交切换仍走既有网络恢复逻辑。
- 保留未受影响 root、对象顺序、ID、选中、gizmo 和材质显示策略；受影响道路重新绑定选择。远离道路的编辑专项中，替换道路为 0 条；局部编辑几何与强制全量更新的指纹相同。
- 这不是完整空间索引：仍需采样检查道路，包围范围可能过度连通；密集相交组件仍可能全部重建。改线、改道路参数和工程恢复继续走完整恢复路径。

### 桥墩依赖缓存

签名包含道路 / 障碍物状态与配置，并记录确定性布局过程中实际读取的候选地面高度。依赖未变则保留支撑；固定桥梁下的地面改变时仍刷新桥墩，不重建不变的桥面。新增 / 移动 / 隐藏普通障碍会使布局失效。缓存命中仍执行植物侵入清理，避免新种的树穿入旧桥墩或桥面。

## 新的诊断入口

工具栏 **性能 → 测一帧绘制归因**：请求下一帧，按模型种类 / 道路 / 桥墩列出主场景与阴影回调计数，并保留最近一次结果及 renderer 差额。另显示道路最近一次重建 / 保留数量和高程检测、细分变形、几何构建等 CPU 细项。

这是一次性 **mesh 回调归因，不是 GPU 计时或底层 GL 拦截**。后处理、非 mesh、本帧新节点可能未归因；空绘制等会使差额为负。采样有额外开销，默认不逐帧安装回调。结束 / 异常 / 中途暂停时恢复 renderer 状态与原回调；不会覆盖渲染期间由其它代码主动替换的新方法。重置清除旧归因。

## 验证与已知未通过门禁

通过：

- 新 `road-performance-regression`：精确细分、材质精度 / 阴影 / 碰撞边界、局部与远处 root、与全量几何对照、ID / 顺序 / 两类选中与 gizmo、灰模保持、固定桥墩、普通障碍失效 / 缓存植物清理、平交立交拓扑、像素和 calls A/B、回调 / renderer 恢复、实际诊断按钮。**源码及最终 `file://` 单文件均通过**。
- 源码 `performance-regression`、`terrain-roads-regression`（最新碰撞保护后重跑，含全体积桥墩、自交、植物、撤销和存档）、圆头、道路属性、T 路口、路口材质、区域规划专项通过。
- 最终正式离线包：`performance-regression`、`road-planning-offline`、`road-properties-offline`、`lighting-offline` 通过，包含实际工程包恢复、控件和灯光 / 导出冒烟。
- `npm run build` 与 `npm run build:single` 通过；离线 HTML **1,838,435 bytes**。仅有现有 chunk 大小提示。

**仍失败：旧 `test/junction-regression.mjs` 的 30° / height=600 / corner=3 远景像素断言，RGB `[118,137,156]`。** 关闭合批，以及关闭合批并换回旧细分 / 变形参考路径，都得到相同失败。未降低阈值、未删除断言；根因尚未修复，不能宣称全部路口门禁或整个历史总门禁全绿。专项通过不能替代此失败项。

本轮没有重跑全部历史模板 / UI 总门禁，也没有重跑首轮最终 8＋30 帧长采样；本次正式离线性能回归采用 2＋3。首轮长采样保留为历史证据，不冒充本轮结果。

## 复现

开发服务已在 5174 时执行；测量脚本会清空其独立测试页，请勿改成操作已有工程的页面。

```sh
bash test/withchrome.sh node test/measure-roads.mjs .shots/roads-measure.json
bash test/withchrome.sh node test/road-performance-regression.mjs
bash test/withchrome.sh node test/terrain-roads-regression.mjs
npm run build
npm run build:single
TEST_FILE_URL="file://$(pwd)/previz-lab.html?fresh=1&benchmark=1" \
  bash test/withchrome.sh node test/road-performance-regression.mjs
TEST_FILE_URL="file://$(pwd)/previz-lab.html?fresh=1" \
  bash test/withchrome.sh node test/performance-regression.mjs
bash test/withchrome.sh node test/road-planning-offline.mjs
bash test/withchrome.sh node test/road-properties-offline.mjs
bash test/withchrome.sh node test/lighting-offline.mjs
```

旧算法 before 是优化前实测存档；设置 `app.roadBrush.batchRoads=false` 只关闭合批，**不会**撤销 typed subdivision、增量更新或桥墩缓存，不能把它当作旧版整体 CPU 基线。

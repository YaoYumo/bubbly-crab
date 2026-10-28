# 混合道路路口材质与斑马线

- 路口的铺装由 `junctionSurface(plan.arms)` 查看所有接入道路统一确定，不再使用新画入道路的材质。
- 沥青优先级最高：`asphalt`、`oneway`、`freeway` 都是沥青铺装，任意一条接入即令路口车行面采用沥青颜色和粗糙度。
- 无沥青时使用稳定后备顺序：混凝土 → 碎石 → 花园小径。绘制、恢复顺序不影响结果。
- 斑马线以路口最终面层判断：最终为沥青时生成；最终非沥青时不生成。混合路口的斑马线位于统一的沥青路口面内。
- 停止线保留原有规则，本次不一并取消。原道路类型、路口几何、圆头、道路裁切和保存字段均不改。
- 修改道路类型、保存恢复后都重新计算铺装和斑马线。

验证通过：

```sh
node test/junction-material.test.mjs
bash test/withchrome.sh node test/junction-material-regression.mjs
bash test/withchrome.sh node test/t-junction-regression.mjs
bash test/withchrome.sh node test/junction-regression.mjs
npm run build
npm run build:single
```

纯几何检查全部 36 种道路类型组合 × 90/30 两种夹角；浏览器检查 9 组典型组合的正反绘制顺序、颠倒保存对象顺序后的恢复，以及混合 T 型改材质的再生成。斑马数量与实际生成的几何顶点数量一起校验，非仅修改标记字段。

T 型 8 组旧回归和十字路口 144 项角块可见性断言复跑通过，无 pageerror。没有重跑整套 UI 总门禁，不宣称完整套件全绿。

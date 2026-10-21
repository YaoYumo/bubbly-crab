# 已生成道路的类型与宽度编辑

## 使用

1. 双击 / Enter / 完成绘制按钮生成道路，然后按 Esc 退出画笔。
2. 在视口点选道路（不是自动路口面片），或从场景列表选择道路。
3. Scene 右栏会自动切到「物体」，在「道路参数」中修改：
   - 道路类型：选择后直接生效。
   - 宽度：拖动滑块结束时生效；数字输入后离开输入框生效。
4. 修改后仍选中同一道路，可继续改属性；Ctrl+Z / 重做支持逐次提交。
5. 要改控制点，再点「编辑此路（画笔接管）」；Esc 放弃该次改线并恢复原路。

宽度输入沿用现有画笔的 1–20m 范围，模型库原有结构下限仍有效（如高速路最小结构宽度 20m）。本次没有改动模型库。

## 状态与重建

- 保留道路 ID、名称、可见性及控制点、倒角、noJunct 属性。
- 完成属性编辑后退出画笔，重新选中生成后的道路。
- 圆头、相关道路缺口和路口重新生成；沥青优先及非沥青不生成斑马线规则继续生效。
- 跟踪该道路 ID 的摄像机目标在编辑完成 / 取消后恢复。
- 锁定道路不可改；当前存在未完成的道路绘制时拒绝提交，避免丢掉笔画。
- 属性改动清除旧重做分支；类型和宽度继续写入工程 JSON。

## 验证

```sh
bash test/withchrome.sh node test/road-properties-regression.mjs
bash test/withchrome.sh node test/road-endcap-regression.mjs
bash test/withchrome.sh node test/t-junction-regression.mjs
bash test/withchrome.sh node test/junction-regression.mjs
bash test/withchrome.sh node test/junction-material-regression.mjs
npm run build
npm run build:single
bash test/withchrome.sh node test/road-properties-offline.mjs
```

以上命令均通过。新回归包含实际鼠标绘制、Enter 完成、Esc 退出、真实视口再选中、检查器类型选择、数字宽度和拖滑块、实际网格/圆头尺寸、撤销重做、再次退出再选中、保存恢复、T 型路口重建、取消改线、目标 ID、锁定和未完成笔画保护。未重跑旧的完整 UI 总门禁。

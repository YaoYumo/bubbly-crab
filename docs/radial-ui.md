# 视口右键饼菜单与简洁生成框

## 本次改动

- 顶栏只有七个按钮：Direct、Scene、Camera、Generate、Export、性能、桌面检查。主题、变换、视图及工程功能移入二级面板，不删除原有能力。
- 在 3D 视口短按右键打开八项菜单；按住右键拖动仍平移视角。拖动距离按全程最大值判断，拖出去再拖回来也不会误开菜单。
- 对物体：移动、旋转、缩放、聚焦、复制、删除、撤销、工具 / 工程。受行为程序控制的物体不开放直接变换。
- 对机位：移动、旋转、聚焦机位、取景预览、记录关键帧、删除机位、撤销、工具 / 工程。先激活右击的机位，避免预览了另一个机位；新菜单记录关键帧有撤销记录。
- 对空白：添加模型、新建机位、一句话生成、网格、吸附、撤销、重做、工具 / 工程。
- 菜单贴近视口边缘时向内避让；视口过窄时变成可滚动的紧凑列表。Esc / 外点取消，方向键导航。聚焦画布后 Shift+F10 或菜单键也可打开。
- 视口右下「操作 · 右键」是备用入口，优先针对当前选择。
- 原工程保存、打开、导入、示例场景、主题、吸附、画幅、精度等可从「工具 / 工程」访问。工程操作位于其中的「场景」菜单。选择会打开另一弹层的命令时先关闭工具面板，避免遮挡示例场景或生成框。
- 播放、导出、参考采样、地形任务及笔刷等交互进行中，不打开饼菜单。

## 一句话生成

Scene 视口下方「一句话生成」打开位于**实际画布中央**的对话框，不是整页中央；侧栏、顶栏及时间轴不计入居中范围。调整视口或时间轴尺寸时重新定位，内容在框内滚动。

默认只显示标题、三行输入框、「更多选项」、必要提示和生成 / 取消按钮。预设示例、生成配方、模板、道路布局、解析参数全部收进默认关闭的「更多选项」，没有删除原生成能力。空输入不生成；Ctrl+Enter 生成、Esc 取消；输入文字或 Delete 不触发场景快捷键。关闭恢复焦点，切换页面清理观察器与键盘监听。

首次空白启动可自动打开简洁框；恢复已有工程（包括只有机位的工程）不抢先打开生成框。

## 实测

新增 `test/radial-menu.test.mjs`、`test/radial-ui-regression.mjs`，可运行：

```sh
npm run test:radial-ui
TEST_URL=http://localhost:5181/ bash test/withchrome.sh node test/radial-ui-regression.mjs
TEST_FILE_URL=file:///home/user/bubbly-crab/previz-lab.html bash test/withchrome.sh node test/radial-ui-regression.mjs
```

三种环境均通过：开发版、断网 file:// 单 HTML、带桌面 CSP 的预览。报告见 `radial-ui-evidence/{web,file,desktop-csp}.json`，截图在同目录。

覆盖：顶栏恰好七按钮、真实右击物体及机位拾取、机位激活、复制 / 删除 / 撤销、关键帧记录 / 撤销、右拖及回拖、选中对象备用入口、Esc 保留选择、边缘避让、1024 / 800 窗口、键盘操作、导出保护、视口居中、预设默认不可见、展开高级选项、输入不触发场景快捷键、取消不修改场景、默认简洁框实际生成及撤销、主题与示例场景入口可达。三平台 pageerror 与 CSP violation 均为空。

另外通过：

- `test/scene-recipes-regression.mjs`：本地配方、预览诊断、覆盖项、取消 / 注入失败回滚、旧版生成路径、撤销重做及工程回读。
- `test/spatial-dynamics-regression.mjs`：空间关系、动态参数及可移植节点映射。
- `test/camera-edit-regression.mjs`、`test/timeline-usability-regression.mjs`：镜头剪辑、导出切镜头、时间轴高度、关键帧默认隐藏、拖动修剪及窄窗口布局。
- `npm run test:desktop`、`npm run test:desktop:browser`：三主题色、机位 SVG / 标签、光影色卡、工程保存菜单、模拟原生保存队列、工程资源回读及导出；桌面浏览器回归无 CSP / pageerror / 出站请求。
- `npm run all`、`npm run build:desktop` 构建成功，离线文件为 `previz-lab.html`。

范围说明：没有运行完整 `npm test`。另尝试直接执行旧的 `test/scene-recipes.test.mjs` 和 `test/towngen.mjs`，受到现有用户模型静态 PNG import 的 Node 原生加载限制而失败（`ERR_UNKNOWN_FILE_EXTENSION`）；本次没有为此改变模型资源导入方式。对应生成逻辑的真实浏览器回归通过，不能据此宣称这些直接 Node 命令已通过。

以上为 Linux Chromium 和模拟 IPC 检查，不是原生 Windows / WebView2 验收。本次没有新建 Windows 安装器、签名或发布版本。

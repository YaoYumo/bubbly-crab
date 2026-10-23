# 1.2.3 模型拖入场景修复

## 丢失的位置

问题来自 1.2.0 模型库统一卡片结构（`e9b4e00`）中的拖拽来源：`src/library-ui.js` 用 `el('article', { draggable: true })` 创建卡片，而 DOM 工具会把布尔 true 输出为属性空字符串。`draggable` 是枚举属性而非 Boolean attribute；`draggable=""` 对 article 实际解析为 auto，`article.draggable` 为 false。1.2.2 调整分组 / 滚动布局时仍沿用了该属性，不是地形落点或视口接收丢失。

改为显式字符串 `draggable: 'true'`，让浏览器真正启动原生 HTML 拖拽。原模型 key、`text/asset` 载荷、视口 NDC → 地形 / 地面落点、用户资源加载路径、撤销均保留，没有用“点击放置”替代拖拽。

## 验证

新增 `npm run test:model-drag`：

- 修改前先断言真实 DOM 的枚举属性，复现卡片不可拖的失败。
- 使用 Puppeteer 的实际鼠标移动 / 按下起拖和 Chromium drag interception 获取原生 dragstart 载荷，然后完成浏览器 drag enter / over / drop。不是只给 canvas 构造一个合成 drop 事件。
- 从内置缩略图、名称文字和真实导入 OBJ 的模型卡片分别拖入视口；核对来源、鼠标对应落点、只放置一次、只增加一个撤销操作、撤销 / 重做。
- 点击放置仍只创建一次；拖到视口外或 Esc 取消不创建物体；删除 / 移动等卡片控件的 dragstart 不携带模型载荷。
- 开发版、断网 `file://` 单 HTML、桌面 CSP 前端均通过，无 pageerror / CSP violation，JSON 见 `model-drag-evidence/`。
- `npm run test:desktop`、`npm run all`、`npm run build:desktop` 通过；桌面 CSP 下重跑 1.2.2 的主题 / 模型库滚动 / 水面回归也通过。

这些是 Linux Chromium 前端检查，不是 Windows / WebView2 的完整拖拽实机验收。安装器另由 Windows job 构建并检查安装 / 窗口启动，实际下载链接与哈希见 `desktop-windows.md`。

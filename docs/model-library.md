# 统一模型缩略图与用户模型分组

## 使用方法

展开 Scene 左侧「模型库」：

- **导入至分组**：选择已有分组或先新建分组，再选择模型文件。支持 GLB、GLTF、FBX、OBJ；带外部资源的模型需要一并选择 BIN / MTL / 图片，或选择整个文件夹。
- 导入只保存到库，不自动添加场景物体，也不占用场景撤销记录。保持原始尺寸与原材质，放置后仍可在场景中缩放。
- 用户模型卡片支持点击放置、拖入视口、选择其他分组移动、删除。
- **内置模型「移除」**仅从当前本地库隐藏，可由「恢复内置」找回。没有修改、删除或重命名原始 LIB 定义和模型源文件，旧工程、生成配方及模板仍可重建。
- **用户模型「删除」**需要确认。删除库条目及不再被其他库条目使用的库资源；不删除场景实例、场景撤销记录或已导出的工程包。
- 1.2.2 分组改为紧凑下拉选择，模型卡片有独立滚动区，分组栏不再悬浮遮住模型；可以搜索模型名、分组名。

## 统一视觉

所有库卡片现在使用相同紧凑 16:9 画幅（1.2.2）、正交三分之四视角、棚拍光照、淡紫灰底与中性黏土材质。用固定的深色强调玻璃和暗部，保留模型的结构辨识度；不再混用线框 SVG、独立塔楼 PNG 预览等不同卡片风格。名称最多显示两行，完整名称在悬停提示及无障碍标签中保留。

这是真实模型渲染，不是图片生成的替代模型。预览只改变临时对象的材质，不改变放入场景的原材质、贴图、尺寸、几何或颜色。只在模型卡片进入可见区域附近时生成；复用一个独立 WebGL 渲染器，使用 128 张内存缓存，不借用视口、不切换场景精度。预览几何独立克隆并释放，不销毁场景可能共用的资源。播放、拖动和导出等期间暂停生成。无法创建预览时显示同框图标回退，不会禁用模型放置入口。

## 保存边界

- 用户模型、分组及内置隐藏状态保存在 **当前应用 / 浏览器来源的 IndexedDB 本地存储**，刷新可恢复，不上传文件。
- 网页、不同端口的预览和原生桌面壳不是同一个存储来源。清除应用数据也会清除本地模型库。
- 已放入场景的用户模型按内容哈希保存到独立工程资源体系，可随完整 `.previz` 工程包携带；仅导入库但未放置的模型，以及库分组，不随工程包同步。
- 库元数据与资源用原子事务写入；同内容重复导入只存一份库资源。删除一个同内容条目时，不破坏其他条目。
- 带版本检查的事务避免多个窗口互相覆盖库索引；发生冲突会重新读取并提示重试，而不是静默覆盖。
- 单次选择文件上限 192MB，模型资源仍遵循原工程资源的 64MB 存档限制；写入失败不会宣告入库成功。
- 本次没有新增模型库 ZIP 备份 / 跨应用同步功能。工程文件只能从原工程入口打开，库导入入口会拒绝工程文件，避免误替换场景。

## 实现位置

- `src/model-library.js`：本地元数据 / 资源存储、分组、导入、移动、删除、恢复、写入冲突保护。
- `src/library-ui.js`：Scene 与可选 Direct 模型库共用卡片、分组、搜索、导入 / 删除确认框。
- `src/library-thumbnails.js`：可见性队列、独立棚拍预览、缓存及图标回退。
- `src/app.js`：复用原模型解码和内嵌资源逻辑，增加只入库路径；库模型放置仍进入原场景 / 撤销 / 工程存档体系。

## 验证

`test/model-library-regression.mjs` 在以下三种环境均通过：

1. Vite 开发网页。
2. 断网 `file://` 单 HTML。
3. 带桌面 CSP 的前端预览。

报告与实际截图：`model-library-evidence/{web,file,desktop-csp}.json`、`gallery-*.png`、`imported-*.png`。

覆盖：统一真实 3D 预览、新建分组、OBJ + MTL + PNG 导入、GLB 与外部 BIN 的 GLTF、只入库不改变场景及撤销栈、点击 / 拖放、原材质贴图、跨组移动、刷新持久化、取消删除、删除后保留场景与撤销、删库后工程包独立回读、内置移除及恢复、去重资源在删除一个条目后仍可使用、只读保护、工程文件拒绝、多窗口写入冲突保护。三种环境 pageerror 与 CSP violation 均为空。

其他通过的回归：

- `test/import-formats-regression.mjs`：GLB 动画、外部 GLTF / BIN、FBX 与自包含工程归档。
- `test/project-resources-regression.mjs`：OBJ / MTL / PNG、资源去重、独立材质、撤销引用、无效载入不破坏场景、IndexedDB 恢复、实际库操作与精度重建。
- `npm run test:radial-ui`：右键菜单、视口生成框、复制删除撤销、机位、边缘与窄窗口。
- `test/camera-edit-regression.mjs`：镜头剪辑、工程回读、时间轴及真实导出切镜头。
- `npm run test:desktop` 与 `npm run test:desktop:browser`：桌面配置、三主题色、相机标签、工程保存、模拟 IPC、资源回读、导出；无 pageerror、CSP violation 或出站请求。
- `npm run all`、`npm run build:desktop` 构建成功。

复测新功能：

```sh
npm run test:model-library
TEST_URL=http://localhost:5181/ bash test/withchrome.sh node test/model-library-regression.mjs
TEST_FILE_URL=file:///home/user/bubbly-crab/previz-lab.html bash test/withchrome.sh node test/model-library-regression.mjs
```

以上是 Linux Chromium 与桌面前端检查，不是原生 Windows / WebView2 验收；未运行完整 `npm test`。本次未生成新的 Windows 安装包、签名或发布版本。

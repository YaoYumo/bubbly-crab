# Windows 轻量桌面版：Tauri 2 预检工程

## 下载安全状态：暂不推荐安装

2026-10-23 用户报告浏览器对 `previz-lab-windows-x64-unsigned.zip` 显示 **Dangerous download blocked**。该提示的具体检测类别仍未知，不能仅凭未签名就认定为误报。**先不要保留或运行该包，不关闭安全防护，不通过改名、加密压缩或重新托管来绕过拦截。**

历史构建 / 安装成功和哈希一致只证明来源与可运行性，不证明没有恶意软件，也不代表浏览器信誉通过。已核对**原始已发布 ZIP 和其中的原始二进制**哈希一致，但有效 Windows Defender 验证因 CI 环境排除设置 / 签名更新问题未完成；扫描不可用、失败或有检出均不会标为安全。即使单一引擎无检出，也不据此建议绕过浏览器阻止。后续检查记录见 `windows-package-security.md`。

## 下载并安装（给使用者）

[原始安装包 ZIP（排查中，暂不建议下载运行）](https://github.com/YaoYumo/bubbly-crab/actions/runs/39891196400/artifacts/12475121975)（可能需要登录 GitHub；本次 Actions 产物保留至2027-01-21，建议下载后本地保留）。

1. 解压 ZIP，在 `src-tauri/target/release/bundle/nsis/` 找到 `PREVIZ LAB_1.2.0_x64-setup.exe`。
2. 在 Windows x64 电脑双击安装器，使用当前用户安装。不要把同包的 `previz-lab.exe` 误认作安装器。
3. 首次安装若缺少 WebView2，需要联网获取微软运行环境；安装器不含 AI 模型，软件不自动连接模型。
4. 此为未签名预检版，可能显示未知发布者／SmartScreen提示；不要为此关闭安全软件。可先用 PowerShell `Get-FileHash -Algorithm SHA256 '安装器完整路径'` 校验下方哈希。
5. 安装后先测试打开／另存工程、PNG和短视频，确认你电脑的GPU、路径权限和编码能力，再用于重要项目；重要工程请另存新文件并备份。

安装器SHA256：`8850b1b9d5f9cb204e8f0c3c5202dfcdbe4ab14577f001b144647b7f9a4e46c2`。

[成功构建与检查记录](https://github.com/YaoYumo/bubbly-crab/actions/runs/39891196400)。此次没有合并主分支，也没有公开发布 Release。

## 1.2.0 新手指引、精简工作区与用户模型库（当前安装包）

- 首次启动有九步新手指引：可跳过、前进 / 后退、Esc 关闭；从「操作 · 右键 → 工具 / 工程 → 新手指引」重开。导览不生成、不覆盖工程，结束恢复原页面、视角与选择。旧的首次自动弹出生成框改为欢迎导览。
- 顶栏仅五页面、性能、桌面检查；物体 / 机位 / 空白右键饼菜单保留右拖平移，工程与主题等工具收入二级面板。一句话生成位于中间视口，预设和参数默认折叠。
- 统一实际模型缩略图，用户模型可导入至分组、移动与删除；内置移除可恢复。分组库本地持久化；场景中的用户模型与贴图随完整工程携带。
- 本包同时包含上传灰模宝塔、木构变体与中式古建斜边楼梯；保留 1.1.1 的镜头剪辑与时间轴改善。
- 源码：`e9b4e00d2ea4054f6598586082ea77460452af36`。Windows job `120211102767` 在 2026-10-23 成功完成原生编译、NSIS 打包、安装及窗口存活检查；不是只生成网页构建。
- 安装器 **2,266,794 bytes**；应用 exe **4,584,448 bytes**。Actions ZIP **4,775,704 bytes**，artifact `12475121975`，保留至 2027-01-21。包内包含安装器、应用 exe、Cargo.lock、实际字节 / 哈希清单及安装冒烟报告。请运行 `bundle/nsis/` 下的安装器，而不是把应用 exe 当安装器。
- Windows 构建的每个前端文件路径与 SHA256 均与本地完成回归的桌面前端一致。新手指引在 DEV、断网单 HTML、桌面 CSP 三平台通过；模型库、右键菜单、机位剪辑与时间轴等回归通过。
- 实际 Windows runner 上的安装和原生窗口启动已通过；**尚不代表用户电脑上的 Windows 指引交互、磁盘权限及 GPU 导出已全面验收**。没有签名、合并 main 或发布 GitHub Release。
- 沙箱下载附件时被 GitHub 的 Azure 存储连接限制（EOF）阻断，因此没有在沙箱保存一份安装器或做独立下载后的第二次哈希校验。上方附件已由 Windows job 正式上传，可在浏览器登录 GitHub 下载；下列哈希来自 Windows runner 的实际产物清单，而非猜测。

应用 exe SHA256：`2f2794b340dd64b8967493565a107934ca97992c5b395d16c4234f9a9a324ca1`。

证据：[`desktop-1.2.0-evidence/windows-run.json`](desktop-1.2.0-evidence/windows-run.json)、[`windows-artifacts.json`](desktop-1.2.0-evidence/windows-artifacts.json)、[`artifact-metadata.json`](desktop-1.2.0-evidence/artifact-metadata.json)。

使用说明：[新手指引](onboarding.md)、[模型库](model-library.md)、[右键与生成框](radial-ui.md)。

## 1.1.1 剪辑轨道操作优化

- 镜头轨不再挤在22px高的条里：底部面板默认232px，测试窗口1440×1000时轨道111px、片段99px；拖上边界可继续提高，片段随面板变高。宽裁剪手柄14px，片段内分两行显示名称／时间。
- 关键帧默认收起，点击「关键帧」才在独立行展开；仅显示所选物体或单机位模式的当前机位，不再叠加全场景关键帧到镜头轨。
- 独立秒标尺可直接拖动定位播放头；镜头铺满时也能找切点。「+／−／适配」支持100%–800%横向缩放，轨道独立滚动。轻点／手抖不再误移动，放大滚动后的裁剪／定位坐标经过回归检查。
- 原有工程格式、切镜头规则、保存／撤销／视频导出不变。网页、离线HTML、模拟Tauri CSP前端可见控件与完整剪辑／导出回归通过，主题颜色／相机图标／保存IPC预检继续通过。
- 新包已实际构建、安装并观察到原生窗口。**未完成Windows原生剪辑交互、视觉、磁盘保存或用户GPU视频验收**。源码 `f2f0ad9c86423a3fc549b02924de5cc7a4aa03e6`，证据在 `timeline-ui-evidence/`。
- 升级前另存工程并退出旧版，再运行1.1.1安装器，不需要清缓存。包内改带通用 `docs/windows-install-quickstart.md`，不再附带含固定旧下载链接的桌面说明快照。

## 1.1.0 时间轴镜头剪辑（历史，1.1.1保留）

- 新增单视频轨硬切编排：顺序拼接、追加／拖入机位、移动、两端裁剪、源入点、播放头分割、删除、撤销重做。暂停定位、播放、PNG和两条视频导出路径共用核心镜头采样。
- 剪辑随工程包／JSON／本地恢复保存，旧工程默认单机位；播放不改变编辑机位。关闭「剪辑预览」可继续旧工作流；源机位时长不再误缩短整段剪辑。
- 单轨最多128段、总长0.5–120秒；本轮不含音轨、叠化／变速。参考包仍为单机位，需先关闭剪辑预览。详细用法和空隙／源时间规则见 [镜头剪辑说明](camera-edit.md)。
- 网页、完全离线HTML、模拟Tauri CSP的桌面前端：两机位切换、实际编码／解码、工程存取、撤销、失败／取消恢复及可见控制回归通过；原有主题／图标／保存IPC预检通过。Windows构建、安装、窗口启动成功，**未完成Windows原生剪辑交互、保存、GPU导出或视觉验收**。
- 先另存工程并退出旧版，再运行1.1.0安装器覆盖安装。不要求清缓存。包含剪辑的工程不要再用旧版保存，以免丢失剪辑。
- 构建源 `d2feb66327ccda1b1c88513c89e586077e77f784`；新包与安装报告见 `camera-edit-evidence/`。ZIP内的桌面说明为构建时快照（仍含旧版下载记录），请以本页最新下载和版本指引为准。

## 1.0.1 显示修复（历史，1.1.0保留）

- 修复 Tauri 向 `style-src` 追加hash／nonce时，浏览器忽略父策略 `unsafe-inline` 导致的动态样式丢失。明确分别设置 CSS 的 `style-src-attr` 和 `style-src-elem`；脚本策略和原生最小权限不放宽。
- 通用DOM工具改用CSSOM `style.cssText`；主题按钮、光影预设渐变、机位颜色标记继续使用原有颜色／布局。
- 相机列表图标改为内置SVG，不依赖Windows Emoji字体。预览相机名牌使用DOM文本节点，恢复动态颜色并避免名称被误当作HTML解析。
- 前端预检现在模拟Tauri的样式nonce，补充上述颜色／图标／名牌检查；原有web/file小规格行为与导出回归通过。
- 修复版Windows原生构建、静默安装、窗口存活通过。**安装后WebView2的CDP端点不可访问，原生UI自动比对未完成，不能标作视觉验收通过**；未因此给正式应用打开调试权限。检查细节见 `desktop-visual-fix-evidence/`。
- 升级前先另存重要工程并退出旧版，直接运行1.0.1安装器；不要求清除应用缓存或重置工程。相机3D辅助机身／名牌仍遵循「显示辅助」和预览／导出时隐藏的原有规则。

## 当前状态与边界

**已生成1.1.1 Windows x64 NSIS 安装包，并在 Windows runner 上通过静默安装与原生窗口启动检查。** 构建源提交 `f2f0ad9c86423a3fc549b02924de5cc7a4aa03e6`；最新版为1.1.1；详细产物、SHA256、任务结果见 `timeline-ui-evidence/`；1.1.0记录在 `camera-edit-evidence/`，1.0.1显示修复记录保留在 `desktop-visual-fix-evidence/`，1.0.0历史记录在 `windows-installer-evidence/`。当前交互工作区仍是 Linux；用户电脑的显卡、原生保存和视频导出尚未实测。浏览器里的「桌面版前端预检」仍不是桌面程序。

- 原网页版及双击打开的 `previz-lab.html` 保留；桌面构建使用独立的 `desktop` mode 和 `desktop/dist/`，不覆盖网页的 `dist/` 或离线 HTML。
- Tauri 2 / Windows x64 优先；可调整大小的独立窗口。只有 dialog、fs 两个原生插件，没有 Node、模型进程、shell、自动更新、远程控制或 AI 权重。
- 安装目标为 **NSIS、当前用户**，不要求管理员安装模式。当前配置**不嵌入完整 WebView2**；若安装器检测到缺失，会联网下载微软 bootstrapper 并安装 Evergreen Runtime。已有 Runtime 时跳过此下载；离线电脑须先自行准备 Runtime。系统已有 Edge 不等于已确认 Runtime 可用。
- 桌面安装包实测 **1,920,480字节（约1.92MB）**，可执行文件4,240,384字节；此前5–20MB是估算，现在以实测为准。编译工具链、Cargo 缓存与系统共用的 WebView2 占用也不等于安装包大小。
- 网页浏览器、离线 file 页面、桌面应用使用不同的存储来源；不会自动搬运已有浏览器工程。通过 `.previz` 工程包迁移。
- 此版没有捆绑 AI／参考生成的 Node 网关；主动检查网关时，在 fetch 前明确拒绝，不扫描 localhost 端口。保留本地配方、蓝图、预演、手动工作包和参考 ZIP；隐藏旧版直连服务／Key 配置入口。没有下载权重或启动推理。

## 1.1.1 实际测量

| 文件／资源 | 实际字节数 | 说明 |
| --- | ---: | --- |
| 更新后的 `previz-lab.html` | 2,344,395 | 网页离线单文件，约2.34MB |
| Windows构建的 `desktop/dist/` 前端资源 | 2,323,660 | 约2.32MB；不含Rust壳、安装器和系统WebView2 |
| Windows NSIS 安装包 | 1,920,480 | 真实 `.exe` 安装器，不含完整 WebView2／模型 |
| Windows应用可执行文件 | 4,240,384 | 未压缩的应用exe，不是安装器 |
| GitHub下载 ZIP | 4,087,020 | 含安装器、应用exe、Cargo.lock、构建清单、安装报告与通用安装指引 |

原生构建版本与SHA256见 `timeline-ui-evidence/windows-artifacts.json`，前端／原生检查边界见该目录的 `manifest.json`。后续修改／重建后应重新记录，不用这张表代替新测量。

## 文件保存与权限

`src/util.js::downloadBlob` 在普通网页／file 中沿用下载，在桌面构建中转到保存队列：

1. 系统保存对话框选择单个文件，取消时不创建文件。建议保留 `.previz`、`.webm`、`.png`、`.zip` 等对应后缀。
2. dialog 插件动态授权用户所选文件，fs 插件才创建并分块写入。没有磁盘目录通配 scope，没有原生任意路径读取、删除、重命名、执行或网络插件权限。
3. 每块最多 1MiB，处理短写；最后关闭句柄后才报告成功。最多4项排队、合计512MiB；超出立即提示，不额外弹对话框。用户取消或失败不会偷偷降级为第二次浏览器下载。
4. 窗口底部区分等待、正在保存、已写入、取消、失败；工程成功提示等待实际写入。队列未清空时拦截正常窗口关闭，**不保证拦截任务管理器强杀、崩溃、断电**；不提供完整的「所有未保存编辑」退出检查。
5. 视频在临时渲染状态恢复后才进入磁盘保存。取消／失败不抹掉已编码 Blob；Export 页可「另存视频」，无需重新编码。批量队列在当前文件取消／保存失败后停止，其余仍等待，不连续弹出保存框。新渲染会替换当前结果预览，不是无限历史视频库。

**重要：这不是原子替换或备份系统。** 覆盖由系统对话框确认；创建现有文件会截断旧内容。磁盘满、权限变化、中途退出可能留下不完整文件；不删除它，不尝试修改其他路径或恢复旧文件。重要工程请用新文件名另存、保留备份，验收磁盘文件后再清缓存／卸载。这里的成功是写入和关闭 API 返回成功，不是断电持久性证明。

工程／模型／贴图／结果视频的打开继续走 HTML 文件选择和现有导入流程，无需给 fs 插件整盘读取权限。窗口配置 `dragDropEnabled:false` 以保留 HTML5 拖入；`scopeDroppedPaths:false` 不因拖入而向原生 fs 递归授权目录。**实际 Windows 选择文件／拖放还须手工验收。**

## 安全与离线边界

- release CSP 只允许内置脚本、必要的本地 blob/data 资源与 Tauri IPC；禁止外部 HTTP(S) 服务、内嵌 frame、object、表单提交。blob/data 的 connect 用于本地 glTF 缓冲和内嵌资源，不是允许任意外网。
- capability 仅匹配本地 `main` 窗口：`dialog:allow-save`、`fs:allow-create`、`fs:allow-write`、资源 close、事件 listen/unlisten、窗口 destroy（正常关闭）。不开放 `core:default`、文件路径通配或远程窗口授权。
- 桌面 dev 单独用5180，无 API 代理；网页版继续5174。预检静态服务5181模拟 release CSP，并给入口内联启动脚本加入本地计算的 SHA256；这不是对 Tauri 最终注入后 CSP 的 Windows 验收。
- 不复制 public、local-ai、密钥、模型库缓存、Node 服务到安装包。桌面前端读取环境配置的目录隔离在 `src-tauri/`；不要往源代码或 `VITE_*` 中放秘密。
- ZIP 库小版本更新并锁定到 `fflate@0.8.3`，修复 npm 报告的畸形 ZIP64 解析卡死问题（GHSA-px8p-9vwx-vf98）。这不保证所有不可信工程／模型都安全，也不修改 Three.js 的第三方内置代码。
- 当前 npm 完整审计仍有 **11项（10高、1中）开发依赖报告**，未强制跨版本升级；`--omit=dev` 的 npm 依赖报告为0，不代表 Rust 依赖、第三方内嵌代码、OS Runtime 或打包成品已做完整安全审计。真实 Cargo.lock 已由 Windows 构建生成并随下载 ZIP 保留；源码中尚未加入该锁文件，Rust 依赖安全审计仍未执行。预检阶段不建议作为正式公开发行版本。

## Windows 本机构建（PowerShell，x64）

准备：Node.js 22、Rust stable 的 MSVC 工具链、Visual Studio 2022 Build Tools 的「使用 C++ 的桌面开发」及 Windows SDK、Evergreen WebView2 Runtime。首次依赖解析、Rust编译和NSIS工具准备需要联网；应用运行时不依赖模型服务。

在此工作分支的仓库根目录执行：

```powershell
$env:PUPPETEER_SKIP_DOWNLOAD = 'true'
npm ci
if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
npm run test:desktop
if ($LASTEXITCODE -ne 0) { throw 'desktop tests failed' }
npm run desktop:info
npm run desktop:build
if ($LASTEXITCODE -ne 0) { throw 'native build failed; do not report old artifacts as new' }
# 上一步成功后，再检查产物并写入实际大小/哈希：
node scripts/desktop-artifacts.mjs --require-windows
```

`desktop:info` 用于核对环境；本身不是编译或验收。`desktop:build` 先自动构建 `desktop/dist/`，再编译 Rust 和打包 NSIS。这里不使用 `--target`，下列路径对应 x64 Windows 默认 host 的 release 输出：

- 安装包：`src-tauri/target/release/bundle/nsis/*.exe`
- 可执行文件：`src-tauri/target/release/previz-lab.exe`（能否单独分发仍需实机验证）
- 实际字节数／SHA256：`.shots/desktop-artifacts.json`
- 当前构建生成的锁文件：`src-tauri/Cargo.lock`

1.1.1 Rust构建已经成功。**对应的真实 Cargo.lock 在安装包下载 ZIP 的 `src-tauri/Cargo.lock` 中**，108,390字节，SHA256为 `17cbdede691f9cb8203e0574e6f142275f4d00cfbbcd4fa0bc223692f692165e`。如需复现，取对应源提交并放入该锁文件；本工作区因 Actions 存储域名限制尚未下载它，不能用其他解析结果冒充这份锁文件。编译器与打包环境变化仍可能改变产物，不承诺逐字节可重复构建。`desktop:sizes` 只是盘上文件清单，不证明里面的旧安装包是刚刚成功构建的；务必先看构建退出码，不要把失败前残留的 exe 当新包。

如需本地桌面调试：`npm run desktop:dev`，它会启动独立的5180前端。不要公开暴露开发服务。

### Windows CI（本次安装包构建）

`.github/workflows/desktop-windows.yml` 支持 `workflow_dispatch`，当前只对工作分支的 `src-tauri/Cargo.toml` 改动触发 push 构建，不影响主分支。它不自动发布、签名或调用模型。它在 Windows runner 安装 npm/Rust 依赖、执行配置／保存逻辑及剪辑核心单测、Rust格式检查、原生构建，并上传安装包、exe、Cargo.lock 和大小报告。

**新 workflow 通常需先进入默认分支才会在 Actions 中可手动选择。** 为避免合并主分支，本次从现有工作分支 push 触发原生构建；本轮成功运行与真实产物已记录在 `timeline-ui-evidence/`（1.1.0在 `camera-edit-evidence/`，首版历史在 `windows-installer-evidence/`）。GitHub Actions 使用量以账户规则为准。构建另外尝试在 Windows runner 静默安装并观察原生窗口存活；这不替代用户机器上的 WebGL／文件保存／视频验收。

构建不等于运行验收。产物当前无 Authenticode 签名，Windows SmartScreen 可能拦截；不要宣称已签名或用让用户关闭安全软件的方式验收。

## 当前环境验证

可执行命令与证据：

- `npm run test:desktop`：本地 Tauri 配置 schema 类型／枚举校验、固定权限列表、web不能通过标记获得原生保存、文件名清理、分块／短写／取消／写入失败／close失败、队列预算／串行／错误恢复。无 Rust 执行。
- `npm run all`：网页与离线 HTML 构建。保留原有大 chunk 警告，不当作性能已过关。
- `npm run build:desktop`：独立桌面前端构建、大小清单，不是 exe。
- `npm run desktop:preview`：启动5181前端预检。然后 `npm run test:desktop:browser`（当前 Linux 环境用 withchrome 脚本）。真实 JS 插件 + **模拟 IPC**；不是 OS 文件权限、对话框或磁盘测试。
- 桌面前端专项：WebGL2；临时 IndexedDB 写入／读回／清理；glTF+本地 BIN/PNG 导入与带贴图工程读回；320×180 PNG；320×180/2fps/1s 的2帧 WebCodecs WebM；恢复渲染前状态；原生桥缺失不降级下载；工程菜单等写完才成功；模拟取消／写失败／短写／关闭保护；主 Export 页取消停止批量、另存复用 Blob；1440×1000与800×600面板；离线导出；网关 fetch 前拒绝。最终无页面异常、CSP违例、API／外部 HTTP(S) 请求。
- 既有 project-resources 回归：DEV及file下OBJ/MTL/PNG、完整工程读回、材质／变换／undo／库重建；DEV IndexedDB重载恢复。既有 behavior DEV/file 回归：32帧小规格WebCodecs、16帧参考正常／灰模／深度-ID-mask、取消与失败恢复、1440/800/390交互。它们不是 Windows 或跨GPU测试。
- `node test/reference.test.mjs` 只用临时本地 contract fixture，结束清理；不启动真实 provider 或模型。

正式本轮证据见 `docs/desktop-evidence/`；旧行为阶段的哈希与验收仍是旧交付记录，不作为本轮桌面产物证明。

## Windows 实机验收清单（用户电脑完整验收待做）

- [x] Windows runner 编译、NSIS打包；安装返回码0、应用存活并观察到原生窗口。仅为安装／窗口冒烟检查，不是完整UI／磁盘保存测试。

- [ ] 下载／记录真实安装包 bytes、SHA256；在干净 Windows x64 用户下安装／启动／退出／再次启动／卸载。分别核实已有／缺失 WebView2 的行为，不自动声称 Runtime 已安装。
- [ ] 硬件GPU WebGL2、模型／贴图可见、gizmo／精确拾取、物理光照／Bloom／地形与已有工程；最小窗口、高DPI、不同显卡，记录 WebView2 和 GPU 版本。
- [ ] 打开／拖入中文及空格路径的 `.previz`、glTF+BIN/PNG、OBJ/MTL/PNG；原生另存新工程，关闭程序后从磁盘文件再打开，核对对象、机位、贴图与行为。
- [ ] 原生保存 ZIP／JSON／PNG／WebM：新文件、取消、覆盖确认、只读／不存在目录、磁盘满、连续排队、错误后重试、写入期间关闭窗口。检查所有失败不假报成功、不隐藏第二次下载。
- [ ] 实机视频编码与播放／外部解码、实际长片规格、PNG内容、相机／动作同步；WebCodecs不支持时的实时回退。浏览器2帧专项不替代这些项目。
- [ ] 断网重启仍能用内置库、本地工程和手动参考；没有网关自连／模型进程；确认桌面存储与浏览器存储不混用。浏览器断网导出测试不代表应用已在离线 Windows 启动过。
- [ ] 保存重要备份后验证升级／卸载与缓存策略，审计工具链／Rust依赖、第三方许可与签名后，再考虑正式发行。

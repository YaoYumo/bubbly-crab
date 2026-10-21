# Windows 轻量桌面版：Tauri 2 预检工程

## 当前状态与边界

**已接入桌面构建和文件保存逻辑，尚未交付可安装的 Windows 成品。** 当前开发环境是 Linux，未安装 Rust/Cargo，也没有 Windows/WebView2；没有执行 Rust 编译、NSIS 安装、原生磁盘写入或 Windows GPU 验收。浏览器里的「桌面版前端预检」不是桌面程序。

- 原网页版及双击打开的 `previz-lab.html` 保留；桌面构建使用独立的 `desktop` mode 和 `desktop/dist/`，不覆盖网页的 `dist/` 或离线 HTML。
- Tauri 2 / Windows x64 优先；可调整大小的独立窗口。只有 dialog、fs 两个原生插件，没有 Node、模型进程、shell、自动更新、远程控制或 AI 权重。
- 安装目标为 **NSIS、当前用户**，不要求管理员安装模式。当前配置**不嵌入完整 WebView2**；若安装器检测到缺失，会联网下载微软 bootstrapper 并安装 Evergreen Runtime。已有 Runtime 时跳过此下载；离线电脑须先自行准备 Runtime。系统已有 Edge 不等于已确认 Runtime 可用。
- 桌面安装包与可执行文件的字节数须等 Windows 构建后测量；此前 5–20MB 是估算，不是此次产物实测。编译工具链、Cargo 缓存与系统共用的 WebView2 占用也不等于安装包大小。
- 网页浏览器、离线 file 页面、桌面应用使用不同的存储来源；不会自动搬运已有浏览器工程。通过 `.previz` 工程包迁移。
- 此版没有捆绑 AI／参考生成的 Node 网关；主动检查网关时，在 fetch 前明确拒绝，不扫描 localhost 端口。保留本地配方、蓝图、预演、手动工作包和参考 ZIP；隐藏旧版直连服务／Key 配置入口。没有下载权重或启动推理。

## 本轮实际测量（不是安装包大小）

| 文件／资源 | 实际字节数 | 说明 |
| --- | ---: | --- |
| 更新后的 `previz-lab.html` | 2,329,578 | 网页离线单文件，约2.33MB |
| `desktop/dist/` 全部前端资源 | 2,309,504 | 约2.31MB；不含Rust壳、安装器和系统WebView2 |
| Windows安装包／可执行文件 | 未生成 | 不能据前端大小冒充安装包大小 |

构建版本与SHA256见 `desktop-evidence/manifest.json`。后续修改／重建后应重新记录，不用这张表代替新测量。

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
- 当前 npm 完整审计仍有 **11项（10高、1中）开发依赖报告**，未强制跨版本升级；`--omit=dev` 的 npm 依赖报告为0，不代表 Rust 依赖、第三方内嵌代码、OS Runtime 或打包成品已做完整安全审计。当前没有 Cargo.lock／Rust 审计结果。预检阶段不建议作为正式公开发行版本。

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
- 首次成功解析生成的锁文件：`src-tauri/Cargo.lock`

首次 Rust 构建尚未运行，当前只锁定直接 Rust 版本，**没有伪造 Cargo.lock**。第一次成功后应保留／评审真实锁文件，再纳入代码版本；在此之前流程可照着运行，但不承诺逐字节可重复构建。`desktop:sizes` 只是盘上文件清单，不证明里面的旧安装包是刚刚成功构建的；务必先看构建退出码，不要把失败前残留的 exe 当新包。

如需本地桌面调试：`npm run desktop:dev`，它会启动独立的5180前端。不要公开暴露开发服务。

### Windows CI（本次安装包构建）

`.github/workflows/desktop-windows.yml` 支持 `workflow_dispatch`；本次为首次生成安装包，另外只对当前工作分支的此 workflow 文件改动触发一次 push 构建，不影响主分支。它不自动发布、签名或调用模型。它在 Windows runner 安装 npm/Rust 依赖、执行配置／保存逻辑单测、Rust格式检查、原生构建，并上传安装包、exe、Cargo.lock 和大小报告。

**新 workflow 通常需先进入默认分支才会在 Actions 中可手动选择。** 为避免合并主分支，本次从现有工作分支 push 触发原生构建；成功后再记录产物链接、哈希及真实大小。GitHub Actions 使用量以账户规则为准。构建另外尝试在 Windows runner 静默安装并观察原生窗口存活；这不替代用户机器上的 WebGL／文件保存／视频验收。

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

## Windows 实机验收清单（全部待做）

- [ ] 下载／记录真实安装包 bytes、SHA256；在干净 Windows x64 用户下安装／启动／退出／再次启动／卸载。分别核实已有／缺失 WebView2 的行为，不自动声称 Runtime 已安装。
- [ ] 硬件GPU WebGL2、模型／贴图可见、gizmo／精确拾取、物理光照／Bloom／地形与已有工程；最小窗口、高DPI、不同显卡，记录 WebView2 和 GPU 版本。
- [ ] 打开／拖入中文及空格路径的 `.previz`、glTF+BIN/PNG、OBJ/MTL/PNG；原生另存新工程，关闭程序后从磁盘文件再打开，核对对象、机位、贴图与行为。
- [ ] 原生保存 ZIP／JSON／PNG／WebM：新文件、取消、覆盖确认、只读／不存在目录、磁盘满、连续排队、错误后重试、写入期间关闭窗口。检查所有失败不假报成功、不隐藏第二次下载。
- [ ] 实机视频编码与播放／外部解码、实际长片规格、PNG内容、相机／动作同步；WebCodecs不支持时的实时回退。浏览器2帧专项不替代这些项目。
- [ ] 断网重启仍能用内置库、本地工程和手动参考；没有网关自连／模型进程；确认桌面存储与浏览器存储不混用。浏览器断网导出测试不代表应用已在离线 Windows 启动过。
- [ ] 保存重要备份后验证升级／卸载与缓存策略，审计工具链／Rust依赖、第三方许可与签名后，再考虑正式发行。

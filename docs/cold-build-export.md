# 冷构建治理与多帧视频导出（2026-10-18）

本阶段对应新授权顺序 **①冷构建＋长视频验收 → ②选择性 Bloom → ③外部地形高度图／贴图、侵蚀、河网**。只实施①，不将②③或整个旧回归总门禁算作已完成。上阶段全屏 Bloom / LOD 的历史证据保留在 `lod-bloom-evidence/`，不覆盖。

## 冷准备的变化

- 浏览器拾取索引：失效后不在下一次点击递归计算所有源几何包围盒。空闲队列逐根、逐节点准备局部包围盒；位置扫描每 256 顶点、实例包围盒每 32 实例让出。未准备好的根始终走原 Three 精确递归 raycast，**不是忽略对象或使用旧盒子**；准备完后才发布候选盒。
- 原根顺序、等距稳定排序、不可见物体的原 raycast 语义、ID、key / shot / ground、选中和 gizmo 不变。自定义 raycast、动态／动画／不支持几何仍保守回退。
- `gizmo-live` 保留根局部盒，世界盒按当前矩阵 refit；objects / terrain / shots 等深变更丢弃局部缓存、撤销旧队列。跨分片期间发生根矩阵变化时拒绝发布该盒。任意外部深层修改仍须显式 invalidate；几何属性更新仍须设置 needsUpdate。
- Node 语义测试默认使用同步索引模式，便于保留原 647 组精确对照；新增测试明确启用与浏览器一致的后台模式。
- LOD 的内容哈希、碰撞逐字节确认、两级顶点聚类移到空闲队列；每 4 KiB 字节、128 顶点／128 三角形等让出。`enter()` 只使用已完成的派生几何，未完成时仍用源几何，不同步创建低模。
- gizmo / terrain / light 不再无条件 dispose 全部 LOD。每帧仍检查材质、动画、选中等安全条件；属性对象／底层数组／version／drawRange / groups 等修订参与检查。objects 事件取消旧任务、后台清理已移除或修订的源，其余低模保留。继续按内容共享、校验碰撞、128 份源内容／8 MiB 派生缓冲上限；不 dispose 借用的源几何／材质。
- 诊断面板显示后台任务和 LOD 分片最大墙钟；JSON 保留工作队列 slices / steps / errors / maxSliceMs。

### 不是硬实时或“再无卡顿”

队列使用 requestIdleCallback；无该 API 时退到定时器，单分片 **4ms 软预算**、至多 64 个 generator step。后台标签／导出期间不自动做冷准备。单个原子操作仍可能超预算：矩阵树更新、生成属性／法线／球、GC、浏览器调度、原始精确 raycast、BVH 发布／世界盒 refit、源渲染自身均不是可抢占任务。移出了索引／低模的全量冷准备，**不代表消除了首次 shader 编译或提升实际 GPU FPS**。首次选择可能因走精确回退而仍慢。

导出前显式异步预热 LOD（最多 1.5s）；录制期间只用当时已完成的缓存，缺失变体用源几何，避免一段视频中突然后台完成新低模。导出／PNG 独立重置并恢复 LOD 滞回与机位阻尼历史，不污染编辑预览历史。

## 视频：优先明确时间戳，保留兼容路径

### 为什么不继续声称 MediaRecorder“帧精确”

本阶段初测在 Chromium 无头软件渲染器中：旧式逐帧补渲染的 **3 秒、480×270、15fps** 请求，经 FFmpeg 实际解码约 **12.37 秒／39 帧**。`captureStream(0).requestFrame()` 仍使用墙钟时间戳；Blob 非空不说明时长和帧数正确。

现在优先检测 WebCodecs `VideoEncoder` 的 VP9 / VP8 能力：

1. 每帧以 `round(i × 1,000,000 / fps)` 微秒明确时间戳，VideoFrame 用 finally 关闭；不依赖墙钟录制速度。
2. WebGL RGBA 同步读回并翻转行，使用自有像素快照创建 VideoFrame，避免画布恢复／后续帧影响排队中的图像；这会增加读回成本和两份 W×H×4 字节暂存，不是零拷贝。短片通过后，450 帧长片曾暴露尾帧裁切差异，加入该快照边界后重新完成首／中／尾对照。
3. 编码队列施加背压（至多约 3 个待编码帧），每帧主动让出，取消可中断；flush 有超时，编码器总在 finally 中关闭。
4. 用固定版本 `webm-muxer@5.1.4` 打包 **WebM**；全部代码随正式单文件打包，不运行时联网或下载编码器。输出数须等于提交帧数。
5. 修正其 Segment Duration 为完整帧区间（含最后一帧），通过 EBML 层级解析定位元数据，不扫描压缩数据找字节模式；一帧视频也保留正确时长。
6. 实际编码时长可能长于视频时长；实际片长量化为 `round(duration × fps) / fps`（至少 1 帧），不是渲染耗时。内存保留编码结果直至生成文件，不是磁盘流式／无限长度编码。

WebCodecs 不可用或配置不支持时，回退 MediaRecorder：有 requestFrame 才采用手动采样，否则重新创建自动采样 stream；实际 MIME 决定扩展名。**实时兼容路径仍可能丢帧／拉长时长，不承诺固定时间戳**；UI 明确提示。已进入编码而失败时直接报错，不偷偷改用另一条路径生成不符合预期的视频。仅兼容录制的空结果允许自动采样重试；取消不会重试。

依赖维护说明：该小型 muxer 已被作者标记为由 Mediabunny 替代；本阶段固定 5.1.4、封装在 Exporter 中使用，不扩大到全音视频编辑。后续维护／升级须重跑时间戳、Duration、解码和断网单文件验收。

## 恢复、取消与连续导出

- 同一 Stage 的互斥锁和编辑循环暂停在能力探测前取得；不同 Exporter 实例也不能同时改同一个画布。PNG 数据／下载两条入口共用事务与互斥。
- 原 suspended、playing、preview、time、showHelpers、画布逻辑大小／DPR、镜头位置／朝向／FOV／aspect／near／far／zoom、曝光／ISO、预览交互状态／焦点、指南实际可见性、导出矩形、取景框样式、后处理尺寸等在 finally 恢复。对恢复阶段的渲染器 setter 尝试分组件清理。
- step() 后再次隐藏辅助线，防止 step 自动更新机位／路径助手重新进入画面；PNG dataURL 不再漏掉这一步。
- 取消：中止等待／编码、停止全部捕获轨道、不下载残缺视频、不替换 last-good。`frames` 是已提交的渲染采样数；仅固定时间戳路径经完整解码确认可等同输出帧数。
- recorder error、构造／start／render／progress／停止超时，以及 WebCodecs 构造／configure／encode／flush／异步 error，都返回清晰错误并清理。结束回调异常不会破坏已完成文件。
- 原生批量队列在取消／失败后停止，不再把失败标成完成或自动开始下一个；未开始的任务保留等待。格式选择默认 WebM；MP4 明确是浏览器支持时的实时兼容模式，不把未实现的 PNG 序列当作可用视频格式。
- 只有成功文件替换 last URL；临时下载 URL 仍由统一工具延迟回收。资源验收检查每轮轨道 ended、编码器 closed、VideoFrame closed，几何／纹理／派生字节和保留 URL 不逐次增长；**不是跨浏览器显存泄漏证明**。

## 验收入口与范围

Node：

```sh
node test/cold-work.test.mjs
node test/render-effects.test.mjs
node test/pick-spatial-index.test.mjs
```

真实浏览器／原生解码器（FFMPEG 必须显式指向可执行文件）：

```sh
FFMPEG=/path/to/ffmpeg VIDEO_SECONDS=30 VIDEO_WIDTH=1280 VIDEO_HEIGHT=720 VIDEO_FPS=5 \
  bash test/withchrome.sh node test/cold-export-regression.mjs
TEST_FILE_URL='file:///home/user/bubbly-crab/previz-lab.html?fresh=1&benchmark=1' \
  FFMPEG=/path/to/ffmpeg VIDEO_SECONDS=30 VIDEO_WIDTH=480 VIDEO_HEIGHT=270 VIDEO_FPS=15 \
  bash test/withchrome.sh node test/cold-export-regression.mjs
```

新增长视频验收不自动塞入无原生解码器的旧总门禁；不允许缺少 FFmpeg 时退成“非空 Blob 就通过”。`cold-work.test` 已加入常规 suite。旧画质测试显式等待后台队列完成，再执行原画质／资源断言；旧点选 benchmark 将冷回退与显式预热后的热查询分开。

验收场景为 12 栋 Adobe 建筑、移动机位、目标跟踪、2.39 黑边、**LOD + 全屏低精度 Bloom 同时开**。长片和连续导出逐个用 FFmpeg 完整解码：帧数、尺寸、非冻结、多帧单调 PTS；固定时间戳路径要求所有 PTS 偏差 ≤1.1ms、片长偏差 ≤1.1ms。首／中／尾解码画面与同设置 PNG 对照，平均 RGB 绝对差 <6/255、上下黑边最大值 ≤8；不是逐像素无损或所有动态场景的视觉等价保证。

最新本轮结果、正式包大小／SHA256、源文件指纹和完整相关回归清单见 `cold-build-export-evidence/manifest.json`（只在最终实测通过后生成）。**本阶段不会把 30 秒（DEV 720p / 5fps；断网 file 480×270 / 15fps）的两入口测试说成 120 秒、1080p / 2K、30 / 60fps 全规格验收**；也未验证所有显卡、Safari、任意导入动画、天气／人群确定性或带音频视频。时序固定不等于将所有依赖 dt、随机数或角色动画的子系统改造成可任意 seek 的离线动画器。

## 本轮长片实测结果

环境：Linux x86_64、2 vCPU、Intel Xeon 2.60GHz、无头 Chromium 131、ANGLE SwiftShader WebGL 软件渲染；原生 FFmpeg N-47683 完整解码。两个长片进程部分并行，以下等待时间含软件渲染、读回、编码和 CPU 竞争，不是显卡性能基准。

| 入口 | 请求 | 实际解码 | PTS / 时长 | 等待墙钟 |
|---|---|---|---|---|
| DEV | 30s · 1280×720 · 5fps | 150 / 150 帧，150 帧图像互异 | 单调，30.000s | 232.93s |
| 断网 file | 30s · 480×270 · 15fps | 450 / 450 帧，450 帧图像互异 | 单调，29.99967s | 162.82s |

固定 PTS 的逐帧断言均通过（相对 i/fps 偏差 ≤1.1ms）；首／中／尾 RGB 平均差 DEV **1.385 / 1.248 / 1.254**，file **1.662 / 1.451 / 1.393**（范围 0–255），黑边最大 RGB 值均为 1。不是无损视频，也不是所有机位／动态对象的视觉误差上限。

每端另连续导出四个 1s · 480×270 · 15fps 文件，全部解码为 15 帧、PTS 正确；四轮几何／纹理保持 DEV **344 / 17**、file **340 / 17**，派生低模 **36,480B**，每轮只保留一个结果 URL、零活动捕获轨道。每端全部已跟踪的 **11 个编码器**与 **220 / 520 个 VideoFrame**均关闭（含长片、取消和故障注入等，不只是四个连续文件）。另有从原先未暂停编辑循环的导出、准备期间取消、跨 Exporter 互斥和原生批量 UI 取消／失败停止检查。

冷路径检查：第一次后台未就绪时 12 个建筑根均走精确回退；预热后 12 根进入索引，其他两根保持精确回退。LOD 冷渲染中几何构建数为 0，后台完成 4 份共享远景内容、15,712B；gizmo / terrain / light 和未改几何的 objects 不销毁有效缓存。实测 LOD 分片最大 DEV **28.4ms**、file **12.9ms**，说明 4ms 只能是软预算，不能宣传成硬 4ms 上限。冷帧整体 392.7 / 529.7ms 包括软件渲染和首次 shader 等等待，**不与上阶段较小画布的 CPU 数字混比或声称提速率**。

### 相关回归与剩余边界

最终同一份正式包／源码下：Node 冷队列、LOD、647 组精确拾取、窗灯、道路诊断、路口几何；DEV 与断网 file 的 LOD / Bloom 原专项、拾取编辑／撤销／重建／存档 smoke；DEV lighting-regression 与断网 lighting-offline 均通过。拾取 smoke 的场景渲染是 dense **1＋1** 短采样，内部热拾取仍按 **8 批预热＋30 批 A/B**；不是本轮重跑四场景完整渲染性能基准。旧“重建后全部 LOD 缓存必须立即为零”断言改为后台清理后不持有已移除／修订的源，保留还在使用的有效低模；未削弱原几何／ID／gizmo／画质断言。

另用 `test/export-compat-regression.mjs` 在两入口实测原生 MediaRecorder 手动 WebM 和缺少 requestFrame 时自动重新捕获：每个文件真实解码为 **5 帧／320×180**，实际 MIME／扩展名一致，5 条累计捕获轨道全部停止；模拟空结果只重试一次，不产生下载或覆盖 last-good。该兼容测试同样要求 FFMPEG。

一致性范围是相同输入状态的 PNG／视频和已列机位／光影配置。**自动宽银幕特效仍沿用既有预览状态逻辑：需要 2.39／2.76 自动宽银幕效果时，先进入该机位预览再导出**；未将从任意编辑状态切换所有隐式特效的一键等价当作本轮已验证能力。导出时也请不要更改窗口／面板布局；窗口 resize 并发、所有人物／人群动画的绝对时间 seek、Safari 与多显卡矩阵仍未验收。

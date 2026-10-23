# 镜头参考工作台：四阶段首版

交付日期：2026-10-19。定位仍是运镜 / 空间参考，不是完整 DCC，也不保证第三方模型遵循镜头或直接产出成片。实现顺序：参考包 → 镜头诊断 / 最终相机 → 深度遮罩 / 能力协商 → 结果对照 / 尝试版本。

## 从 UI 使用

1. 搭场景、选择活动机位，停止播放；地形任务先完成，侵蚀预览先应用或放弃。
2. **Export → ① 镜头参考包 · 正常 / 灰模**：设置宽高、帧率、时长、运动采样种子，可指定检查主体；需要时勾选关键帧深度 / ID / 主体遮罩。
3. 点 **生成并下载参考 ZIP**。任务期间场景只读，进度浮层可取消，Esc 也可取消；取消或异常不发布不完整包。原视频 / PNG 导出仍保留。
4. 完成后展开 **② 镜头检查**；点击警告时间跳转当前对应机位。请核对参考包与当前场景版本，旧版本的警告不代表当前编辑状态。
5. **Generate → ③ 参考交付 / ④ 结果对照与版本**：选择本地版本，上传兼容的 MP4 / WebM 结果视频，切换正常 / 灰模参考；左侧视频控制同步播放、暂停和 seek，支持按秒 / 按时长比例和 ±60 秒偏移。
6. 人工记录运镜方向、主体位置、遮挡、空间稳定四项 1–5 分及备注，点 **保存评价与同步设置**。这不是自动准确率。
7. 同一参考想换提示词或重新生成，用 **复制为新尝试（保留原结果）**；原版本媒体、任务、评价保留。新尝试 ID 与参考包 artifact ID 分开，`derivedFrom` 记录来源，底层 ZIP 的 manifest ID 不会改写。
8. 备份使用 **导出完整尝试包（含本地结果）**：内含 `reference.zip`、`review.json` 及已上传的结果视频。仅有云端链接时不下载远程文件，会附未内嵌提示；链接可能过期，应先自行下载结果再上传本地。评价 JSON 和参考 ZIP 也可单独下载。

本地版本库是独立 IndexedDB，最多 20 个版本；超出时明确要求先备份并删除，不自动淘汰。媒体不写入 localStorage。隐私模式、空间不足、清除浏览器数据和换浏览器均可能使本地历史不可用；它不是云备份。当前不提供尝试 ZIP 一键导入版本库；可以解压查看媒体 / JSON，并使用原工程导入入口恢复 `source/project.previz`。

## ① 同一次模拟的统一参考包

ZIP schema 为 `previz-reference/1`：

| 内容 | 含义 |
| --- | --- |
| `normal.webm` / `gray.webm` | 同一时间采样、同一最终相机 / 画幅的正常与中性灰模视频，去掉网格、操纵器、路径、机位体和屏幕辅助 |
| `frames/NNNNN-normal.png` / `-gray.png` | 首 / 中 / 尾编码帧，索引去重后为 1–3 组，不是任意独立截图 |
| `camera/frames.json` | 每个编码帧最终求值的相机，不以关键帧插值 JSON 冒充最终相机 |
| `camera/keyframes.json` | 原有运镜关键帧数据，作为额外编辑参考保留 |
| `prompt.txt` / `checks.json` / `objects.json` | 提示词、诊断、ID 对照表 |
| `source/project.previz` / `scene.json` | 源工程包（含工程资源）及场景快照 |
| `source/character-runtime.json` | 起始人物相位、漫游参数、按遍历序号记录的节点位置 / Euler / 缩放；用于审计和后续重放工具，现有工程导入器不会自动重放这些运行时记录 |
| `manifest.json` | 规格、源场景 JSON 指纹、机位 / 主体、编码器、时间约定和除 manifest 自身之外每个文件的 SHA-256 |

- 默认 API 规格 854×480、24fps、5 秒、种子 12345；UI 时长优先使用当时活动机位时长。
- 每边 64–1920 像素、总像素 ≤210 万、1–60fps、请求时长 0.2–30 秒、≤900 帧。宽高 / fps 取整；帧数 `max(1, round(fps × duration))`。`encodedDuration=frames/fps` 单列，可能与请求时长略有不同。
- 时间戳是编码帧起点 `i/fps`；尾图是最后编码帧 `(N−1)/fps`，不是数学终点 `t=duration`。网关发送实际编码时长，不偷偷延长视频或补数学终点。
- WebCodecs VP9 优先、VP8 备选；没有精确编码能力直接报错，不退成两个独立实时录制。建议 Chrome / Edge 安全上下文；已测 Chrome 的 HTTP localhost 与真离线 `file:`。
- 每个时间点只调用一次 `app.step`，随后取得正常 / 灰模 / 可选辅助通道。人群随机源固定种子，天气粒子不额外推进；这不是跨浏览器 / 跨 GPU 位级一致承诺。
- 固定原始几何，临时禁用 LOD / 实例代理。灰模使用中性灯光，没有正常画面的景深 / Bloom；正常视频保留原正常渲染设置。灰模 / 辅助通道的排除规则见下。
- 任务结束（成功、取消、异常）恢复工程时间 / 时长、相机、显示 / 材质、人物节点与漫游状态、渲染状态、选择和锁。采样期间暂停自动存档，避免把临时姿态写进原工程；键盘快捷键也受只读保护。
- 恢复后比对源场景指纹；程序化修改导致源版本变化时拒绝发布混合版本包，而不是默默覆盖外部修改。参考包是采样的镜头段，不是全场景任意时间重放器。
- 累计待打包文件 160MiB 保护、编码 flush 15 秒保护；这是文件量保护，不是浏览器总内存硬上限。大场景 / 资源包仍可能因 GPU、内存或配额失败。

## ② 诊断与逐帧最终相机

`frames.json` 记录最终世界位置 / 四元数、world / view / projection 矩阵、near / far、水平 / 垂直视角、viewport、像素内参、秒 / 微秒时间戳。相机读取自 `stage.view`，在物体走位及机位跟随 / 曲线 / 手持求值之后，而不是直接抄关键帧。

坐标约定：右手系，Y-up，场景米，相机前向 −Z；矩阵列主序；像素原点左上。内参包括取景区域 / 黑边偏移，不能把整个输出画布无条件当作有效成像区。

诊断为警告定位，不是自动修复：

- 地形 / 有限平面地面的净空 <0.1m；地形范围内用高度采样。
- 相机进入保守对象 AABB；在盒外距盒边 <`max(0.25m, near)` 提示贴近包围体。
- 主体 AABB 与视锥、五点射线遮挡（含可见地形 / 平面地面）。没有主体时不伪造主体评分。
- 相邻帧朝向速率 >240°/s、水平视角变化 >5°。

相机数据逐帧写出；包围盒 / 射线约 6Hz 加关键帧采样，`diagnosticSample` 标明。AABB 会覆盖空门洞 / 镂空建筑，人物动态骨骼包围体仅为保守起始体；射线对透明裁剪 / 程序着色器不是逐像素可见性判定，会误报或漏掉快速遮挡。没有精确碰撞、扫掠体、自动构图 / 运动评分，也不承诺发现所有穿模。

## ③ 深度、遮罩与服务适配

### 辅助图约定

仅首 / 中 / 尾关键帧输出，**不是全序列深度或遮罩视频**：

- `-depth.png`：标准灰度 PNG16，网络字节序；相机 view-Z 的正向距离，单位米，不是径向距离。0 为背景 / 排除区域；1…65535 线性映射本帧 near…far。
- 解码：`meters = near + (code−1)/65534 × (far−near)`；near / far 读该帧相机记录。量化精度约为 `(far−near)/65534`，过大的 far 会降低精度。
- `-id.png`：RGB24，数值 `(R<<16)|(G<<8)|B`；0 背景，`objects.json` 查询对象。每对象 / 植被 patch 一个 ID，不区分每株实例或骨骼。
- `-subject.png`：可见主体白，其余表面及背景黑，保留前景物的深度遮挡；不是无视遮挡的主体整体轮廓。
- 灰模 / 深度 / ID / 主体通道排除 FX、水面、河面、天空及不支持的 ShaderMaterial；正常画面仍可能包含它们。因此这些通道不等于正常画面的逐像素语义分割。
- 标准 alpha-test 裁剪保留；一般半透明表面按 alpha 0.5 阈值处理，不模拟透射 / 折射。多层透明、自定义位移、复杂着色器等不作精确支持承诺。

### 默认手动交付，支持能力才提交

前端仅访问同源 `/api/reference-jobs`，不会把新服务商密钥放进浏览器。默认没有配置，能力均为 false；ZIP 可人工交给实际支持参考输入的工具。Camera JSON / 深度 / ID **不会自动发给任意视频模型**，也不宣称模型天然理解它们。

可选开发 BFF（Node 20+）：

```bash
npm run dev                  # 0.0.0.0:5174
npm run reference:gateway    # 0.0.0.0:5176；无配置时只返回未配置能力
```

Vite dev / preview 已代理同源路径；浏览器代码不请求 localhost 后端。生产静态部署需另外把 `/api/reference-jobs` 反代到 BFF，不能只上传静态文件就获得后端。`file:` 离线版只走手动 ZIP，不访问网关。

服务端环境变量（从部署环境提供，**不要使用 `VITE_` 前缀，不要提交密钥**；该脚本不会自动读取 `.env`）：

- `REFERENCE_GATEWAY_URL`：自定义 HTTPS 协议网关地址；可选 `REFERENCE_GATEWAY_TOKEN` 作为服务端 Bearer token。
- 仅本地协议测试可设置 `REFERENCE_GATEWAY_ALLOW_LOCAL=1` 放行 localhost / 127.0.0.1 HTTP 上游。
- 或配置 `ARK_API_KEY` + `ARK_MODEL` 启用内置 **纯文本** ARK 请求；模型名由操作者指定，不保证某模型存在或账户有权限。只请求 720p，整数 4–15 秒，接受适配器已列出的比例；不支持就拒绝，不偷偷 clamp。它不接收参考图片 / 视频。

自定义上游协议（不是任意服务商原生 API 的通用格式）：

```json
GET /capabilities
{
  "version": 1, "configured": true,
  "provider": "your-adapter", "model": "actual-model",
  "inputs": { "text": true, "first-last": true, "video": false },
  "maxBytes": 33554432
}
```

- `POST /jobs`：multipart 字段 `input`、`prompt`、`versionId`、`sourceFingerprint`、`referenceVariant`、JSON `parameters`（实际编码 duration、fps、width、height、seed）；`first-last` 附 `first` / `last` PNG，`video` 附所选正常 / 灰模 WebM，text 不带参考文件。当前首尾模式只用正常画面，灰模请用真实支持的视频模式或手动交付。
- POST 及 `GET /jobs/:id` 返回 `{id,status,resultURL?,message?}`；状态限定 queued / running / succeeded / failed / expired / cancelled；id 为 1–160 字符的字母数字、下划线、点或短横；结果 URL 限 HTTPS / 同源 HTTP。BFF 对浏览器暴露路径为 `/api/reference-jobs` 和 `/api/reference-jobs/:id`。
- 能力声明只说明接口声称支持，**不证明模型遵循度**。该 BFF 不是图生视频 / video-to-video 真实供应商 SDK；需要部署者实现对应上游协议和原生服务商映射。
- 最大请求 48MiB，同时受上游限额；每请求 20 秒超时、本地轮询最长 10 分钟。只上传所选素材，不上传整个工程 / 深度 / 相机 JSON。
- 提交有计费确认；提交意图先持久化，单页防双击，同一尝试不覆盖旧任务。网络 / 响应失败保留 `submission-unknown`，不盲目重试；须先检查服务商后台，任务可能已经创建。跨标签页 / 多用户的服务端幂等计费仍需部署者实现。
- **恢复查询** 只 GET 已保存 id，不重新创建任务。没有收到 id 的未确认提交无法在应用中自动找回。**停止本地等待** 不代表云端取消或停止计费；没有声明远端取消能力。
- 这只是单用户开发 BFF：生产必须另加身份认证、配额、任务归属、滥用限制和服务端幂等；Origin 检查不是认证，不能直接公开暴露付费接口。

原 Seedance 入口已折叠为 **旧版纯文本生成入口（不读取3D参考包）**，其旧的直连 / localStorage key 行为未迁移。上述服务端凭据隔离仅指新网关，不代表旧功能已完成安全迁移。

## ④ 对照 / 版本边界

参考、提示词、场景指纹、请求参数、模型声明、任务 ID、结果与人工评价关联保存。复制的新尝试引用同一个参考 artifact，参考 ZIP 不包含后来追加的评价；用完整尝试包打包二者。

同步对照采用浏览器 video 播放 / seek，约 0.1 秒漂移校正，不是逐帧解码锁步播放器；比例同步及偏移不是自动运动匹配。云端链接不保证长期有效。结果视频只有人工评分，本轮没有自动光流、相机轨迹反解或空间一致性量化。角色剧情 / 打斗接触、脚滑修正、动作交互锚点及 AI 自动搭景均不在本轮新增承诺。

## 验收与复跑

冻结证据：[`reference-evidence/manifest.json`](reference-evidence/manifest.json)。包括 DEV / 真离线 file 浏览器结果、FFmpeg 解码统计、协议测试与历史功能兼容结果。

```bash
node test/reference.test.mjs
bash test/withchrome.sh node test/reference-ui-export-regression.mjs
bash test/withchrome.sh node test/reference-workflow-regression.mjs
TEST_FILE_URL="file://$PWD/previz-lab.html" \
  bash test/withchrome.sh node test/reference-workflow-regression.mjs
# 可选 FFMPEG=/absolute/path/to/ffmpeg，增加实际逐帧解码 / 非黑检测
npm run all
```

DEV 回归默认检查未配置 BFF，请先运行 `npm run reference:gateway` 且不注入真实服务配置；随后测试通过拦截请求运行本地 UI 协议 fixture，不会调用付费推理。纯协议测试也只连接本地 HTTP fixture。真实服务商输入支持、模型可用性、计费、参考遵循度、真实结果 URL 和实际视频生成 **均未联机验收**。

已验收短片为 320×180、0.6 秒、5fps、3 帧，不把它冒充 30 秒 / 1080p 或多机位长片全面验收。保留既有 Scene DSL、造镇、自动机位、prompt、PNG / WebM、关键帧 JSON、Bloom、LOD、地形侵蚀 / 河道能力；分享仍隐藏，模型库未重排或删减。

# 楼阁式佛塔·木构变体

## 使用

**场景 → 展开模型库 → 中式古建 → 楼阁式佛塔·木构变体**。也可直接搜索「木构」。新条目紧跟原「楼阁式佛塔」，属于同一佛塔题材的关联变体，几何来自用户上传的 Pagoda，并非原程序化 builder 的换色副本。

稳定 key：`cn:pagoda_wood_uploaded:楼阁式佛塔·木构变体`。

原条目 `cn:pagoda:楼阁式佛塔`（含原有砖石／木构参数）与用户灰模 `user_models:pagoda_uploaded:Pagoda 宝塔（用户模型）` 都保留，已有 key／参数／工程不改。只给新变体增加高度与7组独立颜色参数；上传模型固定六层，不伪造层数、边数或开关几何参数。

## 能区分什么，怎么判断

原文件虽无材质，但保留了531个具名网格；本次重新从原始归档读取，利用源 node ID／名字和世界包围盒建立可追溯的分件范围，再按材质合为9个绘制网格，而非依据高度将整个塔切成棕色水平带。

| 分件证据 | 新材质解释 |
|---|---|
| `Base_Lower / Waist / Upper / Platform`、两个台阶、底层外栏 | 灰石：低金属度、高粗糙度、石砌细节 |
| `Col` | 暖深木色，木纹沿柱竖向 |
| `Bracket1/2/3`、`EaveBoard`、`Floor_*_Slab`、`RailTop/Bottom` | 木斗拱、檐板、楼板及栏杆；横向构件旋转纹理方向 |
| `Floor_*_Wall` | 比柱梁稍浅的木壁板，竖向木纹 |
| `Door / Frame / Niche` | 深色实体木门、框、龛；不擅自加透明玻璃 |
| `Roof_*_Main / Ridge` | 深灰瓦面及屋脊，非木屋面 |
| `Bell / BellClapper` | 铜铃、铃舌，与悬绳分开 |
| `Buddha / Spire_*` | 低饱和铜金色佛像与塔刹；这是材质设计，并非考古或鎏金工艺鉴定 |
| `SpireCable` | 暗色金属拉索 |
| `BellCord` | 粗糙的非金属悬绳 |

`Base_Platform` 中5个名字误导的副本（源节点19、99、187、275、363）实际在约6.26–19.10米的上层平座，按位置和轮廓识别为上层栏杆，已设为木材；源节点16的底层外栏则保留灰石。

分类依据、包围盒、源节点、三角范围及每类统计记录在 `src/user-models/pagoda/materials-manifest.json`；规则在 `scripts/pagoda-material-rules.mjs`，遇到未覆盖分件会报错，不静默乱分。

**这是新增材质设计，不是恢复不存在的原贴图。** 使用应用已有的本地程序化木纹、石、瓦、金属、纤维颜色／法线／粗糙度贴图，无网络材质依赖。木纹只在变体上重新投影，灰模源UV不变；平滑木作弱化法线，避免像树皮。瓦面凹凸为材质效果，没有增加瓦片几何。

## 输出与兼容

- 网页、离线 HTML、桌面前端已重构建。旧 Windows 1.1.1 安装器本身没有更新；本次未制作新的Windows安装器。
- `model-exports/Pagoda-wood.glb`：4,043,268字节，自包含9个材质网格，全部贴图内嵌，无外部URI，保留34,392面。可下载后用已有的模型导入功能试用；导入旧版属于工程资产，不等于向旧版永久模型库安装条目。未在原生Windows验证此文件。
- 导出SHA256：`0e0f91cd65353d107f951d52ab4ee3d180bd0101cfc4f407c843713af61db3a9`。
- `docs/pagoda-wood-evidence/wood-render.png` 和 `wood-detail.png` 是直接渲染真实网格的全景及近景，不是AI生成的替代示意图。棚拍预览采用暖光与本地环境反射，软件中的光影预设可能使亮暗有所不同。
- 模型真实单位仍未知；默认沿用源高23.902个单位，暂按米解释，可调整。模型授权仍以用户原资产为准，没有擅自声明公开再分发许可或创建Release。

## 验证与复跑

- `node scripts/prepare-pagoda.mjs`：同时重建原灰模压缩几何、分件表及木构分类清单；旧几何原始哈希不变。
- `node test/pagoda-wood.test.mjs`：验证531件全部覆盖且不重不漏，逐件逐顶点严格对比源位置和法线，34,392面无删改；材质角色、UV、尺寸、独立实例、调色及灰模保留。
- `npm run test:pagoda:wood`：真实库卡片放置、与原塔相邻、检查器颜色输入、复制／删除／撤销、三档精度、全局材质开关、JSON和`.previz`往返、拾取、PNG及短视频导出。
- 同样回归在完全离线 `file://` HTML、模拟Tauri CSP的桌面前端通过，见 `web.json / file.json / desktop-csp.json`；无浏览器错误、CSP违规、额外联网请求。这些是Linux Chromium结果，不是原生WebView2或用户显卡验收。
- 原灰模回归、既有镜头剪辑回归、可调高轨道与关键帧可见性回归全部通过。
- `bash test/withchrome.sh node test/pagoda-wood-preview.mjs`：重渲染缩略图与两张效果图（本地Vite 5174）。
- `bash test/withchrome.sh node scripts/export-pagoda-wood.mjs`：重导GLB，随后验证GLTFLoader及应用导入都保留全部面／贴图，导出清单见 `glb-export.json`。导出产物目录已忽略，不作为Git源码资产提交。

# DECISIONS — 已确认决策记录

> 记录 NikoKaraokeVideoMaker 的所有关键决策与理由。规格依据：任务规格（§1–§7）+ 会话问答结果。
> 后续新增决策请按编号追加，注明日期与理由。

## 0. 会话问答结论（用户选择）

| #   | 问题                 | 结论                                                                                                                                                                                                                                       |
| --- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Q1  | 技术架构             | 按默认：Electron + electron-vite；renderer = React + TS + react-konva；Web Audio；WebCodecs H.264 + mp4-muxer；main 管 ffmpeg                                                                                                              |
| Q2  | 编码回退策略         | A：WebCodecs 不可用 / 4K 编码失败 → 明确报错 + 建议降档；不做 raw 帧管道回退                                                                                                                                                               |
| Q3  | 托管 ffmpeg 默认源   | gyan.dev release-essentials win64 zip 直链；设置页可覆盖完整 URL 与镜像前缀                                                                                                                                                                |
| Q4  | 测试机外网           | 不确定 → 托管安装先试真下载，失败转本地 file:// 镜像并在 TEST.md 记录                                                                                                                                                                      |
| Q5  | 预览播放             | 播完停止，不循环                                                                                                                                                                                                                           |
| Q6  | 默认分辨率           | 1920×1080                                                                                                                                                                                                                                  |
| Q7  | P1 范围              | 纳入 M5（项目保存/加载 JSON + 内置使用帮助对话框）                                                                                                                                                                                         |
| Q8  | 波形需求修正         | **用户更正：不要静态波形图，要随音乐实时变化的音频可视化。** 选定：经典频谱柱（按频率分段的柱子实时起伏）；位置沿用横向 [49%,97%]、中心 y≈49%；不做进度双色高亮；颜色单色/多色/渐变；柱数默认 128（100–160 可调）、柱宽/间距/高度/圆角可调 |
| Q9  | 参考图基准           | 附件图本会话不可见 → 按 §4 数值坐标实现，M3 完成后发截图用户目视比对定稿                                                                                                                                                                   |
| Q10 | 计划 slug            | nikokaraoke                                                                                                                                                                                                                                |
| Q11 | 主图填充方式（追加） | 等比适配 contain：图片完整显示、永不变形，矩形内留透明边（透出模糊背景）；面板可选 cover / stretch                                                                                                                                         |

## 1. 产品定义

- Windows exe 交付（NSIS 安装包 + portable 便携版），免装 Node，双击可用；目标机器不需要预装 ffmpeg（应用引导安装）。
- 显示名 NikoKaraokeVideoMaker；图标先占位，M6 前替换。
- UI 默认简体中文。
- 输入：歌曲名、作者；封面 png/jpg/webp（允许透明通道）；音频 mp3/wav/flac/m4a。
- 输出：16:9 H.264+AAC MP4；画面分上下半区：上半区 = 模糊封面背景 + 主图 + 文本 + 频谱可视化，下半区预留给字幕，默认不放下半区元素（拖入 y>55% 仅警告不禁止）。
- 无数据库/登录/云；唯一联网行为 = 用户显式触发的托管 ffmpeg 下载。

## 2. 架构决策

- **技术栈**：Electron + electron-vite；renderer = React + TypeScript + react-konva（拖拽/缩放手柄）；main 负责 ffmpeg 调用与进程管理、文件路径、打包相关。
- **核心约束 A**：预览与导出共用同一份布局数据与同一套绘制代码（单一渲染源，所见即所得）。
- **核心约束 B**：布局数据一律归一化坐标（x/y/w 相对画布宽、h 相对画布高，0–1）；分辨率用 RESOLUTIONS 配置数组（720p/1080p/2K/4K），未来扩展其他比例 = 加数组项。
- **音频可视化**（Q8 修正，替代原峰值波形）：FFT 频谱柱。预览用 AudioBufferSourceNode 手动播放 + rAF 取 currentTime，导出按帧时刻 t 计算；两者调用同一频谱函数与同一 Konva painter。数据管线：File.arrayBuffer（无需 IPC，拖放文件在渲染进程可直接读）→ decodeAudioData → AudioBuffer → 混单声道 → 窗口化 Hann + radix-2 FFT → 对数频率分桶 → 柱高数组（含时间平滑，静音段为 0）。
- **FFT 参数**（M3 实测确定）：fftSize 2048；freqMin 30Hz；freqMax = min(16000, sampleRate/2)。注意 decodeAudioData 会把音频重采样到 AudioContext 采样率（本机 48kHz → freqMax 16kHz），预览与导出走同一条解码路径，天然一致。
- **导出管线**：静态层（背景/主图/文本）一次渲染缓存 → 每帧 = 缓存 + 频谱 painter(t) → VideoFrame → VideoEncoder H.264（yuv420p，优先 quantizer 高质量，不支持则分档码率）→ mp4-muxer 仅视频 mp4 → main 用当前选中 ffmpeg 执行 -c:v copy -c:a aac -b:a 192k -shortest -movflags +faststart 合并。
- fps 默认 30；导出默认分辨率 1080p；4K 失败提示降 1080p（不自动降）。
- 预览播放结束：停止不循环（Q5）。
- **主图填充模式**（Q11 追加确认）：默认等比适配 contain（完整显示、不变形、留透明边）；可选 cover（铺满裁切）与 stretch（拉伸填满）。背景层恒为 cover 铺满。

## 3. ffmpeg 三源管理

- 来源①：系统 PATH ffmpeg —— 启动时异步自动检测（不阻塞 UI）、默认优先；设置页显示路径/版本/校验结果，提供"重新检测"。
- 来源②：应用托管版 —— 一键下载 gyan.dev release-essentials win64 zip，只解压 ffmpeg.exe 到 userData/ffmpeg/；下载进度可见、支持重试；安装后自动校验。
- 来源③：手动指定 ffmpeg.exe 路径。
- 校验标准：版本号 + aac 编码器（必须，缺失视为不可用）；libx264 可选（缺失仅警告）。
- 三源可随时切换，切换立即生效并持久化到配置文件。
- 无任何可用来源：顶部 banner「未检测到 ffmpeg」+ 导出按钮禁用 + 引导安装/指定。
- 所有 ffmpeg 调用统一走 main 进程 getFFmpegPath()/runFFmpeg() API，禁止其他处硬编码路径。
- 托管下载默认 URL：gyan.dev release-essentials 直链（理由：体积小、含 aac/libx264、稳定）；设置页可覆盖完整 URL 与镜像前缀，兼顾国内网络；帮助文档附国内镜像示例。

## 4. 测试与交付

- 测试机外网不确定（Q4）：托管安装先试真下载，失败转本地 file:// 镜像走通流程并在 TEST.md 记录。
- 验收按规格 §5 全套执行，结果写入 TEST.md：素材生成、720p/1080p 端到端 + ffprobe 校验、抽帧频谱动态验证、4K≤10s 冒烟、ffmpeg 来源矩阵、打包干净目录实测。
- git 每里程碑提交；git 身份沿用机器全局配置（NirvanaKaruma）。

## 5. 工程决策

- 包管理器：npm（electron-builder 兼容性最稳）。
- npm 缓存重定向到工作区 .npm-cache/（沙箱仅允许工作区写入）；electron 二进制走 npmmirror 镜像（.npmrc electron_mirror）。
- 合并命令加 -movflags +faststart（网页/流式播放友好）。
- ffmpeg spawn 一律参数数组（兼容空格/中文路径），不用 shell 字符串。
- 参考图本会话不可见：默认布局按 §4 数值坐标实现（主图左 40% 宽、垂直居中、高 90%；歌名 x≈54% y≈15%；作者 y≈26%；可视化横向 [49%,97%]、中心 y≈49%），M3 截图后用户目视比对定稿。
- **首次目视反馈（M2 截图）**：主题元素整体上移 2%——主图 y 5%→3%、歌名 y 15%→13%、作者 y 26.5%→24.5%、可视化中心 y 49%→47%。
- 计划实施 slug：nikokaraoke；任务清单文件 nikokaraoke.md（勾选行 = 进度真相）。
- **交互反馈（M2 验收期）**：① 封面加载失败根因 = 渲染页 CSP 未放行 blob:，已修复（img-src/media-src 增加 blob:；smoke 自测改用 File→objectURL 路径防回归）；② 歌名/作者/可视化与主图一样支持点选 + 拖动换位（选中显示粉色虚线框，主图保留缩放手柄）；③ 字体选择（作者/歌曲名）列入 M3 范围。
- **M3 验收期反馈**：① 音频输入扩展为音频+视频（mp4/m4v/mov/webm，预览由 Chromium 解码音轨、导出由 ffmpeg 提取音轨；mkv 等 Chromium 无法预览解码的容器暂不收）；② 修复播放中 seek 被旧音源 onended 误判为播完的 bug（音源身份守卫 + smoke 回归项）；③ 频谱灵敏度可调（VisualizerConfig.sensitivity 1–15，默认 7，替代原固定增益 4）。
- **帧率与配色（用户改进建议）**：① 预览走 rAF（显示器刷新率，通常 60Hz）；"慢"的观感来自平滑，默认平滑 0.35→0.2；导出帧率可选 30/60fps（默认 30，60 耗时约翻倍），ExportConfig.resolutionId/fps 已入布局模型，RESOLUTIONS 常量数组（720p/1080p/2K/4K 16:9）供 M4 使用；② 配色支持自定义渐变：逗号分隔 1–8 个 hex，可保存为自定义预置（localStorage，键 niko.viz.customPresets.v1），预置列表与内置方案并列可选、可删除。

## 7. M4 工程决策

- **导出渲染复用**（核心约束 A 落地）：SceneLayers 支持 canvasSize（任意分辨率）与 layers 过滤；导出用隐藏 ExportStageHost 拆两个 Stage——静态层（背景/主图/文本）渲染一次、可视化层逐帧命令式 setBars（同一批 Konva 节点 = 同一绘制代码），逐帧合成 = 静态画布 + 可视化画布。
- **H.264 编码**：codec 候选列表 ['avc1.640033','avc1.640028','avc1.4d0028','avc1.42e01f','avc1.42001f'] 逐个探测（WebCodecs 不可用 → 明确报错建议降档，Q2=A）；码率表 720p 6M / 1080p 10M / 2K 16M / 4K 28M；关键帧间隔 2s。
- **纯视频传递**：mp4-muxer ArrayBufferTarget 全内存 → IPC 写临时文件（3–5 分钟 1080p 约 100–250MB，可接受；超长视频 M6 后视需要改流式）。
- **音频路径解析**：优先 webUtils.getPathForFile（拖放/选择原路径）；无路径来源（内存生成）回退 saveAudio 写临时文件。
- **隐藏窗口性能坑**（实测教训）：Chromium 对隐藏页面深度节流 setTimeout（分钟级）→ 编码循环让出事件循环改用 MessageChannel（宏任务不受节流）+ webPreferences backgroundThrottling:false；修复后 720p 4ms/帧、1080p 8ms/帧、4K 38ms/帧。
- **托管下载实测**：本机可直连 gyan.dev（Q4 答案 = 能）；真实下载安装 ffmpeg 9.0.1-essentials 成功（aac+libx264 都有）；file:// 本地镜像路径同步实现并测通（离线兜底）。
- **yauzl 依赖**：托管 zip 只解压 ffmpeg.exe（gyan 包内 bin/ffmpeg.exe），流式提取不落全量解压。
- **GPU 加速检测**（用户反馈）：WebCodecs 支持 hardwareAcceleration 参数；导出按「硬件优先→自动→软件」探测 codec×mode 组合；「导出」面板提供实测基准（硬件/软件各 30 帧对比），结论自动持久化（localStorage niko.encode.modePref）并改变探测顺序。本机实测：软件 6.1ms/帧 快于硬件 9.2ms/帧（Chromium/Electron 44 在 Windows 上未暴露明显更优的 GPU H.264 编码器）→ 自动选软件；此结论随机器而异，检测按机器自适应。

## 8. M5 决策

- **项目文件格式 .niko.json**：{version, app, savedAt, layout 全量, cover 内嵌 dataURL（图片体积可控）, audio 只存磁盘路径}。音频过大不入 JSON；加载时按路径读回字节重建 File（IPC project:read-file），路径失效/无路径时提示重新拖入（其余内容照常恢复）。
- **保存/加载对话框**由 main 负责（save/open dialog + 原子写 tmp→rename）；smoke 模式免对话框落盘 TEST-ARTIFACTS。
- **存档格式（用户反馈）**：扩展名改为专有 .niko（对话框过滤器同步，兼容打开旧 .json）；内容 AES-256-GCM 加密混淆（魔数 NIKO1 + 随机 IV + authTag，密钥内置），定位为防直接查看/手改的混淆层而非强加密（应用不承载敏感数据）；旧明文存档自动兼容读取。
- **新建项目**（用户反馈）：头部按钮 + confirm 确认后重置默认布局并清空素材（释放对象 URL）。

## 9. M5 UI 重构（用户反馈）

- **左栏改 tab**：常驻播放控制（顶部）+ 三个分类——素材与画面（输入/主图/背景）、文本样式、音频可视化，避免单列无限堆叠。
- **导出移入右上角弹窗**：header 按钮「导出」→ 弹窗内选分辨率/帧率/编码模式并执行（进度/取消/结果都在弹窗内）。
- **设置弹窗（系统级，与项目无关）**：ffmpeg 三源管理、语言选择（预留 i18n 接口，当前仅简体中文）、编码加速（显式 自动/强制 GPU/强制 CPU + 本机实测基准按钮）、ffmpeg 硬件能力信息（nvenc/qsv/amf + hwaccels 列表）。
- **编码模式显式化**：localStorage niko.encode.modePref = auto|hw|sw；auto 依据基准结论 niko.encode.autoChoice。
- **本机实测（4070 Laptop）**：WebCodecs 软件 6.1ms/帧 vs 硬件 9.2ms/帧（GPU 路径未加速）；ffmpeg 侧 nvenc/qsv/amf 全可用、hwaccels 含 cuda/d3d11va/vulkan 等——当前管线视频编码在 WebCodecs（ffmpeg 仅无损混流），若未来启用 raw 帧回退将优先用 nvenc。

## 10. M6 打包决策

- **产物**：NSIS 安装包（允许改安装目录）+ portable 便携版，均不捆 ffmpeg 工具链（全目录检索验证；ffmpeg.dll 为 Electron/Chromium 运行时媒体库）。体积：portable 105.7MB / setup 106MB / unpacked 367.5MB。
- **图标**：程序化生成占位图标（build/icon.png 512×512，electron-builder 自动转 ico），后续可替换正式设计。
- **electron-builder 工程**：二进制走 npmmirror 镜像 + 缓存本地化（.electron-builder-cache/，已 gitignore 与 eslint ignore）；开发文件（docs/nikokaraoke.md/TEST.md/TEST-ARTIFACTS 等）从安装包排除。
- **portable 启动器限制**（实测发现）：不转发命令行参数、cwd 改为临时解压目录（退出即删）→ smoke 自测通道改为环境变量 NIKO_SMOKE / NIKO_SMOKE_DIR（同时兼容 argv 与 env 两种触发方式）。
- **未签名**：无代码签名证书，SmartScreen 提示写入 FAQ；后续可加签名。

## 11. 性能优化（M6 后用户反馈）

- **滑块延迟提交**：所有参数滑块（模糊/压暗/字号/描边/发光/柱参数等）改为 DeferredSlider——拖动中仅更新本地草稿，松开/失焦才提交触发画布重绘（用户明确要求）。
- **背景模糊半分辨率**：背景层使用私有 0.5 倍画布副本 + cache({pixelRatio:0.5})，模糊半径同步缩放——视觉几乎无差、性能约 4 倍。
- **Konva 共享图片缓存污染**（实测踩坑）：背景组 cache 与主图共用同一 HTMLImageElement 时，主图会绘制到背景的缓存纹理（画面只剩灰背景），复现于 smoke 像素校验。修复：背景永远使用私有半分辨率画布副本（useMemo 绘制），主图保留原图。
- **预览频谱命令式更新**：播放中 rAF 直接调用 Konva 矩形更新（barsHandleRef，与导出同一机制），绕过 React 每帧重渲染 128 节点；seek/暂停/解码时仍走 state 同步。
- **系统字体枚举**：queryLocalFonts（Local Font Access API，Electron 默认授权）扫描系统全部字体（含日文等特殊字体），进入「文本样式」自动扫描一次 + 手动重扫按钮，下拉分组显示（常用/系统字体）。

## 12. 编辑体验（用户反馈）

- **文本框可缩放**：文本层改为 Group 承载（拖拽 + 四角缩放手柄），字号保持不变；宽度驱动自动换行（wrap=word），高度为框高（文字顶部对齐）；选中显示虚线框。缩放过程用 onTransform 实时重排文字（重设 scale 后改 width，字形不缩放）。
- **撤销/重做**：布局快照 JSON 栈（100 步上限），所有布局修改（拖拽/缩放/样式/文本输入）提交前压栈；Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y 全局生效（输入框聚焦时保留原生行为）；头部 ↩↪ 按钮；保存/加载/新建清栈并重置脏标记。
- **关闭未保存确认**：main 窗口 close 事件拦截 → 查询 renderer 脏标记（布局/素材相对最近保存点）→ 弹窗三选「保存并退出 / 不保存直接退出 / 取消」；smoke 模式跳过守卫。
- **脏标记**：渲染期派生——当前快照（layout + 是否有封面/音频）与已保存快照字符串比较，无额外 effect。

## 13. 独立背景图（用户反馈）

- BackgroundConfig.imageSource = cover（默认）| custom；资产增加 bgUrl/bgFile/bgElement。上传独立背景图自动切 custom，一键清除回退 cover；来源切换走布局历史栈（Ctrl+Z 可撤销）。
- 渲染：BackgroundLayer 按 source 选图（custom 且已上传 → bgElement，否则封面图），仍走私有半分辨率副本 + 缓存模糊管线。
- 项目文件 .niko 增加 backgroundImage 字段（dataURL 内嵌）；脏标记快照包含 hasBg。
- smoke-project 扩展至 9 项：背景图保存/恢复、撤销×4、重做×4。

## 14. 拖动边界（用户反馈修复）

- 原实现把元素严格限制在画布内——主图默认高 90%，纵向可动范围仅约 108px，放大超过画布后纵向锁死（「只能左右移动」）。
- 改为**自由移动**：元素可部分超出画布（所见即所得，导出即裁剪效果），仅保证至少 60px 可见防止完全拖丢；主图/文本/可视化共用同一 clampPos。

## 15. 保存后仍提示未保存（用户反馈修复）

- **根因**：脏检测快照新增 hasBg 字段时，写入「已保存快照」的 4 处（初始/保存/加载/新建）未同步——两边字符串恒不同，dirty 恒为 true，关闭永远提示。
- **修复**：抽出统一 snapshotOf(layout, assets) 构建快照，脏比较与全部保存点写入共用，杜绝字段漂移；smoke 新增「保存后未脏」「新建后未脏」回归项（11/11）。
- **GitHub 同步**（用户要求）：私有仓库 github.com/NirvanaKaruma/NikoKaraokeVideoMaker，默认分支 main，通过本机 SSH 密钥（gh CLI 未安装）推送；每个里程碑提交后同步。

## 16. 可视化频率显示范围（用户反馈）

- **根因一（右侧柱不动）**：默认范围 30–16000Hz，音乐能量绝大多数 <4kHz，对数刻度下 4k–16k 段柱子几乎为零——不是 bug，是量程盖住了有效区域。默认改为 30–8000Hz（"向低频移动"= 收窄上限）。
- **根因二（柱数"拉宽/压扁"）**：暂停态改柱数只重排槽位（slot=宽/柱数），bars 数组仍是旧长度 → 图象被挤扁/溢出。修复：配置变化（柱数/频率范围/灵敏度）→ 同步分析器 + 立即按当前时刻重算；SceneLayers 绘制循环以 config.barCount 为准（bars[i] 缺失补 0）；smoothBars 对长度不一致的 prev 直接取 target（防 NaN）。
- **UI**：面板新增「显示频率范围」两个滑块（最低 20–freqMax−100 / 最高 freqMin+100–20000Hz）+ 快捷预置（全频段 30–16k / 常用 30–8k / 中低频 30–4k / 鼓点贝斯 20–1k）；频率范围入布局模型（随项目保存、可撤销/重做、导出与预览共用同一分析器）。
- 频率范围校验：0 < freqMin < freqMax ≤ 奈奎斯特（createSpectrumAnalyzer 与 useAudioPlayback 双处钳制）。

## 17. 0.5.0 动效与后期（用户确认"按草稿开始"）

- **范围与口径**（2026-08-29 用户确认）：背景/主图/文本入场/全局后期/片头片尾五组；四条口径：① 踩点闪光用 bass 能量阶跃近似（完整节拍检测留 0.6.0）；② 全部特效默认关闭（默认布局/导出与 0.4.0 一致）；③ 主图/文本特效走 Konva 属性动画（SceneLayers 同源），全局后期走 Canvas2D 叠加（预览 overlay + 导出 compose 同函数）；④ 动效时间轴走 frameT/layerFx 通道（暂停/seek 同步、导出逐帧一致）。
- **CanvasFX 管线**：src/shared/canvasfx.ts 纯函数 drawCanvasFx(ctx, {t, 参数}, w, h)（暗角→颗粒→扫描线→闪光→漏光顺序；参数 0 自动跳过）。确定性：颗粒=静态噪点纹理×grainOffset(t)（1/24s 网格跳变）；漏光=程序化暖色光斑（screen 混合，t 缓慢漂移）；闪光=energyAttack(bass, 0.15s)×强度。同 tSec 无论 30/60fps 输出一致。
- **分层动效**：背景 Ken Burns 作用于缓存组变换（不触发重缓存）；kenBurns 契约 |dx|≤(s−1)/2（任何时刻无露边），幅度映射 ×0.35；bass 呼吸=组外白亮/暖色 hue 叠色（仅 opacity）。主图：中心锚定 fxGroup（呼吸/旋转），发光载体=Image 节点（Konva Group 运行时不支持 shadow——踩坑记录），遮罩 circle/star clipFunc+边框描边为静态项。
- **文本入场**：entryProgress（含延迟，纯时刻函数）；fade/slide/typewriter/bounce；bounce 为整体回弹（偏差：逐字弹跳需按字符重建文本排版，列入后续）；完成后复位最终态。
- **片头/片尾**：introOutroAlpha（黑场 1→0 / 标题卡边缘渐入渐出 / 片尾 0→1 纯时刻函数）；IntroOutroLayer（fx 层，最顶），标题卡复用歌名/作者样式居中。⚠ 已知外观项：标题卡期间基础歌词文本同时可见（卡片叠加而非替换），待用户反馈是否调整。
- **导出双路径**：layout.hasDynamicFx()——默认关 → 静态缓存+可视化逐帧（与 0.4.0 输出一致）；任一动态特效开 → ExportStageHost 全层 Stage（renderFull）逐帧渲染，CanvasFX 在 compose ctx 同函数叠加。
- **版本**：0.4.0 → 0.5.0。

## 18. 0.6.0 音乐响应进阶（用户修订：不做自动节拍检测）

- **节拍源 = 手动**（2026-08-29 用户决策）：取消谱通量 onset / 自相关 BPM 估计；visualizer.bpm（每分钟拍数）与 visualizer.beatIntervalSec（周期秒）自由正数输入（**不限制范围**，仅校验 >0 且有限；BPM 优先，均空=关闭）。
- **踩点触发**（确定性 beat 包络 beatEnvelope(t)：beat 起点=1 指数衰减 tau 0.18s）：① 全局脉冲=背景亮度短闪（叠色 Rect opacity）+ 主图 Kick 缩放（fg.scale 叠加）；② 踩点闪光=CanvasFX beatFlash 在"手动节拍源开启"时按 beat 包络驱动（能量阶跃保留为第二来源）；③ 粒子爆发=boost=env×burst（提升粒子透明度/尺寸）。
- **粒子系统**（src/shared/particles.ts 纯函数）：雪/樱花/星空/气泡四预设；每粒子固定种子（mulberry32，i•733+预设种子）独立循环轨迹（周期 6–12s、错开起点）+ 星空闪烁；位置/透明度为 t 的纯函数 → 30/60fps 同 t 同位置（导出序列一致）；密度 0=关。
- **接线**：预览 CanvasFxOverlay（粒子→全局后期顺序绘制）与导出 compose 同一批函数；bg/img 各帧读取 beatPeriod/beatEnvelope；动效面板新增「音乐响应」分组（BPM/周期自由输入 + 脉冲/爆发/粒子预设/密度）。
- **默认全关**；smoke 新增「手动节拍脉冲/粒子系统/踩点闪光（手动源）」三项（暂停态确定性）+ 导出抽帧目视确认（雪粒子+beat 起点增亮）。版本 0.5.0→0.6.0。

## 19. 音频解码三路径（性能根治，用户反馈 OOM）

- **路径①（首选）ffmpeg 子进程解码**：main 进程 spawn ffmpeg `-i <path> -vn -f f32le -acodec pcm_f32le -ar 44100 -ac 2 pipe:1` 收集 stdout → IPC 回传 ArrayBuffer。渲染进程**零解码 CPU**（UI 永不卡），内存恒定（44.1kHz 立体声 f32 ≈ 时长×352KB/s，222s≈78MB），与 V8 堆无关——根治 96kHz FLAC 曾把渲染进程堆打满 4GB（OOM 4058MB）的问题。新请求 kill 旧请求（重复导入不再叠加）。
- **路径② Worker + OfflineAudioContext**（无 ffmpeg 时）：≤48kHz 封顶解码 + FLAC STREAMINFO 采样率识别。
- **路径③ 主线程 decodeAudioData**：最后兜底（罕见）。
- 拖放文件用 getFilePath 原路径；内存 File（无路径）先 saveAudio 写临时文件再喂 ffmpeg。
- 实测：Deep Blue FLAC（93.7MB/96kHz/222s）就绪 1847ms（含 IPC 与拆通道，堆峰值 441MB）；mp3 版 2515ms（含临时写盘）；期间 UI 全程可交互。
- 频谱视觉阈值随之微调（8kHz 源经 44.1kHz 上采样后柱形略异，动态渲染检查阈值 150→100）。

## 20. 音频导入性能根治（用户反馈 ~10s 卡顿，2026-08-29）

- **问题**：每次导入音频/视频固定 ~10s 主线程卡死（"音频解析中"，UI 无响应），新建项目同样卡顿；实测（smoke 探针）停顿 0.2s–分钟级波动，dev 与打包版均复现，导入与新建项目交替出现。
- **根因链**：每次导入的 PCM 被全量复制 5–6 遍（main concat → preload 组装 → contextBridge 大块克隆 → worker 拆声道 → createBuffer → 主线程再 mixToMono）≈ 400–500MB 瞬时垃圾 → V8 外部内存 GC 停顿；叠加主线程 WebAudio 构建（createBuffer 走音频服务共享内存分配，服务楔死时同步阻塞）；停顿落在「下一次分配压力点」，故导入与新建项目轮流卡。另每次导入/导出 getFFmpegPath() 都做全量三源检测（7–10 次 spawn ≈ 400–600ms 串行延迟）。
- **重构**：① main 边收边推——ffmpeg stdout 直接按 4MB 分块推送，取消 Buffer.concat 全量驻留；解码会话按 token 管理，新增 audio:decode-cancel（换文件/新建项目杀旧流）；② preload audioDecode 改流式 API（chunk 直通回调 + result + cancel），取消组装双份复制；③ Worker 纯数据流式组装——chunk transfer 进 Worker 累积，finalize 拼接/拆声道/混单声道一次完成，transfer 回传 {channels, mono}，主线程只剩 createBuffer+copyToChannel（实测 0–11ms）与建分析器；④ ffmpeg 检测缓存（TTL 30s，设置变更/托管安装完成失效，手动刷新强制重检）。
- **实测发现（重要）**：本环境（Electron 44 / Chromium 152）专用 Worker 内 `AudioBuffer` 与 `OfflineAudioContext` 均未定义——Worker 无法构建 AudioBuffer 或解码；旧代码「Worker + OfflineAudioContext」路径其实一直在静默失败、落到主线程 decodeAudioData 兜底。因此 Worker 只做纯数据操作；无 ffmpeg 时直接主线程 decodeAudioData（Chromium 内部异步解码，不阻塞 UI）。
- **效果**（本机 222s mp3 探针，NIKO_AUDIO_PROBE）：堆峰值 441→93–169MB；导入主线程停顿典型 0.2–1.0s（此前 0.6–3.4s）；新建项目 120–1300ms（曾 2133ms 卡死级）。残留偶发 2–3s 波动为机器级原生服务（音频/GPU）抖动，相位随机，非应用数据流瓶颈。

## 21. 复盘：特效引入与导入卡顿的关系 + 时间轴的性能相关性（2026-08-30 双人核验）

- **问题①：是不是"引入特效后"才变的卡？** 对比 0.3.0 与 0.5.0/0.6.5 的代码构造后结论：**导入卡顿与特效无因果关系**。
  - 0.3.0 与 0.5.0 的"导入"都是把文件送进同一解码链路；0.5.0 特效层（背景/主图/文本/后期/粒子）**默认全部关闭**，不运行时其每帧固定开销仅剩 IntroOutroLayer 两个静态文本节点与 overlay 空闲跳过（实测可忽略）。
  - 真正的因果是：为治疗"96kHz FLAC OOM"引入的 ffmpeg 解码通道在 0.6.5 之前**没有流式到底**（main Buffer.concat + preload 全量组装 + contextBridge 大块克隆 ≈ 78MB 被复制 5–6 遍 ≈ 400–500MB 瞬时垃圾）→ V8 外部内存 GC 停顿秒级起——这是数据通道设计缺陷，不是特效。
  - "引入特效后开始卡"是**时间巧合 + 暴露**：特效开发期用户开始高频使用高解析 FLAC 与重复导入，把一个一直存在（0.3.0 同样有 decodeAudioData 主线程解码，只是当时文件小/少试）的弱点放大到可感知。
  - 特效侧唯一的真实成本是"播放中每帧渲染"（0.4.0 曾发现 bandEnergySmoothed 无条件跑 5×FFT/帧——已修为仅呼吸开启时跑；overlay/粒子均已做空闲跳过与确定性绘制）——那是运行态开销，与导入无关。
- **问题②：时间轴（1.0.0 关键帧）把特效从"项目创建即引入"改为"时间轴事件"会改善卡顿吗？** 结论：**不会改善导入卡顿，且可能略增运行态成本**。
  - 导入卡顿在"解码数据通道"，与特效何时/是否启用无关（探针实测即默认全关状态）；时间轴不动这条链路。
  - 时间轴的性能影响是两个新面：① 每帧 patch 求值（纯函数 t→patch，仅特效开时跑，与现在 hasDynamicFx 全层逐帧相当）；② 时间轴 UI（轨道/关键帧）是编辑器负担，只在编辑时。收益是**表达能力**（分段/渐变/多场景），性能上无正收益。
  - 有真实回报的相关方向是"**按段生效**"的导出分路径（无特效段走静态缓存快路径——现在 hasDynamicFx 已按整项目开关分路径；按时间轴切段可让长视频大多数字段走快路径）——这属于 1.0.0 表达能力的副产品，不是性能修复手段。
- **残留与下一步边界**：0.6.5 后残留 2–3s 偶发波动已定位为机器级原生服务（音频/GPU 进程）抖动，相位随机（导入/大图/新建均可能命中），堆已降至 ~150MB，不再是应用数据流瓶颈。可观测的健壮性缺口：**超长音频**（60min 视频 PCM ≈ 1.27GB 全量驻留）——ffmpeg 通道内存随时长线性，需要上限护栏（警告或分析窗口受限），此项建议优先于继续优化通道。createBuffer 是唯一剩余主线程 WebAudio 调用且实测 0–11ms，预分配复用收益低、复杂度高，**不推荐**。

## 6. 依赖与安全决策（M1 期间追加）

- **electron ^44.0.0**（原模板 ^39.2.6）：npm audit 报 2 个高危（extract-zip ≤2.0.1 符号链接路径穿越，GHSA-jmr9-qjv8-65gv），官方修复版本为 electron 44。趁 M1 无 API 依赖时升级；新 Chromium 对 M4 的 WebCodecs 编码也更有利。
- **mp4-muxer@5.2.2 保留**（npm 提示被 Mediabunny 取代）：规格 §2 指定 mp4-muxer，且 5.2.2 在 WebCodecs→mp4 场景久经考验；Mediabunny 为同作者改名后继、API 相近，若 M4 遇兼容问题再迁移（迁移成本低）。
- **eslint 9.39.5 保留**（npm 提示 9.x 不再受支持）：@electron-toolkit/eslint-config 生态以 9.x 为基线，贸然升 10 风险大于收益；lint 全绿，功能无碍。
- 其余弃用警告（rimraf/glob/inflight/boolean）均来自 electron-builder 传递依赖，无直接操作面，不处理。
- npm 的 "electron_mirror 未知配置" 警告为无害噪音：该键由 electron 安装脚本消费，保留以加速国内下载。

## 22. 0.7.0「音频工程」决策（2026-08-30）

- **前导/淡入淡出（含预览修订）**：leadMs 作用于视频时间轴——导出视频总帧数 +lead，音频以 `afade=…,adelay=lead:all=1,apad` 后移并在 -shortest 处截齐；片头黑场/标题卡不改语义，仅把 introOutro 时间函数的总轴整体平移（leadSec 参数，lead=0 与 0.6.5 输出逐字节一致）。
  - ⚠ **初版方案「前导仅作用导出侧（预览保持原音轨）」在验收时被用户否决**（用户：不可预览怎么判断成功？需所见即所得）。修订为：**预览播放与导出同一时间轴**——播放键按下即进入前奏（黑场/标题卡 + 静音柱），音乐在前导结束时起播；进度条/时间显示 = 音频 + 前导；seek 可进入前导段（黑场）、也可跨过（音频对应起播）。实现：useAudioPlayback 加 leadMs 参数（AudioBufferSourceNode.start(when, offset) 调度 when = now+剩余前导），动效分发 (wall t, audioT=max(0,t−lead)) 与导出同口径；CanvasStage 传 audioLeadSec（IntroOutroLayer 黑幕）+ overlay 前导期间跳过粒子/后期（与导出同门控）；playTimeRef 在 lead 期间为负 → overlay 门控。编辑（拖动/改参数）仍然即时无等待——前导只作用于播放与导出。
- **动效分双时间轴**：wall 轴（运镜 Ken Burns、文本入场、粒子/后期连续项）与音频轴（频谱、踩点/呼吸/bass、beat 包络、flash）分离；导出侧 SceneLayers 分发 (t, audioT)，预览侧 audioT ≡ t。lead 期间音频轴钳 0（黑幕覆盖下无视觉差异），粒子/CanvasFX 在 audioT<0 整段跳过（纯黑前导不叠加粒子/闪光）。
- **护栏阈值 40min 警告 / 60min 拒绝**：44.1kHz 立体声 f32 解码 ≈ 1.27GB/60min；阈值取整便于沟通（40 警告、60 拒绝）；边界语义"严格大于"（恰 40/60 不触发）。m 探测用 ffmpeg -i 容器头（不解码、~百毫秒），探测失败时 Worker 流式字节上限（60min×48kHz×2ch×4B）兜底；too-long 错误**不落 decodeAudioData 兜底路径**（同样会 OOM）。
- **afade 参数顺序**：淡入/淡出作用于**歌曲本体**（st 以原时长计），再 adelay 前导（否则淡入会被 adelay 之后的静音段打散语义）；淡出起点 = duration − fadeOut（钳 ≥0）。
- **offsetMs 修复**：0.4.0 预埋的偏移只认正值（`offsetMs > 0` 守卫把负偏移静默钳 0，用户补负值校准时看到"无效果"）；统一改为 `offsetMs/1000`（spectrumAt 对负 t 已钳 center=0，安全）；UI 滑块 ±500ms 禁越界。
- **UI 位置**：前导/淡入淡出放「动效与后期 → 音频工程」分组（与时间语义同区）；偏移滑块放预览播放区（常驻可见、与播放进度同屏校验，附"正值=超前/负值=滞后"提示）。
- **已知小口径偏差（不计入本版）**：CanvasFxOverlay 的 energy 闭包在 offset≠0 时比导出多一次偏移（预览能量阶跃采样偏移 2×，导出 1×）——影响仅 beatFlash 的"能量阶跃"后备模式（手动节拍源开启时走 beat 包络不受影响）；待 1.0.0 时间轴重构时统一采样口径。

## 23. 0.8.0「素材与排版」决策（2026-08-30）

- **附加层 = 多层自由增删（用户选定）**：数组化模型（OverlayLayerConfig[]），z 序 = 数组序（主图之上、文本之下），上移/下移/删除；图像字节按 layerId 平行存放于 assets（不入布局 JSON）。稳定 id = crypto.randomUUID（增删/排序时资产跟随）。
- **与主图同等级完整 fx（用户选定）——提取而非复制**：把 MainImageLayer 的图像动效整体抽成共享组件（SharedImageFxLayer 内容 + SharedImageLayer 外层拖拽/Transformer/占位），主图改薄壳复用、行为零变化（smoke-visual 全项回归）；附加层额外获得：透明度滑块 + 入场动画（fade/slide/bounce——typewriter 为文本专属不适用）+ 四角快速摆位。参数化 kick（beat 包络）随音频轴驱动，与主图一致。
- **自定义字体不内嵌（用户修订）**：初版方案为 base64 内嵌（体积代价 3–30MB+33%），用户改为**路径引用**（同音频模型）——项目文件只存 {name, path}；打开时本机存在 → 读字节重建 File → useCustomFont 注册 FontFace；缺失 → 回退默认字体 + 提示（不阻断）。FontFace 家庭名 = NikoCustom-<文件基名>（确定性、跨会话可恢复）；同进程预览/导出天然同字形。
- **主题色（曾实现后移除——用户验收时：没必要）**：曾按"只改背景+可视化"范围实现（纯函数：32×32 降采样 → 亮度过滤 → 16 级频次桶主色 → 背景 −0.18 亮度 / 可视化 [主色, 亮 +0.25]；全过滤回退默认）并附带 theme.test 4 项与 smoke 校验；用户以"用途有限、锦上添花"为由要求删除——已连同实现/UI/i18n/smoke 全部移除，此条留档。
- **验收记录**：附加层保存/还原（smoke-project 两层 Logo+Watermark：层数/图像/解码全恢复）；字体路径保存/还原 + 缺失回退分支（实机缺字体场景由提示分支覆盖）；主题色应用/撤销（smoke-visual 状态级校验 + theme.test 4 项）；WYSIWYG：附加层/字体均走同一 SceneLayers + 同一 FontFace（预览/导出同源）。
- **顺带修复**：smoke-project 撤销/重做断言竞态（projectRef 读取与 React 提交之间加轮询；曾因大 base64 保存后的 GC 停顿读到半程状态）；smoke-visual 前导校验重试轮询（0.7.0
## 24. 0.9.0「编辑器体验」决策（2026-08-30）

- **z 序 = 全部场景元素自由排序（用户选定）**：层模型 = `layout.layers: LayerItem[]`（{id, hidden, locked}，null=默认序：背景→主图→附加层→歌名→作者→可视化）；SceneLayers 按数组序渲染（每元素一个 Konva Layer），fx 特效层（片头/片尾黑幕与标题卡）永远置顶不参与排序——它是效果层而非场景层。自定义序 → `hasCustomLayerOrder` → 导出全层逐帧（拆分快路径仅默认序可用），任意 z 序所见即所得。　原固定序（overlay 数组序/文本同层）改为数据驱动：文本拆 songTitle/artist 两图层。
- **锁定 = 画布锁定（用户选定）**：hidden=不渲染（预览/导出同源）；locked=画布不可选中/拖动/缩放（draggable=false + onSelect 抑制 + Transformer 隐藏），参数面板仍可调——主流编辑器语义，防误触而非禁编辑。附加层增删/移动同步 layers 数组（防双重簿记漂移）。
- **吸附对齐线**：候选线 = 画布边缘/中心 + 各元素边/中线；拖动六锚点（左中右/上中下）取阈值内最小位移（8 逻辑像素）；引导线为仅在拖动态显示的粉色虚线（SnapGuidesLayer 置于场景层之上、fx 之下）；`editor.snapEnabled` 默认开（图层页签可关）；隐藏元素不入目标集。
- **数值精调**：DeferredSlider 数字框（显示值=模型值×unitScale；↑↓ 步进、Shift×10、回车/失焦提交、越界钳制/非法回退）；百分比滑块 unitScale=100（fx/主图/文本等），秒/度/毫秒=1。
- **修复**：App layerRows 在 layers 已物化时把 LayerItem 对象当字符串调 startsWith → 首次图层面板渲染崩溃（排查：渲染进程 console 级联假失败，最终定位为类型联合在 `??` 后的运行时错误）；smoke 静态校验缺封面就绪等待（异步解码竞态假失败）。）。

- 渲染进程堆上限调查（2026-08-30，用户要求 8GB）：实测 Electron 44 内 js-flags 与顶层 max-old-space-size 开关（CLI 与 appendSwitch 两种路径）均无法改变 heap_size_limit（钉死 4192MB）——flag 已到达 V8（expose-gc 生效），但 Blink/Electron 的 V8 老生代上限不随其变化（上游 electron/electron#41248 同症状）。结论：4GB 上限是平台硬约束（进程为 x64，与 32 位无关）；要更多头寸只能消除 GB 级常驻：① 导出 mp4-muxer 改流式写盘（当前整视频 ArrayBufferTarget 驻留渲染进程）；② 长音频 PCM mono（60min 约 1.27GB）依赖 60min 护栏；③ 撤销栈保持素材不入历史。已记入 CLAUDE.md 约束。


## 25. 1.0.0「时间轴与多场景」决策（2026-09-01）

> 范围：场景片段（完整布局快照）+ 片段内关键帧；导出流式写盘；时间轴 UI；面板上下文化。预设/模板系统不做（ROADMAP 已注明可独立成版）。

- **继承式全局基线（一改即拆，用户确认）**：段 layout:null = 继承全局；任何面板修改自动写时复制（seg.layout = {...(seg.layout ?? 全局), ...patch}）。单一事实来源在 useProject：所有布局写入经 commit() 路由（全局→applyLayout；段→CoW 物化），面板零感知。
- **片段 + 关键帧模型**：TimelineSegment {id,startSec,endSec,layout,keyframes[]}；关键帧 t 相对片段起点（绝对秒）；属性 = 点路径（v1 目录 24 条：字号/位置/透明度/颜色类/描边/辉光/Ken Burns/呼吸/可视化）；插值数值 lerp、#rrggbb 通道插值、非颜色字符串=开关；缓动注入表复用 fx.ts（开闭原则）。
- **硬切语义（v1）**：重叠区间按排序靠前（更早 startSec）者生效；重叠仅非破坏标红提示；缝隙 = 全局基线显示；淡入过渡 0.3s 留后续。音频长度变化 → 自动钳制（超界删除/endSec 钳制，无改动不入史）。
- **时间轴 UI**：整体底部（用户选定）；主行 = 侧栏 400px + 画布；TimelineBar 纯 props（播放头/片段块/分割/删除/边界拖拽/重叠标红/关闭）。
- **面板上下文化**：「当前编辑对象」条（全局 | 片段N）于布局四面板顶部；歌曲信息输入保持全局（updateTextGlobal——元数据语义）；画布按播放头 resolveLayoutAt 解析（编辑目标=所选片段时编辑即所见）。
- **预览接入 = diff 门控而非命令式 patch（偏离原计划的取舍，实测记录）**：resolveLayoutAt 零拷贝捷径（无关键帧段返回同一对象）+ resolvedSnapshotKey（目录叶值+片段结构）+ 模块级 WeakMap（布局对象身份为第一失效层）→ 键不变 React 整树跳过；关键帧动画/片段切换/编辑才逐帧重渲。命令式节点 setter 留待 T10 性能验收不足时升格。
- **导出接入**：hasTimeline 并入 dynamic 判定（逐帧全层渲染）；每帧 resolveLayoutAt(wall_t) → ExportStageHost.setLayout（flushSync 同步应用，静态段同一对象自动跳过）。
- **流式写盘（用户确认五点全落地）**：mp4-muxer StreamTarget（chunked 4MiB、fastStart:false=moov 尾置，重排交给 ffmpeg merge -movflags +faststart）；三级背压 ① encoder encodeQueueSize<=2（dequeue 事件等待）② 编码输出天然小 ③ ACK=fs.write 回调、renderer 在途 1 块+每帧 throttle(8MB)；错误协议（写失败→invoke reject→i18n 可读提示→main 删临时文件）；取消协议（停发+关 fd+删文件）。
  - **实测修正：MessagePort 流（MessageChannelMain + contextBridge）在本构建不可达**（renderer 发送后 main port1 收不到；日志实证）→ 降级为 invoke 分块写（每块一次 muxer:write，拷贝 4MB≈1ms，与零拷贝传输差可忽略）——channel 常量与注释保留在 ipc.ts。
  - **实测修正：mp4-muxer onData 乱序**（chunked 目标 finalize 时的调用顺序非字节序；曾致 moov 缺失 ffmpeg「moov atom not found」）→ main 按 position 定位写（FileHandle.write(fd,buf,0,len,pos)，乱序到达正确落盘）。
- **慢盘背压探针（smoke-probe）**：NIKO_SMOKE_PROBE_RATE(字节/秒) 主进程限速 ACK；2/4/8MB 块 × 24MB 数据——实测队列峰值 = 在途恰 1 块（2.0/4.0/8.0MB）、堆增量 0、吞吐精确匹配限速 → 背压有界性证据。
- **验收证据**：smoke-time（引擎插值 0.28✓/段覆盖 0.7✓/缝隙=全局✓ + 预览像素 143845/90210 差异——WYSIWYG 预览链路）；smoke-export 三路 done（流式→合并→ffprobe）；内存验收进行中（60min 1080p / 10min 4K 堆峰值 <2GB；4GB VM 另行窗口）。

## 26. 锚点间过渡——关键帧编辑体验（2026-08-30）

> 用户反馈：除两帧之间外，段落到帧 / 段落到段落 / 段落到全局 / 全局到段落均为突变。本决策落地四类锚点间过渡，全部为纯函数（shared/timeline.ts），预览/导出同源（核心约束 A 延伸）。

- **语义总纲（任一锚点的过渡方式 = 到达该锚点的软过渡）**：帧轨道首帧的 easing 同时描述「基准→首帧」与「首帧→次帧」两区间（首帧是唯一无左侧帧的锚点，取其 easing 自然且够用）；hold=到达前保持前值、锚点时刻突变（保留用户确认的「t<a 继承、t>=a 变值」硬切语义）。
- **段落到帧（applyTrackSet）**：t < 首帧 且非 hold → 基准值（段继承值/全局动画值）与首帧值按首帧 easing 在 [段起点, 首帧] 渐变；hold → 保持基准、首帧时刻突变。首帧在段起点（t≈0）：进入窗口的「段提前生效」态直接取首帧值（边界到达=帧值，保证窗口内连续）。
- **段属性过渡（v5 最终模型，用户确认：过渡属于段落本身；相接两段直接互溶、不经过背景层）**：`TimelineSegment.transitionIn/transitionOut = {durationSec, easing}`——段首过渡 = 本段开头 d 秒与**上一锚点**（相接前段=直接互溶，否则全局基线）互溶；段尾过渡 = 本段结尾 d 秒与**下一锚点**（相接后段=直接互溶，否则全局基线）互溶。**设置属于段落 → 改长度/增删相邻段永不失效**；目标跟随场景（后接对象变化时过渡自动指向新对象）。相接处两侧都设过渡 → 合并为一条连续互溶窗（A↔B 直接、时长相加、曲线取段尾侧）。
- **解析（非递归，窗口按构造不相交）**：`computeTransitionWindows` 列出全部过渡窗口（段首与前无相接段 → [start, start+inH)；段尾 → [end-outH, 后接锚点]——后段段首过渡并入同一窗口）；每侧 ≤ 段长一半 → 任意两窗口不相交（无打架）；命中 → 双锚点世界按曲线互溶（段侧=段生效态拉伸/提前，全局侧=全局轨道应用），未命中 → 常规段/全局。快路径：无任何段属性过渡 → 原零拷贝语义。
- **混合（lerpLayouts）**：以目标态为骨架逐叶插值（数值 lerp、#rrggbb 通道插值、其他字符串中点切换；数组按索引长度一致时、对象按键并集）；p<=0 → a、p>=1 → b（零开销端点身份）。**过渡曲线（v3.1 用户需求）：切点规格 `{durationSec, easing}`——窗口内先线性进度再按曲线映射（复用 EASINGS 族）；easing=hold 视同硬切（无窗口）**；快路径：无任何切点配置时保持原零拷贝身份语义。
- **UI/可观察性（v5 修订）**：过渡编辑在侧栏「关键帧」页顶部「过渡」小节——「段首过渡/段尾过渡」两行（时长 + 曲线下拉；提示说明锚点跟随语义：相接段直接互溶 / 全局基线）；时间轴以青色斜纹绘制过渡窗口（与引擎同一 computeTransitionWindows = 所见即所得）；数字输入全局无原生上下箭头。磁性吸附（±0.25s）+ 邻域钳制允许零缝 + CUT_ADJ_EPS=0.05 相接容差（拖边界仍可能改变相接对象，但过渡设置作为段属性永不失效）。i18n 三语同构。验收：vitest 114 例（直接互溶不经过全局/双侧合并连续/改长度不失效/曲线 mid=0.875/hold 退化/段长一半钳制/…）全绿 + smoke-time（引擎 0.435 + 预览像素）ok。

## 27. P0 音频解码重构：手写流控 → 文件流（2026-02-15）
> 现象：>4MB PCM（≈35s 音频）只解码第一块（35s→11.6s≈4MB）；修复流控后 23.3s（≈8MB）——残留在块边界/pause-resume 停止，属 race 而非背压。结论：不修 race，消灭 race。
- **结构**：ffmpeg f32le stdout → Node `pipeline(proc.stdout, createWriteStream(tmpPcm))`（文档化背压），渲染侧 `audioDecodeStart`（await 解码完成，返回 token/路径/声道）→ `audioDecodeRead(token, offset, 4MB)` 分块拉取（文件句柄会话内缓存）→ `audioDecodeDispose`（删临时文件）→ `audioDecodeCancel`（kill+清理）。删除全部手写池化/pause/resume/在途泵收尾逻辑。
- **收益**：截断消除（race 不再存在）+ 解码提前等待重排（start invoke 等待完整解码，UI 经 invoke 异步响应不受影响；播放 ready 由 worker finalize 门控，无早期播放收益）；临时文件 60min≈1.27GB、读毕即删，仍在 4.19GB 堆护栏内。
- **代价**：磁盘 IO 一次顺序写 + 一次分块读（首次解码延迟窗口 ≈ 编码耗时，与旧推送流相同）；临时文件路径在 app.getPath('temp')，异常退出留残（dispose/cancel/error 三处清理 + 新请求 kill 旧请求）。
- **验收**：smoke-export 1080p@35 全 fx → ffprobe 35.00s（此前 11.6s/23.3s）；smoke-time 8s 解码 + smoke-visual 音频链全绿；vitest 119 例全绿。

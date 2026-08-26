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
- **GitHub 同步**（用户要求）：私有仓库 github.com/NirvanaKaruma/NikoKaraokeVideoMaker，默认分支 main，通过本机 SSH 密钥（gh CLI 未安装）推送；每个里程碑提交后同步。

## 6. 依赖与安全决策（M1 期间追加）

- **electron ^44.0.0**（原模板 ^39.2.6）：npm audit 报 2 个高危（extract-zip ≤2.0.1 符号链接路径穿越，GHSA-jmr9-qjv8-65gv），官方修复版本为 electron 44。趁 M1 无 API 依赖时升级；新 Chromium 对 M4 的 WebCodecs 编码也更有利。
- **mp4-muxer@5.2.2 保留**（npm 提示被 Mediabunny 取代）：规格 §2 指定 mp4-muxer，且 5.2.2 在 WebCodecs→mp4 场景久经考验；Mediabunny 为同作者改名后继、API 相近，若 M4 遇兼容问题再迁移（迁移成本低）。
- **eslint 9.39.5 保留**（npm 提示 9.x 不再受支持）：@electron-toolkit/eslint-config 生态以 9.x 为基线，贸然升 10 风险大于收益；lint 全绿，功能无碍。
- 其余弃用警告（rimraf/glob/inflight/boolean）均来自 electron-builder 传递依赖，无直接操作面，不处理。
- npm 的 "electron_mirror 未知配置" 警告为无害噪音：该键由 electron 安装脚本消费，保留以加速国内下载。

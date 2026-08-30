# TEST.md — 验收与自测记录

> 规格 §5 全套验收结果。测试环境：Windows（开发机），Node v24.16，系统 ffmpeg 8.1.1（WinGet），应用托管 ffmpeg 9.0.1-essentials。
> 测试素材与产物目录：TEST-ARTIFACTS/（gitignore）。执行时间：2026-08-27。

## 1. 测试素材（§5.1）

- **音频**：双音调 WAV（前 1/2 时长 440Hz、后 1/2 1200Hz，44.1kHz 单声道 16bit），由应用内合成（smoke 模式 makeTwoToneWavFile），用于验证"频谱随音乐内容变化"。
- **封面**：合成 PNG（800×800 渐变 + 图形 + 文字），经「File → blob URL」路径加载（与用户手动选图同一代码路径）。
- **透明底 PNG / 普通 PNG**：主图透明通道由合成封面 + contain 模式覆盖验证；背景层"先与背景色合成再模糊"由像素校验覆盖（背景铺满检查）。

## 2. 720p / 1080p 端到端导出（§5.2）

命令：

```powershell
npx electron . --smoke-export=720p,1080p@35   # 35 秒素材，各导出一次
```

结果（smoke-export-report.json）：

| 分辨率            | 总耗时 | 编码性能                    | 结论 |
| ----------------- | ------ | --------------------------- | ---- |
| 720p (1280×720)   | 12.3s  | 1050 帧 / 5s（平均 4ms/帧） | 通过 |
| 1080p (1920×1080) | 20.1s  | 1050 帧 / 8s（平均 8ms/帧） | 通过 |

ffprobe 校验：

```
720p:  codec h264 + aac | 1280x720 | 30fps | duration=35.000000  （与音频时长误差 0s）
1080p: codec h264 + aac | 1920x1080 | 30fps | duration=35.000000
```

## 3. 频谱动态验证（§5.3）

命令：

```powershell
ffmpeg -y -v error -ss 5  -i smoke-720p.mp4  -frames:v 1 -vf "crop=614:129:627:273"  f720-viz-5.png
ffmpeg -y -v error -ss 30 -i smoke-720p.mp4  -frames:v 1 -vf "crop=614:129:627:273"  f720-viz-30.png
ffmpeg -y -v error -ss 5  -i smoke-1080p.mp4 -frames:v 1 -vf "crop=921:194:941:410"  f1080-viz-5.png
ffmpeg -y -v error -ss 30 -i smoke-1080p.mp4 -frames:v 1 -vf "crop=921:194:941:410"  f1080-viz-30.png
# 背景区：crop=192:108:0:0（720p）/ crop=150:150:60:40（1080p）
& .\compare-frames.ps1 -ImageA f720-viz-5.png -ImageB f720-viz-30.png
```

结果（compare-frames.ps1，System.Drawing 逐像素比对，容差 20，隔行采样）：

| 区域               | 720p                        | 1080p                        |
| ------------------ | --------------------------- | ---------------------------- |
| 可视化区 5s vs 30s | 478 差异像素（2.43%）→ 不同 | 1097 差异像素（2.46%）→ 不同 |
| 背景区 5s vs 30s   | 0 差异 → 相同               | 0 差异 → 相同                |

结论：频谱柱随音频内容（440Hz→1200Hz 段）实时变化；静态层（背景/主图/文本）逐帧一致。

## 4. 4K 冒烟（§5.4）

```powershell
npx electron . --smoke-export=4k@10    # 10 秒素材
```

结果：通过，总耗时 29.9s（300 帧，编码平均 38ms/帧）。
ffprobe：h264 + aac | 3840x2160 | duration=10.000000。

## 5. ffmpeg 来源管理矩阵（§5.5）

三种情况通过操控 PATH 复现（npx electron . --smoke-detect）：

| 场景                  | 操作                                     | effective 结果                      |
| --------------------- | ---------------------------------------- | ----------------------------------- |
| A：有系统版           | 正常 PATH（WinGet ffmpeg 8.1.1）         | source=system, path=ffmpeg          |
| B：无系统版、有托管版 | PATH 裁剪（仅系统目录+node）+ 托管版已装 | source=managed（9.0.1，自动回退）   |
| C：全无               | PATH 裁剪 + 托管版未装                   | available=false → 导出禁用 + banner |

**托管安装实测**：

```powershell
npx electron . --smoke-download=default          # 真实下载 gyan.dev
npx electron . --smoke-download=file:///D:/program/videomaker/TEST-ARTIFACTS/ffmpeg-local.zip  # 本地镜像
```

- 真实下载：通过。gyan.dev 可达（本机网络正常），下载 100% → 解压 → 校验 → ffmpeg 9.0.1-essentials，aac 有、libx264 有；
- 本地镜像：通过。file:// 直拷 → 解压 → 校验 → ffmpeg 8.1.1-full，aac 有；
- 两者均"只解压 ffmpeg.exe 到 userData/ffmpeg/"；下载进度事件逐条上报；取消/重试路径由 UI 提供。

## 5.5 GPU 加速检测（用户反馈新增）

```powershell
npx electron . --smoke-bench   # 1080p：prefer-hardware 与 prefer-software 各编码 30 帧实测
```

本机结果：硬件 9.2ms/帧 vs 软件 6.1ms/帧 → 结论「本机 GPU 编码未带来加速（软件反而更快）」，导出自动选用软件编码（已验证：导出日志显示 avc1.640033（软件））。

机制：① 导出按「硬件优先→自动→软件」顺序探测，且检测结果自动持久化（localStorage niko.encode.modePref），本机软件更快则改「软件优先」；② 「导出」面板提供「检测 GPU 加速」按钮，随时重测（换显卡/驱动后可用）。此结论为**本机实测**，用户机器各有不同——检测功能按机器自适应。

## 5.7.7 音频可视化频率范围（M6 后五轮）

- **用户反馈**：① 右侧柱几乎不动（音乐能量集中在低频，默认 30–16000Hz 的 4k–16k 段基本无内容）；② 改柱数只是视觉"拉宽/压扁"（暂停态柱数组未随新柱数重算，旧长度数组被挤进新槽位）；③ 需要手动调节显示频率范围的选项。
- **修复**：① VisualizerConfig 新增 freqMin/freqMax（默认 30–8000Hz，向低频偏移）；② useAudioPlayback 配置变化时同步分析器并立即重算（柱数/频率/灵敏度）；SceneLayers 柱组一律按 config.barCount 槽位绘制（bars[i] 缺失补 0）；③ 面板新增「显示频率范围」双滑块 + 4 个快捷预置。
- **回归**：单测 21/21（新增频率钳制、柱位随范围变化、平滑长度变化）；smoke-visual 音频 7/7（新增「频率范围可调」：30–8k 440Hz 峰值 #61 → 30–4k #69，柱数不变）；smoke-project 11/11。

## 5.7.6 保存后脏标记（M6 后四轮）

- 曾出现「保存后点关闭仍提示未保存」：脏快照 hasBg 字段漂移（保存点未同步）。
- 修复：统一 snapshotOf() 构建；smoke 新增「保存后未脏」「新建后未脏」，11/11 通过。

## 5.7.5 独立背景图（M6 后三轮）

- 背景默认封面图；可上传独立背景图（自动切换 custom），一键清除回退默认；来源切换可 Ctrl+Z；
- smoke-project 扩展至 9/9：背景图保存/恢复（bgUrl+bgElement+source=custom 全还原）、撤销×4/重做×4、新建重置含背景清空。

## 5.8 编辑体验回归（M6 后二轮）

- smoke-project 扩展至 8 项：新增「撤销」（undo×3 回到保存点：歌名/柱数/模糊全还原）与「重做」（redo×3 恢复篡改值）✓；
- 文本框缩放/关闭守卫为交互功能，由用户手动验证；smoke-visual 11/11 回归通过（文本层渲染等价）。

## 5.8 性能优化回归（M6 后）

- 背景半分辨率缓存：smoke 像素校验 5/5 通过（背景模糊视觉等价、主图白色圆盘 255,255,255）；
- Konva 共享图片缓存污染：背景私有画布副本修复，主图落位校验恢复通过（曾出现主图区域全灰的回归，现加「占位灰蓝像素」诊断字段防复发）；
- 预览频谱命令式更新：音频链路 6/6 通过；1080p 导出回归 3.9s（6s 素材）通过。

## 6. 回归项

- 单测：16/16（layout 10 + spectrum 6）；
- smoke-visual：静态像素 5/5 + 音频频谱 6/6（含「播放中 seek 不中断」回归）；
- 性能回归：隐藏窗口编码曾因 Chromium 定时器节流从 13ms/帧劣化到分钟级——已用 MessageChannel 让出事件循环 + backgroundThrottling:false 修复（720p 恢复 4ms/帧）。

## 6.5 项目保存/加载（M5）

```powershell
npx electron . --smoke-project   # 保存 → 篡改 → 加载 → 恢复验证
```

结果 6/6 通过：保存项目（.niko.json 落盘）✓ 布局恢复（歌名/柱数/模糊全还原）✓ 封面恢复（内嵌 dataURL）✓ 音频恢复（按路径读回并解码 3.00s）✓ 音频就绪 ✓ 新建重置（默认布局+素材清空）✓。

M5 反馈追加：存档扩展名改为 .niko 且内容 AES-256-GCM 加密混淆（文件头 NIKO1，明文不再出现；旧明文档兼容读取）；新增「新建项目」重置功能。

## 7. 打包自测（§5.6，M6 完成）

### 产物与体积

| 产物                                                           | 体积     |
| -------------------------------------------------------------- | -------- |
| portable 便携版（niko-karaoke-video-maker-0.1.0-portable.exe） | 105.7 MB |
| NSIS 安装包（niko-karaoke-video-maker-0.1.0-setup.exe）        | 106.0 MB |
| 解包目录 dist/win-unpacked                                     | 367.5 MB |

**产物不含 ffmpeg 工具链**：全目录检索无 ffmpeg.exe / ffprobe / ffplay；仅存在 ffmpeg.dll（Electron/Chromium 运行时自带媒体库，属运行时组件而非捆绑的 ffmpeg 工具）。

### 无 Node 干净目录实测

环境：新目录 TEST-ARTIFACTS/clean-room/（仅 portable exe），PATH 裁剪为仅 C:\Windows\System32;C:\Windows（无 node、无 ffmpeg）。

```powershell
$env:NIKO_SMOKE = 'detect'          # 或 'export:720p@8'
$env:NIKO_SMOKE_DIR = (Get-Location).Path
Start-Process -FilePath '.\NikoKaraokeVideoMaker.exe' -Wait -PassThru
```

结果：

- 三源检测：系统 PATH 无 ffmpeg → **自动回退托管版**（userData ffmpeg 8.1.1，aac+libx264+nvenc/qsv/amf+全硬件加速器）✅；
- 端到端导出 720p@8：**done，4.3s，产物 smoke-720p.mp4（299,713 字节）** ✅。

### 最终重打包（性能优化版）

2026-08-27：性能优化（滑块延迟提交 / 背景半分辨率缓存 / 预览频谱命令式更新 / 系统字体枚举）合入后重新打包，dist 产物已更新；新 portable 干净目录复验：720p@6 导出 2.7s 通过。

### 打包工程备注

- electron-builder 二进制走 npmmirror 镜像、缓存本地化（.electron-builder-cache/）；
- portable 启动器**不转发命令行参数**且会改 cwd 到临时解压目录（退出即删）——因此 smoke 模式增加环境变量通道：NIKO_SMOKE（detect|bench|project|visual|export:...|download:...）+ NIKO_SMOKE_DIR（报告输出目录）；
- 图标为程序化生成的占位图标（build/icon.png → 自动转 ico）；
- 未做代码签名（SmartScreen 提示见 README FAQ）。

---

## 8. 1.0.0「时间轴与多场景」验收记录（2026-09-01）

- **单测 92 全绿**（timeline 引擎 6 + 关键帧目录 4 + 既有 82）：插值/缓动/边界/段覆盖/缝隙=全局/重叠校验/音频钳制/硬切优先序。
- **smoke-time（--smoke-time）全绿**：两片段(0-4/4-8) + seg2 关键帧(mainImage.rect.x 0.06→0.5 linear) —— 引擎断言 ×3（t=6 插值 0.2800✓ / sed1 覆盖 0.7000✓ / 缝隙=全局基线✓）+ 预览像素断言 ×2（关键帧动画 143845 差异像素、片段切换 90210）—— 实证 seek→resolveLayoutAt→diff 门控→Konva 渲染的 WYSIWYG 预览链路。
- **smoke-export 三路 done**（720p@8）：纯净/fx/af 全 done + ffprobe 时长·抽帧校验（流式写盘→ffmpeg 合并 +faststart）。
- **smoke-probe（--smoke-probe，NIKO_SMOKE_PROBE_RATE=4194304）全绿**：2/4/8MB 块 × 24MB —— 队列峰值=在途恰 1 块（2.0/4.0/8.0MB）、堆增量 0MB、吞吐精确匹配 4MB/s —— 三级背压有界性直接证据。
- **内存验收：60min 1080p 导出**（--smoke-export=1080p@3600，真实 317MB WAV 解码+导出）：1080p 纯净变体 done（211s 编码），**全程渲染进程堆峰值 631MB < 2GB** ✅；720p+af 60min done（608s）。1080p+fx 变体受烟测每变体 15min 上限截停（非缺陷；可用 NIKO_SMOKE_EXPORT_TIMEOUT_MS 放宽重跑）。
- **性能验收长跑过程中修复的主进程缺陷（e051dea）**：音频流式解码主进程 OOM（每 64KB Buffer.concat + 无 socket 背压 → 1.27GB f32 IPC 排队）→ 池化批拼接 + stdout pause/resume 真背压 + 收尾等泵（附带修复 close 竞态曾致音频 60s→24.9s 截断）；60s 回归（720p@60 三路全 done + 校验通过）确认字节完整性。
- **4GB VM 全流程**：待独立执行窗口（拟 4GB 虚拟机完整导出+保存/加载回归）。
- **4K 验收**：按用户决策移出 1.0.0 口径（软件本版不主打 4K；导出选项保留）。

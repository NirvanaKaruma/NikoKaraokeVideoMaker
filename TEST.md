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

## 7. 打包自测（§5.6）

见 M6 完成后追加记录（无 Node 干净目录 portable 实测 + 体积）。

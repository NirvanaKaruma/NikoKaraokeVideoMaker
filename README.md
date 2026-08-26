# NikoKaraokeVideoMaker

KTV 字幕底视频生成器：输入歌曲名、作者、一张封面图与一个音频，一键生成带音频与音频频谱可视化的 16:9 MP4。
Windows exe 交付，双击即用，目标机器**无需安装 Node.js**；ffmpeg 由应用引导获取（不捆绑进安装包）。

---

## 一、用户指南（双击即用）

### 1. 下载与运行

- **portable 便携版**：dist 目录下 niko-karaoke-video-maker-<版本>-portable.exe，双击即用，免安装；
- **NSIS 安装包**：dist 目录下 niko-karaoke-video-maker-<版本>-setup.exe，安装后开始菜单/桌面快捷方式。

### 2. 三步做出一个视频

1. 打开应用 → 左栏「素材与画面」：拖入**封面**（png/jpg/webp，支持透明）与**音频**（mp3/wav/flac/m4a；也支持 mp4/mov/webm 视频取音轨），输入歌曲名与作者；
2. 点「▶ 播放」预览（频谱随音乐实时跳动）；在「文本样式」「音频可视化」tab 调整样式，点选画布元素可拖动位置（主图可拖角等比缩放）；
3. 右上角「**导出**」→ 选分辨率（720p/1080p/2K/4K）与帧率（30/60）→「开始导出」→ 等待进度完成。

### 3. ffmpeg 三种来源（重要）

本软件**不捆绑 ffmpeg**，按以下优先级获取（设置 → ffmpeg）：

1. **系统 ffmpeg**：启动时自动检测 PATH 中的 ffmpeg（校验 aac 编码器），有则默认使用；
2. **应用托管版**：一键下载 gyan.dev 稳定版，只解压 ffmpeg.exe 到用户数据目录（下载进度可见、可取消；网络不佳可在设置里改镜像地址，也支持 file:// 本地包）；
3. **手动指定**：浏览选择任意 ffmpeg.exe。

没有任何可用 ffmpeg 时，顶部会出现提示且导出按钮禁用。

### 4. 项目保存 / 打开 / 新建

- 「保存项目」：布局、样式、封面全部存入专有后缀的 **.niko** 文件（内容已 AES-256-GCM 加密混淆，防直接查看/篡改；音频只记路径）；
- 「打开项目」：一键恢复；音频文件被移动后会提示重新拖入；
- 「新建项目」：清空当前内容，恢复默认布局。

### 5. 常见问题（FAQ）

- **无网络且没有 ffmpeg 怎么办？** 从其他电脑拷贝一个 ffmpeg.exe，用「设置 → ffmpeg → 手动指定」即可；
- **Windows SmartScreen 警告？** 本软件未做代码签名，属正常提示：点「更多信息 → 仍要运行」；
- **透明底封面？** 背景层会先与「背景色」合成再模糊；主图透明区透出背景；
- **4K 导出很慢？** 4K 编码量大（本机实测约 26fps 编码速度），建议先用 1080p；
- **GPU 加速？** 「设置 → 编码加速」可实测本机硬件/软件编码速度，并显式选择 自动 / 强制 GPU / 强制 CPU；
- **导出时最小化窗口会变慢吗？** 不会，已做防节流处理。

---

## 二、开发指南

### 环境

Node.js ≥ 20（开发机已验证 v24），Windows 10/11。

### 常用命令

```bash
npm install          # 安装依赖（electron 走 npmmirror 镜像，缓存本地化）
npm run dev          # 开发模式（HMR）；或双击 dev.bat
npm run typecheck    # 类型检查
npm run lint         # ESLint
npm test             # vitest 单元测试（layout/spectrum）
npm run build        # typecheck + 三端打包到 out/
npm run smoke        # 无头 IPC 往返自测
npm run smoke:visual # 无头像素校验 + 音频频谱校验（11 项）
npm run build:win    # electron-builder（NSIS + portable，不捆 ffmpeg）
```

### 无头自测模式（CI 友好）

| 命令                                        | 用途                                        |
| ------------------------------------------- | ------------------------------------------- |
| npx electron . --smoke-test                 | IPC 往返                                    |
| npx electron . --smoke-visual               | 舞台截图 + 5 项像素校验 + 6 项音频链路校验  |
| npx electron . --smoke-export=720p,1080p@35 | 端到端导出（落盘 TEST-ARTIFACTS）           |
| npx electron . --smoke-export=4k@10         | 4K 冒烟                                     |
| npx electron . --smoke-detect               | ffmpeg 三源检测（配合 PATH 操控做来源矩阵） |
| npx electron . --smoke-download=default     | 托管安装实测（=file:///... 本地镜像）       |
| npx electron . --smoke-bench                | GPU 加速基准（硬件 vs 软件）                |
| npx electron . --smoke-project              | 项目保存/加载自测                           |

### 架构速览

- **进程**：main（ffmpeg 管理、文件、合并、打包）/ preload（白名单 API）/ renderer（React + Konva 编辑器、Web Audio、WebCodecs）；
- **核心约束 A**：预览与导出共用同一份归一化布局数据与同一套 SceneLayers 绘制代码（导出用隐藏 ExportStageHost 拆静态/动态两层）；
- **核心约束 B**：坐标归一化（x/y/w 相对宽、h 相对高），分辨率由 RESOLUTIONS 数组驱动；
- **导出管线**：静态层一次渲染 + 逐帧频谱 → WebCodecs H.264（GPU 优先探测）→ mp4-muxer → main 用 ffmpeg 执行 -c:v copy -c:a aac -b:a 192k -shortest -movflags +faststart 合并；
- **频谱**：2048 点 Hann 窗 FFT + 对数频率分桶（shared/spectrum.ts，预览/导出共用）。

---

## 三、如何扩展新分辨率 / 比例

1. 打开 src/shared/layout.ts，在 RESOLUTIONS 数组追加一项（如 21:9 的 3440×1440）：

```ts
{ id: 'uwqhd', label: '3440×1440', width: 3440, height: 1440 }
```

2. 若新比例非 16:9，画布布局仍按归一化坐标渲染（元素相对画布自适应），无需改布局模型；
3. 如需按比例提供不同默认布局，可在 DEFAULT_LAYOUT 基础上按 canvas 比例写预设；
4. 导出码率如需定制，改 src/renderer/src/export/exportVideo.ts 的 BITRATE_TABLE。

---

## 四、交付物与体积

- 打包产物：dist/（NSIS 安装包 + portable exe，**不含 ffmpeg 二进制**）；
- 文档：TEST.md（§5 验收全记录）、docs/DECISIONS.md（全部决策与理由）、nikokaraoke.md（任务清单）；
- 体积记录见 TEST.md §7。

## 五、已知限制

- 纯视频先整块写入内存再落盘（3–5 分钟 1080p 约 100–250MB），超长视频建议后续改流式；
- 界面语言当前为简体中文，i18n 接口已预留（设置 → 语言）；
- 应用未做代码签名（SmartScreen 提示见 FAQ）。

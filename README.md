# NikoKaraokeVideoMaker

KTV 字幕底视频生成器：输入歌曲名、作者、一张封面图与一个音频，一键生成带音频与音频频谱可视化的 16:9 MP4。
Windows exe 交付，双击即用，目标机器无需安装 Node.js（ffmpeg 由应用引导安装，不捆绑进 exe）。

> 状态：M3 完成——文本样式全套（含字体选择）、真实频谱可视化（FFT，随音乐实时跳动）、预览播放（播放/暂停/进度/seek）。
> 预览截图：docs/screenshots/m3-preview.png（无头 smoke 自测生成）。

## 功能特性（目标）

- 上半区画面：模糊封面背景 + 主图 + 歌曲名/作者文本 + 随音乐实时跳动的频谱可视化；下半区留白给字幕。
- 封面支持 png / jpg / webp（含透明通道）；音频支持 mp3 / wav / flac / m4a。
- 导出分辨率：1280×720 / 1920×1080 / 2560×1440 / 3840×2160（16:9，配置数组可扩展）。
- 所见即所得：预览与导出共用同一份布局数据与同一套绘制代码。
- ffmpeg 三源管理：① 系统 PATH 自动检测（默认优先）② 应用托管一键下载 ③ 手动指定路径。

## 开发指南

```bash
npm install        # 安装依赖（electron 走 npmmirror 镜像，缓存重定向到 .npm-cache/）
npm run dev        # 开发模式（HMR）；或直接双击 dev.bat 启动
npm run typecheck  # 类型检查
npm run lint       # ESLint
npm run build      # typecheck + 打包 out/
npm run smoke      # 构建后无头启动，执行 IPC 往返自测（结果写入 smoke-result.txt）
npm run build:win  # electron-builder 打包 Windows 安装包（M6 就绪）
```

## ffmpeg 三源说明（简版）

1. **系统 ffmpeg**：应用启动时异步自动检测 PATH 中的 ffmpeg，校验 aac 编码器后默认使用；设置页可"重新检测"。
2. **应用托管 ffmpeg**：一键下载 gyan.dev 稳定版并只解压 ffmpeg.exe 到用户数据目录；下载进度可见、支持重试。
3. **手动指定**：在设置页选择本机的 ffmpeg.exe 路径。

所有 ffmpeg 调用统一由主进程管理；没有任何可用 ffmpeg 时，导出按钮禁用并引导安装。

## 文档索引

- [docs/DECISIONS.md](docs/DECISIONS.md) — 全部已确认决策与理由
- TEST.md — 验收与自测记录（M4 起生成）
- nikokaraoke.md — 任务清单（勾选行 = 进度真相）

## FAQ（占位，M6 完善）

- 无网络且无 ffmpeg 怎么办？
- Windows SmartScreen 警告如何处理？
- 透明底 PNG 的注意事项？
- 4K 导出性能如何？

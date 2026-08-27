# NikoKaraokeVideoMaker

KTV 字幕底视频生成器（Windows 桌面应用）：输入歌曲名、作者、封面图与音频，一键生成带实时频谱可视化的 16:9 MP4。

© 2026 NirvanaKaruma | [GitHub 仓库](https://github.com/NirvanaKaruma/NikoKaraokeVideoMaker)

## 从源码构建

### 环境要求

- Windows 10/11（构建目标是 Windows x64）；
- Node.js ≥ 20（开发环境已验证 v24）；
- npm（随 Node.js 附带）。

### 构建步骤

```bash
# 1. 安装依赖
npm install

# 2. 开发模式（热重载，适合调试）
npm run dev

# 3. 构建 Windows 可执行文件（NSIS 安装包 + 便携版）
npm run build:win
```

构建产物位于 `dist/`：

| 文件 | 说明 |
| ---- | ---- |
| `niko-karaoke-video-maker-0.2.0-portable.exe` | 便携版，双击即用，免安装 |
| `niko-karaoke-video-maker-0.2.0-setup.exe` | NSIS 安装包，可自定义安装目录 |
| `win-unpacked/` | 未打包目录（开发者调试用） |

### 项目脚本速查

| 命令 | 说明 |
| ---- | ---- |
| `npm run dev` | 开发模式（HMR） |
| `npm test` | 单元测试（vitest，布局模型 + 频谱算法） |
| `npm run typecheck` | TypeScript 类型检查（node + web 两套） |
| `npm run lint` | ESLint |
| `npm run build:win` | 打包 Windows 安装包与便携版 |
| `npx electron . --smoke-visual` | 无头自测：像素校验 + 频谱链路（11 项） |
| `npx electron . --smoke-export=720p@6` | 无头端到端导出自测 |

> 国内网络下，`npm install` 的 Electron 二进制下载已配置 npmmirror 镜像（`.npmrc`），如遇超时可重新执行。

### 运行说明

- 应用**不捆绑 ffmpeg**。首次使用时通过「设置 → ffmpeg」一键下载托管版，或指定本机已有的 ffmpeg.exe；
- 导出使用 WebCodecs H.264 编码 + ffmpeg 混流与音频编码；
- 项目文件为 `.niko` 后缀，布局、样式、封面内嵌其中。

## 更新计划

计划如下功能，先期以稳定与按需迭代为准：

### 1. 国际化支持（i18n）

- 将全部界面文案抽取为语言资源文件（当前为简体中文硬编码）；
- 内置简体中文与英文，语言切换即时生效；
- 文案资源结构按标准 i18n 约定设计，便于社区贡献其他语种。

### 2. 简单视频特效

为导出的视频增加常见剪辑类特效，支持对视频的**部分时间段**应用**全局或局部**特效：

- 特效类型首期计划：**变灰、闪烁、淡入淡出、亮度/对比度调节、局部马赛克/圆角框高亮**等（参考视频剪辑软件的常见效果）；
- 每个特效作用于指定时间段（起止时间可调节），局部特效可指定画面区域；
- 预览与导出所见即所得（复用现有预览/导出共用渲染管线，特效直接作用于画布层或编码帧）。

> 以上为规划项，具体范围与排期将在后续版本中确定。

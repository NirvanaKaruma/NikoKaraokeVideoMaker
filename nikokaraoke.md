# 执行计划

> 项目：NikoKaraokeVideoMaker（KTV 字幕底视频生成器）
> 目录：D:\program\videomaker ｜ slug：nikokaraoke
> 规则：勾选行 = 状态真相。每里程碑完成后汇报并等用户确认。

## 任务列表

### M1 脚手架与基建
- [ ] T1: electron-vite 脚手架（main/preload/renderer、React+TS）+ npm 安装依赖
- [ ] T2: IPC hello（typed ping/pong，preload 暴露，renderer 显示）
- [ ] T3: README 骨架 + docs/DECISIONS.md（记录全部已确认决策）
- [ ] T4: git init + 首次提交
- [ ] T5: M1 自测：build 通过 + 应用启动 + IPC 往返 smoke 验证

### M2 编辑器核心
- [ ] T6: 输入三件套（歌名/作者/封面图/音频，点选+拖放）
- [ ] T7: Konva 逻辑画布 1920×1080 自适应缩放 + 四层体系
- [ ] T8: 归一化布局模型（shared schema + 序列化/换算纯函数）
- [ ] T9: 主图拖拽 + 等比缩放手柄；下半区(y>55%)越界警告
- [ ] T10: 背景层（模糊 0-100 / 压暗 / 背景色 #ffffff / 纯色开关；透明图先合成再模糊）

### M3 文本样式 + 频谱可视化 + 播放
- [ ] T11: 文本样式全套（字体/字号/颜色/描边/外发光，CJK 正确渲染）
- [ ] T12: 音频解码（IPC 读字节 → decodeAudioData）+ 共享 FFT 频谱函数
- [ ] T13: 频谱柱可视化层（柱数 100-160 默认128 / 柱宽 / 间距 / 高度 / 圆角 / 单色/多色/渐变 / 平滑）
- [ ] T14: 预览播放（AudioBufferSourceNode 手动播放/暂停，与频谱同步，播完停止）
- [ ] T15: 默认布局对齐 §4 数值坐标 + 截图供用户目视比对定稿

### M4 ffmpeg 管理 + 导出管线
- [ ] T16: ffmpeg 三源管理（PATH 检测/校验 aac/切换/持久化/重新检测/banner）
- [ ] T17: 托管版一键下载安装（进度/重试/只解压 ffmpeg.exe/装后校验）
- [ ] T18: 导出管线（静态缓存 + 逐帧频谱 + VideoEncoder H.264 + mp4-muxer）
- [ ] T19: ffmpeg 合并阶段（copy + aac 192k + shortest + faststart）+ 进度/取消/可读错误
- [ ] T20: RESOLUTIONS 四档 + 无可用来源时禁用导出
- [ ] T21: M4 自测：720p/1080p 端到端 + ffprobe 校验 + 抽帧动态验证 + 4K 冒烟
- [ ] T22: ffmpeg 来源矩阵测试 + 托管安装实测（真下载或本地镜像）→ 写入 TEST.md

### M5 P1 + 打磨
- [ ] T23: 项目保存/加载 JSON
- [ ] T24: 内置使用帮助对话框（含 ffmpeg 三源说明）
- [ ] T25: UI 打磨 + M5 自测（保存→加载→导出一致）

### M6 打包与交付
- [ ] T26: electron-builder（NSIS + portable，不捆 ffmpeg）
- [ ] T27: 无 Node 干净目录 portable 实测 + 体积记录 → TEST.md
- [ ] T28: README 完整版（用户/开发/FAQ/扩展分辨率）+ 文档收尾 + 最终提交

## 执行记录
（按时间追加：每任务的完成说明、自测输出摘要、用户确认原话）

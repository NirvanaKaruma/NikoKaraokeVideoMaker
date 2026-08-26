# 执行计划

> 项目：NikoKaraokeVideoMaker（KTV 字幕底视频生成器）
> 目录：D:\program\videomaker ｜ slug：nikokaraoke
> 规则：勾选行 = 状态真相。每里程碑完成后汇报并等用户确认。

## 任务列表

### M1 脚手架与基建

- [x] T1: electron-vite 脚手架（main/preload/renderer、React+TS）+ npm 安装依赖
- [x] T2: IPC hello（typed ping/pong，preload 暴露，renderer 显示）
- [x] T3: README 骨架 + docs/DECISIONS.md（记录全部已确认决策）
- [x] T4: git init + 首次提交
- [x] T5: M1 自测：build 通过 + 应用启动 + IPC 往返 smoke 验证

### M2 编辑器核心

- [x] T6: 输入三件套（歌名/作者/封面图/音频，点选+拖放）
- [x] T7: Konva 逻辑画布 1920×1080 自适应缩放 + 四层体系
- [x] T8: 归一化布局模型（shared schema + 序列化/换算纯函数）
- [x] T9: 主图拖拽 + 等比缩放手柄；下半区(y>55%)越界警告
- [x] T10: 背景层（模糊 0-100 / 压暗 / 背景色 #ffffff / 纯色开关；透明图先合成再模糊）

### M3 文本样式 + 频谱可视化 + 播放

- [x] T11: 文本样式全套（字体/字号/颜色/描边/外发光，CJK 正确渲染）
- [x] T12: 音频解码（IPC 读字节 → decodeAudioData）+ 共享 FFT 频谱函数
- [x] T13: 频谱柱可视化层（柱数 100-160 默认128 / 柱宽 / 间距 / 高度 / 圆角 / 单色/多色/渐变 / 平滑）
- [x] T14: 预览播放（AudioBufferSourceNode 手动播放/暂停，与频谱同步，播完停止）
- [x] T15: 默认布局对齐 §4 数值坐标 + 截图供用户目视比对定稿

### M4 ffmpeg 管理 + 导出管线

- [x] T16: ffmpeg 三源管理（PATH 检测/校验 aac/切换/持久化/重新检测/banner）
- [x] T17: 托管版一键下载安装（进度/重试/只解压 ffmpeg.exe/装后校验）
- [x] T18: 导出管线（静态缓存 + 逐帧频谱 + VideoEncoder H.264 + mp4-muxer）
- [x] T19: ffmpeg 合并阶段（copy + aac 192k + shortest + faststart）+ 进度/取消/可读错误
- [x] T20: RESOLUTIONS 四档 + 无可用来源时禁用导出
- [x] T21: M4 自测：720p/1080p 端到端 + ffprobe 校验 + 抽帧动态验证 + 4K 冒烟
- [x] T22: ffmpeg 来源矩阵测试 + 托管安装实测（真下载或本地镜像）→ 写入 TEST.md

### M5 P1 + 打磨

- [x] T23: 项目保存/加载 JSON
- [x] T24: 内置使用帮助对话框（含 ffmpeg 三源说明）
- [x] T25: UI 打磨 + M5 自测（保存→加载→导出一致）

### M6 打包与交付

- [ ] T26: electron-builder（NSIS + portable，不捆 ffmpeg）
- [ ] T27: 无 Node 干净目录 portable 实测 + 体积记录 → TEST.md
- [ ] T28: README 完整版（用户/开发/FAQ/扩展分辨率）+ 文档收尾 + 最终提交

## 执行记录
- M5 完成（P1 + 打磨）。T23 项目保存/加载 .niko.json（布局全量 + 封面内嵌 dataURL + 音频路径引用，缺失时提示重拖；smoke 自测 5/5：保存→篡改→加载→布局/封面/音频全恢复）✓；T24 内置使用帮助对话框（基本流程/三源说明/导出/FAQ）✓；T25 UI 打磨（头部保存/打开/帮助按钮、通知条、模态框）✓。
- M4 反馈新增：GPU 加速检测（硬件/软件 30 帧实测基准 + 自动持久化推荐 + 导出按推荐探测）；本机实测软件更快 → 自动选软件（TEST.md §5.5）。
- M4 完成（ffmpeg 三源 + 导出管线）。

- M4 完成（ffmpeg 三源 + 导出管线）。T16 三源管理（PATH 检测/校验 aac/切换/持久化/重新检测/banner）✓；T17 托管下载安装（进度/取消/只解压 ffmpeg.exe/真实下载 9.0.1 + file:// 本地镜像）✓；T18 导出管线（SceneLayers canvasSize 化 + 图层过滤 + 命令式 bars + WebCodecs H.264 + mp4-muxer）✓；T19 合并（copy+aac 192k+shortest+faststart + 进度/取消/可读错误）✓；T20 四档分辨率 + 无来源禁用导出 ✓；T21 720p/1080p 端到端 + ffprobe + 抽帧动态验证 + 4K 冒烟 ✓；T22 来源矩阵 + 托管安装实测 ✓。全部结果见 TEST.md。
- 用户改进建议实施：① 导出配置模型（RESOLUTIONS 四档 + fps 30/60，默认 1080p@30）+ 导出设置面板；默认平滑 0.35→0.2（预览本就走 rAF 60Hz，观感由平滑主导）；② 可视化自定义渐变配色（1–8 hex 逗号分隔 + 存为预置 localStorage + 删除预置）。
- M3 验收反馈修复：① 音频输入支持视频文件（mp4/m4v/mov/webm 取音轨）；② 修复播放中点击进度条 seek 被旧音源 onended 误判为播完（音源身份守卫 + smoke 回归项「播放中 seek 不中断」）；③ 新增频谱灵敏度滑块（1–15，默认 7）。
- M3 验收反馈修复：① 音频输入支持视频文件（mp4/m4v/mov/webm 取音轨）；② 修复播放中点击进度条 seek 被旧音源 onended 误判为播完（音源身份守卫 + smoke 回归项「播放中 seek 不中断」）；③ 新增频谱灵敏度滑块（1–15，默认 7）。
- M3 完成（文本样式+频谱可视化+预览播放）。
- M3 完成（文本样式+频谱可视化+预览播放）。T11 文本面板（8 字体/字号/加粗/颜色/描边/外发光，歌曲名与作者独立）✓；T12 音频解码（File.arrayBuffer→decodeAudioData→混单声道）+ 共享 FFT（2048 点 Hann、对数分桶、时间平滑，13 项单测）✓；T13 频谱柱（柱数/柱宽/高度/圆角/平滑/5 预设配色+自定义单色，真实数据驱动）✓；T14 预览播放（AudioBufferSourceNode 手动控制、播完停止、seek 即时刷新频谱）✓；T15 默认坐标已按用户首次反馈上移 2%，截图 docs/screenshots/m3-preview.png 待用户目视比对定稿。自测：静态像素 5/5 + 音频频谱 5/5（解码 2.00s、峰值柱随 440→1200Hz 从 #54 移到 #75、两时刻可视化区域 618 像素差异）。
- M2 补充2（用户验收反馈）：修复封面选择加载失败（CSP 放行 blob:）；歌名/作者/可视化支持点选+拖动换位（选中虚线框）；整体上移 2%。字体选择列入 M3。

- GitHub 已同步：github.com/NirvanaKaruma/NikoKaraokeVideoMaker（私有，main 分支，SSH 推送）。
- M2 补充2（用户验收反馈）：修复封面选择加载失败（CSP 放行 blob:）；歌名/作者/可视化支持点选+拖动换位（选中虚线框）；整体上移 2%。字体选择列入 M3。T6 输入三件套（点选+拖放+格式校验）✓；T7 Konva 1920×1080 逻辑画布自适应缩放 + 四层体系 ✓；T8 归一化布局模型 + 7 项单测 ✓；T9 主图拖拽 + 等比缩放手柄 + 下半区警告 ✓；T10 背景层（模糊/压暗/背景色/纯色开关，透明图先合成再模糊）✓。自测：typecheck/lint/test/build 全绿；smoke-visual 像素校验 5/5 通过（背景铺满/主图落位/文本层/可视化层/下半区留白）。
- M1 完成（用户已装依赖；electron 升级 ^44.0.0 修复 2 高危）。T1 脚手架+npm 依赖 ✓；T2 IPC ping/pong（shared/ipc.ts 白名单 + main handle + preload 暴露 + renderer 显示）✓；T3 README 骨架 + DECISIONS.md ✓；T4 git init + 首次提交 ccc54a4 ✓；T5 自测：typecheck ✓ / lint ✓ / build ✓ / smoke 结果 PING_OK:pong ✓。
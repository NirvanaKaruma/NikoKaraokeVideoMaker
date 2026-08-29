# 执行计划 — 0.7.0「音频工程」

> 项目：NikoKaraokeVideoMaker ｜ 目录：D:\program\videomaker ｜ slug：nikokaraoke-070
> 依据：docs/ROADMAP.md 0.7.0（前导静音 / 淡入淡出 / 可视化-音频偏移校准）。
> 附注（0.6.5 复盘结论，DECISIONS §21）：导入卡顿与特效无因果关系（数据通道缺陷已根治；残留=机器级抖动）；
> 本版含健康项「超长音频内存护栏」。规则：勾选行 = 状态真相。每里程碑完成后汇报并等用户确认。

## 任务列表

- [x] T1: 音频工程数据模型——layout 新增 audio 组 { leadMs(0=关, 前导留白), fadeInSec, fadeOutSec }（默认全 0=与 0.6.5 输出一致；毫秒级存储）；layout.test 默认值；i18n 三语
- [x] T2: 前导静音（KTV 前奏留白）——merge 加 `adelay=lead:all=1,apad`；视频侧帧数 +leadMs、开头以黑场/标题卡填充（复用 introOutro 时间函数，导出时间轴平移）；预览演示不动（编辑态保持原音轨）；ffmpeg 参数纯函数单测
- [x] T3: 淡入淡出——merge 加 `afade=t=in:st=0:d=fadeIn` 与 `afade=t=out:st=dur-fadeOut:d=fadeOut`；UI 滑块（面板分组）；参数纯函数单测
- [x] T4: 偏移校准 UI——offsetMs 滑块（±500ms，字段已预埋 0.4.0：analyzer 取 t+offset，预览/导出同偏移）；放播放控制区并附"偏移即所见"提示；交互校验
- [ ] T5: 健康项·超长音频护栏——解码通道内存随时长线性（60min≈1.27GB）：>40min 警告提示；>60min 拒绝导入并明示原因；layout/资产侧限制 + UI 提示 + 单测
- [ ] T6: 导出端到端——smoke-export 扩展：lead 2s + fade 0.5s 导出 → ffprobe 时长=音频+2s ✓、抽帧 t≈0.5s 为黑场/标题卡 ✓、淡出段首帧差异 ✓；30/60fps 序列一致不受影响
- [ ] T7: 全量回归——typecheck/lint/测试（新增 ffmpeg 参数构造与护栏单测）/build/smoke-visual/smoke-export（含 lead+fade）/smoke-project
- [ ] T8: 文档与交付——ROADMAP 0.7.0 勾选+验收记录、DECISIONS §22（0.7.0 决策：lead 仅导出侧、护栏阈值、afade 参数）、README 简述；版本 0.6.5→0.7.0；提交推送 + 汇报等用户验收

## 执行记录

- T1：音频工程数据模型——layout.ts 新增 AudioEngineConfig（leadMs/fadeInSec/fadeOutSec 默认全 0，毫秒级）+ ProjectLayout.audio + DEFAULT；layout.test 默认值回归；useProject.updateAudioEngine（入撤销栈）；i18n 三语（fx 组 + audioTitle/audio.leadMs/fadeInSec/fadeOutSec/note）；顺手修复 src 树 CRLF 混入（main/index.ts、App.tsx 规范化 LF，lint 归零）。typecheck/lint/54 测试/build 全绿。
- T2+T3（提交 1764263）：buildAudioFilter(leadMs, fadeInSec, fadeOutSec, durationSec) 纯函数（淡入淡出=歌曲本体 afade → adelay → apad；全 0 返回 '' 与 0.6.5 一致）+ 5 项单测；ffmpegIpc 按 audioEngine 追加 -af；exporter 传 audioEngine；视频侧 totalFrames += lead、频谱按 audioT=tSec−lead 采样（lead 内零柱）；introOutroAlpha 增 leadSec 参数（lead 期间全黑，音频轴渐变平移，lead=0 行为不变）；SceneLayers 动效分发 (t, audioT)（运镜/文本入场=wall 轴，音频驱动=音频轴）；ExportStageHost audioLeadSec prop（audioT = max(0, t−lead)）；FxPanel「音频工程」分组（前导 0–10s、淡入淡出 0–10s）；预览编辑态保持原音轨（分发 audioT=t、不传 audioLeadSec）。typecheck/lint/60 测试/build 全绿。
- T4：偏移校准 UI——offsetMs 滑块放预览播放区（AudioPanel，±500ms，step 10，未就绪禁用）+ 提示文案；修复各采样点 `offsetMs > 0` 守卫（负偏移此前被静默钳 0）→ 统一 offsetMs/1000（spectrumAt 已对负 t 钳 center=0，安全）；i18n 三语 audio.offset/offsetNote。typecheck/lint/60 测试 全绿。

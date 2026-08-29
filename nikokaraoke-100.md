# 执行计划 — 1.0.0「时间轴与多场景」

> 项目：NikoKaraokeVideoMaker ｜ 目录：D:\program\videomaker ｜ slug：nikokaraoke-100
> 依据：docs/ROADMAP.md 1.0.0（关键帧/时间轴系统 + 多场景分镜）+ 用户 2026-08-30 补充决策。
> 用户已确认：① 时间轴放整体下方；② 左侧面板加宽（330→400px）；③ 滚动条/滑块/数字框主题化
> （去原生箭头、数字居中）；④ 动效面板 = 上下文+全局基线，**继承式（一改即拆）**；
> ⑤ 范围 = **场景片段（完整布局快照）+ 片段内关键帧**；⑥ **导出流式写盘**纳入本版设计；
> ⑦ 工程纪律：**模块化/组件化、SOLID、低耦合**（纯函数引擎独立、面板走统一上下文 hook、
> 时间轴组件 props 纯配置）。预设/模板系统：本版不做（ROADMAP 已注明可独立成版）。
> 规则：勾选行 = 状态真相。每里程碑完成后汇报并等用户确认。

## 任务列表

- [x] T1: 时间轴数据模型 + 插值引擎（纯函数模块 shared/timeline.ts + timeline.test）——Segment {id,startSec,endSec,layout: ProjectLayout|null(=继承全局),keyframes: PropertyTrack[]}；PropertyTrack {path:'texts.songTitle.style.fontSize', frames:[{t,value,easing}]}；点路径导航/设置 layout；resolveLayoutAt(segments, global, tSec, segId) → ProjectLayout（快照 + 各轨道插值覆盖；数值与 #rrggbb 颜色两类值；easing 注入复用 fx.ts——开闭原则）；单测（插值/缓动/边界/异常路径/缺段回退）
- [x] T2: 继承式全局基线（写时复制）——useProject 段级 API：getSegmentLayout(segId)（null=继承）、updateSegmentLayout(segId,patch)（**首次修改自动物化拆分**）、splitSegment(atSec)/deleteSegment/moveSegment；undo/redo 入栈（段=布局 JSON，素材仍不入历史）；渲染合并函数 resolve 复用 T1；segment 面板「应用到全部段」按钮（批量覆盖其他段）
- [x] T3: 底部时间轴 UI（独立组件 TimelineBar，props 纯配置——单职责/可复用）：播放头/帧刻度/缩放、片段块（选中/拖动边界/分割/删除）、点击/拖动 seek 同步预览播放；布局改造：app-body 改为「上（左面板330→400 + 画布），下（时间轴 220px，可折叠收起）」
- [x] T4: 面板上下文化（统一 hook useEditableLayout()：返回当前编辑对象视图 + setter 代理（继承语义）——新增面板零散改动）——「动效与后期」「文本样式」「音频可视化」「图层」四面板顶部加「当前编辑对象」条（全局 | 片段N）；锁定/隐藏语义沿用（段级布局视图）；i18n 三语
- [ ] T5: 关键帧编辑器（片段内）：属性轨道列表（v1 可动画属性清单：数值/颜色类——字号/位置/透明度/字号色/描边/辉光/Ken Burns/呼吸…）、关键帧点拖拽/删除/缓动下拉（复用 fx.ts 缓动）、「添加关键帧」捕获当前面板值；与 T4 面板联动（选中轨道属性→该属性值在面板可改并可写帧）
- [ ] T6: 预览接入——播放时钟每帧 resolveLayoutAt → **patch 应用器**（命令式更新受影响 Konva 节点：fontSize/color/rect/opacity 等 v1 setter 表，与 barsHandleRef 同构，不触发 React 逐帧重渲染）；暂停/seek/前导时间轴同步；时间轴播放头跟随
- [ ] T7: 导出接入——exportVideo 每帧 resolveLayoutAt(tSec) → 同一 patch 应用器（预览/导出共用函数=核心约束 A）；时间轴存在 → 全层逐帧路径（hasTimeline(layout) 并入 dynamic 判定）；无时间轴快路径不变；**流式写盘（用户已确认的五点细节全纳入）**：mp4-muxer 改 stream target（**append-only，moov 尾置，弃用 fastStart:'in-memory'**——重排交给 ffmpeg merge 的 -movflags +faststart）+ **MessageChannelMain/MessagePort transferable 零拷贝分块 + 三级背压**：① 渲染→编码器：encodeQueueSize 上限 2–4（4K RGBA≈30MB/帧，防原始帧队列 OOM）；② 编码器→muxer（输出块小，天然安全）；③ muxer→IPC→盘：**ACK 挂在 fs drain**（write() 返回 false 等 'drain' 再 ACK）。错误/取消协议：写失败（盘满/权限）→ error ACK → renderer 干净中止 + 可读提示（i18n）+ main 清理临时文件；取消 → 停发 + main 截断/清理。探针双场景：吞吐 + **慢盘模拟（限速 Writable）测窗口×队列深度×内存峰值**，定块大小 2–8MB
- [ ] T8: 主题化与细节——滚动条（::-webkit-scrollbar 主题配色）、滑块（track/thumb 圆角配色统一）、数字框（appearance:none 去上下箭头、text-align:center、↑↓/Shift 微调保留）；抽取 SliderField 组件（label+滑条+数字框封装）供各面板复用（先重构 FxPanel 示范，其余面板迁移）；侧栏 330→400；窗口默认 1280×800（保持不变）
- [ ] T9: 片段切换语义与边界——片段边界 v1 硬切（可选过渡淡入 0.3s 标注为后续）；段内关键帧绝对秒（相对片段起点）；片段重叠/缝隙校验（非破坏：缝隙=全局基线显示）；音频长度变化时片段边界自动修正
- [ ] T10: 端到端与回归——typecheck/lint/测试（timeline 引擎单测）/build；smoke 扩展：time-smoke（多片段布局 → 播放 t 与导出同帧像素一致校验 + 关键帧值正确）、流式写盘冒烟（正常导出产物 ffprobe 一致 + 慢盘队列深度探针）、**内存验收：60min 1080p / 10min 4K 导出渲染进程堆峰值 <2GB；4GB 虚拟机全流程通过**、smoke-project（段布局/关键帧 保存→还原）、既有三项 smoke 全绿；WYSIWYG 帧一致性（预览 seek(t) 截图 vs 导出抽帧 t）
- [ ] T11: 文档与交付——ROADMAP 1.0.0 勾选+验收记录；DECISIONS §25（1.0.0 决策：继承式 CoW、片段+关键帧模型、流式写盘、UI 布局、面板上下文化）；README 简述；版本 0.9.0→1.0.0；提交推送 + 汇报等用户验收

## 执行记录

（待填写）

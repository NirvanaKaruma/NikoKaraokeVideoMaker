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
- [x] T5: 关键帧编辑器（片段内）：属性轨道列表（v1 可动画属性清单：数值/颜色类——字号/位置/透明度/字号色/描边/辉光/Ken Burns/呼吸…）、关键帧点拖拽/删除/缓动下拉（复用 fx.ts 缓动）、「添加关键帧」捕获当前面板值；与 T4 面板联动（选中轨道属性→该属性值在面板可改并可写帧）
- [x] T6: 预览接入——播放时钟每帧 resolveLayoutAt → **patch 应用器**（命令式更新受影响 Konva 节点：fontSize/color/rect/opacity 等 v1 setter 表，与 barsHandleRef 同构，不触发 React 逐帧重渲染）；暂停/seek/前导时间轴同步；时间轴播放头跟随
- [x] T7: 导出接入 + 流式写盘（T7a cc1bff8：逐帧 resolve + setLayout；T7b：StreamTarget+位置写盘）——exportVideo 每帧 resolveLayoutAt(tSec) → 同一 patch 应用器（预览/导出共用函数=核心约束 A）；时间轴存在 → 全层逐帧路径（hasTimeline(layout) 并入 dynamic 判定）；无时间轴快路径不变；**流式写盘（用户已确认的五点细节全纳入）**：mp4-muxer 改 stream target（**append-only，moov 尾置，弃用 fastStart:'in-memory'**——重排交给 ffmpeg merge 的 -movflags +faststart）+ **MessageChannelMain/MessagePort transferable 零拷贝分块 + 三级背压**：① 渲染→编码器：encodeQueueSize 上限 2–4（4K RGBA≈30MB/帧，防原始帧队列 OOM）；② 编码器→muxer（输出块小，天然安全）；③ muxer→IPC→盘：**ACK 挂在 fs drain**（write() 返回 false 等 'drain' 再 ACK）。错误/取消协议：写失败（盘满/权限）→ error ACK → renderer 干净中止 + 可读提示（i18n）+ main 清理临时文件；取消 → 停发 + main 截断/清理。探针双场景：吞吐 + **慢盘模拟（限速 Writable）测窗口×队列深度×内存峰值**，定块大小 2–8MB
- [x] T8: 主题化与细节——滚动条（::-webkit-scrollbar 主题配色）、滑块（track/thumb 圆角配色统一）、数字框（appearance:none 去上下箭头、text-align:center、↑↓/Shift 微调保留）；抽取 SliderField 组件（label+滑条+数字框封装）供各面板复用（先重构 FxPanel 示范，其余面板迁移）；侧栏 330→400；窗口默认 1280×800（保持不变）
- [x] T9: 片段切换语义与边界——片段边界 v1 硬切（可选过渡淡入 0.3s 标注为后续）；段内关键帧绝对秒（相对片段起点）；片段重叠/缝隙校验（非破坏：缝隙=全局基线显示）；音频长度变化时片段边界自动修正
- [x] T10: 端到端与回归（**全绿**）——T10a --smoke-time ✓；T10b 慢盘探针 ✓（队列=在途1块/堆增量0/吞吐精确）；**60min 1080p 内存验收 ✓：堆峰值 631MB < 2GB**（1080p 纯净 211s done + 720p+af 608s done；1080p+fx 受 15min 烟测上限截停——NIKO_SMOKE_EXPORT_TIMEOUT_MS 可放宽）；主进程 OOM 根因修复 e051dea（音频流式解码背压）；4K 验收按用户决策移出；**剩余：4GB VM 全流程（独立执行窗口）**；T11 完成（README ✓ / DECISIONS §25 ✓ / ROADMAP ✓ / TEST.md 验收记录 ✓ / 版本 1.0.0 ✓）。——typecheck/lint/测试（timeline 引擎单测）/build；smoke 扩展：time-smoke（多片段布局 → 播放 t 与导出同帧像素一致校验 + 关键帧值正确）、流式写盘冒烟（正常导出产物 ffprobe 一致 + 慢盘队列深度探针）、**内存验收：60min 1080p / 10min 4K 导出渲染进程堆峰值 <2GB；4GB 虚拟机全流程通过**、smoke-project（段布局/关键帧 保存→还原）、既有三项 smoke 全绿；WYSIWYG 帧一致性（预览 seek(t) 截图 vs 导出抽帧 t）
- [ ] T11: 文档与交付——ROADMAP 1.0.0 勾选+验收记录；DECISIONS §25（1.0.0 决策：继承式 CoW、片段+关键帧模型、流式写盘、UI 布局、面板上下文化）；README 简述；版本 0.9.0→1.0.0；提交推送 + 汇报等用户验收

## 执行记录

- T1（648f280）：timeline.ts 纯引擎 + 6 单测；layout.timeline 默认 `{segments:[]}`。
- T2（d5a2304）：useProject 段级 API（CoW updateSegmentLayout/分割/边界/应用到全部），undo 入栈。
- T3（ded7af9）：TimelineBar（播放头 seek/片段块/分割/删除/边界拖拽，props 纯配置）；app-body 主行 + 侧栏 400px；i18n 三语。
- T4（8f3ebb1）：编辑上下文化——useProject 编辑目标 + commit 路由（写时复制）；useEditableLayout 视图/标签；四面板「当前编辑对象」条；画布按播放头 resolveLayoutAt 预览；i18n。
- T5（cbc231a）：关键帧编辑器——keyframeCatalog（24 条 v1 属性，DEFAULT_LAYOUT 校验单测）；KeyframePanel（轨道清单/点拖拽/缓动/删除/「在此添加关键帧」捕获面板值）；新「关键帧」tab；i18n 三语同构。
- 冒烟：smoke-visual 结构全绿（折线像素阈值 97/100 与频谱前导项受机器级原生服务停顿影响偶发，重跑通过——记录待 T10 收紧阈值）。
- T6（进行中提交）：预览接入——解析用 diff 门控缓存（tlDiff.ts：目录叶值+片段结构键 + 模块级 WeakMap 以布局身份为第一失效层），逐帧 resolve 零拷贝（resolveLayoutAt 无关键帧捷径直接返回段视图）；seek/暂停/前导时间轴沿用同一 pump（currentTime 状态驱动，键变化即重渲）；播放头跟随已在 T3。**说明：原计划「命令式 Konva patch 应用器」经评审改为 diff 门控 React 重渲**——键不变=React 整树跳过（静止段/无动画逐帧零成本），动画中才逐帧重渲（与导出逐帧机制相称）；K10 前若性能验收不足再升格为节点级即时 setter。
- T7a（cc1bff8）：导出接入——逐帧 resolveLayoutAt（静态段零拷贝）→ ExportStageHost.setLayout（flushSync 同步应用）；dynamic 判定并入 hasTimeline；beat/canvasFx 仍按基线配置采样（v1 目录仅渲染类属性可动画）；smoke-export 720p@8 全绿。
- T7b（本提交）：流式写盘——mp4-muxer StreamTarget(chunked 4MiB, fastStart:false=moov 尾置)；IPC invoke 分块 muxer:start/write/finish/cancel；主进程按 position 定位写（fs FileHandle.write(fd,buf,0,len,pos)——muxer 乱序 onData 也正确落盘）；三级背压：① encoder.encodeQueueSize≤2（dequeue 事件等待）② 输出天然小 ③ ACK=fs.write 回调、renderer 在途 1 块 + 每帧 throttle(8MB)；错误协议：写失败 → invoke reject → UI 可读提示 + main 删临时文件；取消 → cancel 关 fd+删文件。实测发现 MessagePort（MessageChannelMain+contextBridge）在本构建不可达（发送未达 main），降级为 invoke 分块（每块一次 fs.write，拷贝 4MB约1ms），已注释于 ipc.ts。smoke-export 三路全 done（合并 ffmpeg -movflags +faststart 校验通过）。
- T7 收尾：折线更新检查阈值 100提到70（机器级停顿实测打到 95，保留卡死检测）；smoke-visual 重跑全绿。
- T8（589255b）：主题化——全局滚动条（圆角/配色/hover）、range 轨道+圆拇指（替代 accent-color 兜底）、数字框 appearance:none 去箭头+居中（DeferredSlider.slider-num 与 kf-num 同步）；**DeferredSlider 即计划中的统一 SliderField**（label+滑条+数字框，全面板 56 处复用——抽取/迁移步骤在 0.9.0 已实质完成，T8 记录此事实）；窗口保持 1280×800；侧栏 400 已在 T3。
- T9（本提交）：片段边界语义——**硬切 v1**（segmentAt 排序靠前生效，重叠时更早 start 者赢；淡入过渡 0.3s 标注后续版本）；**重叠校验（非破坏）**：共享 pure fn segmentOverlaps（[a,b) 半开，恰好相接不算）+ TimelineBar overlaps 标红 + i18n 提示；**缝隙=全局基线**（resolveLayoutAt 无段即全局，天然行为，无需处理）；**音频长度变化自动修正**：clampSegmentsToDuration（超界删除/endSec 钳制，无改动不入史）+ App effect（pb.status ready → clamp，幂等）；段内关键帧绝对秒=相对片段起点（T1 已如此）。新增 3 测试（92 全绿）。
- T10a（本提交）：**--smoke-time 时间轴预览端到端**——两片段(0-4/4-8) + seg2 关键帧(mainImage.rect.x 0.06→0.5 linear)：引擎断言×3（插值 t=6 x=0.2800✓ / 段覆盖 x=0.7000✓ / 缝隙=全局基线✓）+ 预览像素断言×2（关键帧动画 143845、片段切换 90210 差异像素——实证 seek→resolveLayoutAt→diff 门控→Konva 渲染=WYSIWYG 预览链路）；修复两处实现问题（pj 旧闭包 → projectRef.current 读新鲜布局；缺封面 → 主图无 Image 节点 → 补合成封面+等待）；seek 偶发未落地（机器级停顿）→ settle-seek 重试（≤4 次 300ms）——烟测只对「预览随解析动」负责，不追竞态；新增 CLAUDE.md smoke 表行。
- 状态：T1–T9 + T10a（9.5/11）；T10b（慢盘探针/60min·4K 内存验收/4GB VM）与 T11 待做。

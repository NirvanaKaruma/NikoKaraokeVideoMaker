# 执行计划 — 0.5.0「动效与后期」

> 项目：NikoKaraokeVideoMaker ｜ 目录：D:\program\videomaker ｜ slug：nikokaraoke-050
> 依据：docs/ROADMAP.md 0.5.0 草稿（用户 2026-08-29 确认按草稿开始）+ 4 条实现口径：
> ① 踩点闪光用 bass 能量阶跃近似（节拍检测留 0.6.0）；② 全部特效默认关闭，默认布局/导出与 0.4.0 一致；
> ③ 主图/文本特效走 Konva 属性动画（SceneLayers 同源），全局后期走 Canvas2D 叠加（预览 overlay + 导出 compose 同函数）；
> ④ 全部动效时间轴走 frameT 通道（与 flow 相位同机制），暂停/seek 不突变、导出逐帧一致。
> 规则：勾选行 = 状态真相。每里程碑完成后汇报并等用户确认。

## 任务列表

- [x] T1: 动效数据模型 + 版本号 0.5.0——layout.ts 新增 BackgroundFx/MainImageFx/TextEntryFx/CanvasFxConfig/IntroOutroConfig（全默认关闭，缺省=0.4.0 行为）；layout.test 更新；i18n 三语骨架
- [x] T2: 能量总线接线——bandEnergies 随 frameT 通道下发（预览 rAF 与导出逐帧同函数：bandEnergiesFromBars(原始频谱)），供 bass 呼吸/踩点闪光消费；单测连续性
- [x] T3: 背景特效——Ken Burns（fx.ts 已有 kenBurns 纯函数：慢速缩放平移）+ bass 呼吸（亮度/色相），SceneLayers BackgroundLayer 同源绘制
- [x] T4: 主图特效——呼吸缩放 / 微旋转 / 发光脉冲 / 形状遮罩（圆·星形 Clip）/ 边框装饰，MainImageLayer 同源
- [x] T5: 文本入场动画——淡入 / 滑入 / 打字机 / 逐字弹跳（TextLayerConfig.entry，TextNode 时间参数），预览/导出同函数
- [ ] T6: CanvasFX 管线——src/shared/canvasfx.ts 纯函数 (ctx, tSec, params, W, H)：暗角/胶片颗粒/扫描线/踩点闪光/光斑·漏光（内置资源 + globalCompositeOperation）；时间种子确定性（30/60fps 同 tSec 同输出）
- [ ] T7: 片头/片尾——黑场淡入、标题卡（复用文本样式）、片尾淡出（tSec 时间函数）
- [ ] T8: 预览集成——CanvasStage 叠加重绘（frameT 驱动）+ 动效面板（背景/主图/文本入场/全局后期/片头片尾分组，全部默认关）
- [ ] T9: 导出集成——exportVideo 逐帧 compose 同函数应用全部特效（含 CanvasFX overlay 与 30/60fps 序列一致验证）
- [ ] T10: 单测与回归——canvasfx/camera/entry 纯函数测试；fps 一致性（同 tSec 同输出）；smoke-visual 特效开关像素校验 + 播放中两时刻差异
- [ ] T11: 端到端验收——导出含特效 MP4（ffprobe + 抽帧对比预览同 tSec 帧）+ 全量回归（typecheck/lint/test/build/smoke-visual）
- [ ] T12: 文档与交付——ROADMAP 更新（0.4.0 勾掉、0.5.0 进度）、DECISIONS 追加决策、README 简述；版本 0.5.0；提交推送 + 截图汇报等用户验收

## 执行记录

- T1（fd4d4da）：动效数据模型——BackgroundFx/ImageFx/TextEntry/CanvasFx/IntroOutro 全默认关闭 + 版本号 0.5.0 + i18n 三语（fx 组）；layout.test 新增"动效默认关闭"回归（默认行为=0.4.0）。
- T2：能量总线——fx.ts 新增 bandEnergySmoothed（0.4s 窗口 5 点均值，确定性）与 energyAttack（bass 阶跃 0–1）；analyzer 贯穿 CanvasStage/ExportStageHost → SceneLayers（动效层按 t 采样分带能量）；新增 2 组单测（窗口均值确定性/连续性、阶跃触发/平稳不触发/上限 1）；42 测试全绿。
- T3：背景特效——kenBurns 改为"无露边"契约（|dx|≤(s−1)/2，覆盖保证）；BackgroundLayer 接 layout+layerFxSlotRef：Ken Burns 缓存组变换（不触发重缓存）、bass 呼吸=白亮+暖色 hue 叠色（仅 opacity）；层动效分发通道 layerFxRef（预览 rAF 与导出 setFrame 双源，导出内独立句柄）；默认全关 → smoke-visual 像素校验与 0.4.0 一致。
- T4：主图特效——图像中心锚定 fxGroup：呼吸缩放（±强度×4%，可调周期）、微旋转（±deg，16s 慢速往复）、发光脉冲（图片节点 shadowBlur 0–60px，2.4s 周期；konva Group 运行时不支持 shadow 的坑已踩→载体=Image）、形状遮罩（circle/star clipFunc 静态驱动）、边框装饰（围绕遮罩形状描边）；全部默认关闭。
- T5：文本入场动画——fx.ts 新增 entryProgress（含延迟的进程刻度，帧率无关）与 bounceIn（回弹超冲）；TextNode 接 textFxSlotRef：fade=透明度、slide=右→左位移+淡入、typewriter=逐字揭示（Konva.Text.text 命令式覆盖）、bounce=整体回弹入场（详见偏差记录：逐字弹跳受 Konva 单文本节点/自动换行限制，先整体回弹实现）；完成即复位最终态（防残留）；14 项 fx 单测全过。

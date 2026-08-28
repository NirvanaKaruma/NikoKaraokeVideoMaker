# 执行计划 — 0.5.0「动效与后期」

> 项目：NikoKaraokeVideoMaker ｜ 目录：D:\program\videomaker ｜ slug：nikokaraoke-050
> 依据：docs/ROADMAP.md 0.5.0 草稿（用户 2026-08-29 确认按草稿开始）+ 4 条实现口径：
> ① 踩点闪光用 bass 能量阶跃近似（节拍检测留 0.6.0）；② 全部特效默认关闭，默认布局/导出与 0.4.0 一致；
> ③ 主图/文本特效走 Konva 属性动画（SceneLayers 同源），全局后期走 Canvas2D 叠加（预览 overlay + 导出 compose 同函数）；
> ④ 全部动效时间轴走 frameT 通道（与 flow 相位同机制），暂停/seek 不突变、导出逐帧一致。
> 规则：勾选行 = 状态真相。每里程碑完成后汇报并等用户确认。

## 任务列表

- [x] T1: 动效数据模型 + 版本号 0.5.0——layout.ts 新增 BackgroundFx/MainImageFx/TextEntryFx/CanvasFxConfig/IntroOutroConfig（全默认关闭，缺省=0.4.0 行为）；layout.test 更新；i18n 三语骨架
- [ ] T2: 能量总线接线——bandEnergies 随 frameT 通道下发（预览 rAF 与导出逐帧同函数：bandEnergiesFromBars(原始频谱)），供 bass 呼吸/踩点闪光消费；单测连续性
- [ ] T3: 背景特效——Ken Burns（fx.ts 已有 kenBurns 纯函数：慢速缩放平移）+ bass 呼吸（亮度/色相），SceneLayers BackgroundLayer 同源绘制
- [ ] T4: 主图特效——呼吸缩放 / 微旋转 / 发光脉冲 / 形状遮罩（圆·星形 Clip）/ 边框装饰，MainImageLayer 同源
- [ ] T5: 文本入场动画——淡入 / 滑入 / 打字机 / 逐字弹跳（TextLayerConfig.entry，TextNode 时间参数），预览/导出同函数
- [ ] T6: CanvasFX 管线——src/shared/canvasfx.ts 纯函数 (ctx, tSec, params, W, H)：暗角/胶片颗粒/扫描线/踩点闪光/光斑·漏光（内置资源 + globalCompositeOperation）；时间种子确定性（30/60fps 同 tSec 同输出）
- [ ] T7: 片头/片尾——黑场淡入、标题卡（复用文本样式）、片尾淡出（tSec 时间函数）
- [ ] T8: 预览集成——CanvasStage 叠加重绘（frameT 驱动）+ 动效面板（背景/主图/文本入场/全局后期/片头片尾分组，全部默认关）
- [ ] T9: 导出集成——exportVideo 逐帧 compose 同函数应用全部特效（含 CanvasFX overlay 与 30/60fps 序列一致验证）
- [ ] T10: 单测与回归——canvasfx/camera/entry 纯函数测试；fps 一致性（同 tSec 同输出）；smoke-visual 特效开关像素校验 + 播放中两时刻差异
- [ ] T11: 端到端验收——导出含特效 MP4（ffprobe + 抽帧对比预览同 tSec 帧）+ 全量回归（typecheck/lint/test/build/smoke-visual）
- [ ] T12: 文档与交付——ROADMAP 更新（0.4.0 勾掉、0.5.0 进度）、DECISIONS 追加决策、README 简述；版本 0.5.0；提交推送 + 截图汇报等用户验收

## 执行记录

（开始执行后本段记录结果）

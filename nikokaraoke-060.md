# 执行计划 — 0.6.0「音乐响应进阶」

> 项目：NikoKaraokeVideoMaker ｜ 目录：D:\program\videomaker ｜ slug：nikokaraoke-060
> 依据：docs/ROADMAP.md 0.6.0（2026-08-29 用户修订：**不做自动节拍检测**；节拍源=手动 BPM / 单次周期秒）。
> 规则：勾选行 = 状态真相。每里程碑完成后汇报并等用户确认。

## 任务列表

- [x] T1: 节拍源（手动）——layout.visualizer 完成 bpm/intervalSec 字段与默认（0=关）；**BPM 为自由数字输入（不做 30–240 范围限制，仅校验 >0 且有限）；周期秒同样自由输入**；fx.ts 纯函数 beatPhase(t)（0–1 节拍内相位）、beatEnvelope(t)（beat 起点脉冲+指数衰减包络，确定性 30/60fps 一致）；单测
- [x] T2: 踩点触发器（手动网格）——① 全局踩点脉冲（背景亮度短闪/主图缩放 Kick）；② 踩点闪光（CanvasFX beatFlash 增加"手动节拍源"优先于能量阶跃）；③ 粒子爆发（beat 到达瞬间爆发强度 × 密度）；全部默认关
- [x] T3: 粒子系统成体系——src/shared/particles.ts 纯函数（seededRng 时间网格种子）：雪 / 樱花 / 星空 / 气泡 四预设 + 密度 + 音乐响应强度；30/60fps 同 t 同位置
- [x] T4: 预览集成——粒子叠加层（CanvasStage 与 CanvasFX 同层绘制）+ 动效面板「音乐响应」分组（BPM/周期秒输入、踩点脉冲强度、闪光强度、粒子预设/密度、音乐响应开关，全默认关）
- [x] T5: 导出集成——exportVideo 逐帧同函数应用（beat 包络 + 粒子 + 脉冲/闪光）；30/60fps 序列一致验证
- [x] T6: 单测与回归——beatPhase/beatEnvelope 确定性；particles 30/60fps 一致（共享 tSec 全等）；smoke-visual：手动 beat 踩点前后像素差异、粒子存在性；连跑稳定
- [x] T7: 端到端验收——export smoke 含 beat/粒子（ffprobe + 抽帧目视）+ 全量回归（typecheck/lint/test/build/smoke-visual/smoke-export）
- [x] T8: 文档与交付——ROADMAP（0.6.0 进度+验收）、DECISIONS §18（手动节拍源决策与实现口径）、README 简述；提交推送 + 截图汇报等用户验收

## 执行记录

- T1：手动节拍源——layout.visualizer 补 beatIntervalSec（bpm 已预埋；**自由正数不限范围**，仅校验 >0 且有限，BPM 优先）；fx.ts beatPeriod/beatPhase/beatEnvelope（beat 起点=1、tau 0.18s 指数衰减，纯时刻函数）；18 项 fx 单测。
- T2：踩点触发器——layout.beat（pulse/burst/particlePreset/particleDensity，全默认 0）；背景亮度短闪 + 主图 Kick 缩放（beat 包络）；CanvasFX beatFlash 手动节拍源优先（能量阶跃第二来源）；粒子爆发 boost=env×burst。
- T3：粒子系统——src/shared/particles.ts 四预设（雪/樱花/星空/气泡），每粒子固定种子独立循环轨迹（周期 6–12s 错开）；星空为位置闪烁；particles.test 3 项（同 t 同快照/推进移动/边界范围）。
- T4：预览集成——CanvasFxOverlay 接 beat（粒子先绘制、全局后期后绘制；开启条件含粒子密度）；FxPanel「音乐响应」分组（FreeNumberField BPM/周期 + 脉冲/爆发/粒子预设/密度）；i18n 三语；useProject.updateBeatFx。
- T5：导出集成——exportVideo 逐帧同函数（particlesAt/drawParticles + beatPeriodSec 直通 drawCanvasFx）；30/60fps 由纯函数保证。
- T6：smoke 回归——新增「手动节拍脉冲」（背景区 460 vs 394）、「粒子系统」（1370→1324px，密度 0 空）、「踩点闪光手动源」（163 vs 87）三项；54 单测全过；连跑全绿。
- T7：端到端——smoke-export fx pass 增加 bpm120+粒子（雪 0.6 密度）；ffprobe 时长 2.00s + 抽帧目视确认（雪粒子+beat 增亮+标题卡+暗角/边框）；全部通过。
- T8：文档——ROADMAP 0.6.0 勾选（用户修订：无自动检测）、DECISIONS §18、README 音乐响应章节；提交推送。

# 执行计划 — 0.9.0「编辑器体验」

> 项目：NikoKaraokeVideoMaker ｜ 目录：D:\program\videomaker ｜ slug：nikokaraoke-090
> 依据：docs/ROADMAP.md 0.9.0（图层面板 / 吸附对齐线 / 数值精调面板）。
> 验收：图层隐藏/锁定在导出中被继承（预览/导出同源）；吸附在预览中有效且不误吸附。
> 用户已确认分支（2026-08-30）：① z 序 = **全部场景元素自由排序**（背景/主图/歌名/作者/可视化/每个附加层；
> 片头片尾黑幕与全局后期属特效叠加层，永远置顶不参与排序）；② 锁定 = **画布锁定**（不可选中/拖动/缩放，
> 参数面板仍可调）；③ 吸附阈值/开关与数字框细节按下列任务实现（不再追问）。
> 规则：勾选行 = 状态真相。每里程碑完成后汇报并等用户确认。

## 任务列表

- [x] T1: 数据模型——layout 新增 `layers: LayerItem[]`（{ id: 'background'|'main'|'songTitle'|'artist'|'visualizer'|`overlay:<id>`, hidden, locked }，z 序=数组序；缺省 null=默认顺序）+ `editor: { snapEnabled: boolean }`（默认 true）；hasDynamicFx 不变，新增 `hasCustomLayerOrder(layout)`（顺序异于默认 → 导出走全层逐帧路径，保证任意 z 序所见即所得）；layout.test 默认序/自定义序/hasCustomLayerOrder 用例
- [x] T2: SceneLayers 渲染改造——按 layers 数组顺序渲染（每元素一个 Konva Layer：name=元素 id；fx 特效层永远最后=置顶）；hidden → 不渲染（预览与导出同一渲染代码 → 天然同源）；locked → 可拖组件 draggable=false + onSelect 抑制（SharedImageLayer/TextNode/VisualizerLayer 增 `locked` prop）；附加层增删/移动同步 layers 数组（保持附加层排序语义）；ExportStageHost 拆分路径仅默认序可用（hasCustomLayerOrder → dynamic）
- [x] T3: 图层面板 UI——新增「图层」页签：全部场景元素列表（名称/👁 隐藏/🔒 锁定/↑↓ 排序），锁定行画布禁选提示；附加层资产操作仍在其面板（列表项同步）；i18n 三语
- [x] T4: 吸附对齐线——shared/snap.ts 纯函数（拖动矩形 × 目标矩形集（画布中心/边缘 + 其余元素边/中线）→ { x, y, guides }，阈值 8 逻辑像素）；SceneLayers 增 `SnapGuidesLayer`（透明引导线）+ 三处可拖组 onDragMove 接入（拖中亮线、松手清除）；`editor.snapEnabled=false` 时不吸附；单测（中心/边缘/元素间/阈值内不误吸附）
- [x] T5: 数值精调——DeferredSlider 增数字输入框（显示单位值=模型值×unitScale，步进=step，↑↓ 微调 ∧⇧10×，失焦/回车提交模型值）；各面板滑块按单位配置 unitScale（百分比=100，秒=10，°=1 等）；单测（format/parse/step 计算）
- [x] T6: 端到端与回归——typecheck/lint/测试（新增 layers/snap 单测）/build；smoke-visual 扩展（隐藏主图 → 区域像素变化；锁定层 draggable=false 探针；吸附运行态用 Konva 探针 + 纯函数单测）；smoke-project 扩展（层顺序/隐藏/锁定/吸附开关 保存→还原校验）
- [ ] T7: 文档与交付——ROADMAP 0.9.0 勾选+验收记录；DECISIONS §24（0.9.0 决策：全部元素自由排序+特效层置顶、锁定=画布锁定、吸附阈值/默认开、导出拆分路径仅默认序）；README 简述；版本 0.8.0→0.9.0；提交推送 + 汇报等用户验收

## 执行记录

（待填写）

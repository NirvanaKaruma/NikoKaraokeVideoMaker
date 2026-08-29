# 执行计划 — 0.8.0「素材与排版」

> 项目：NikoKaraokeVideoMaker ｜ 目录：D:\program\videomaker ｜ slug：nikokaraoke-080
> 依据：docs/ROADMAP.md 0.8.0（附加图像层 / 自定义字体 / 自动主题色）。验收：附加层在 .niko 保存/还原；
> 自定义字体导出与预览字形一致；主题色一键应用可撤销。
> 用户已确认分支（2026-08-30）：① 附加图像层=**多层自由增删**（数组化模型，上移/下移/删除）；
> ② 层动画=**与主图同等级完整 fx**——要求主图动效逻辑**提取为共享组件**全量复用（呼吸/微旋转/发光脉冲/遮罩/描边），
> 附加层再加透明度 + 入场动画（fade/slide/bounce，text 的 typewriter 不适用图像）；
> ③ 自定义字体=**不内嵌，仅存本机路径引用**（用户修订：存档发给别人时缺字体 → 回退默认字体并提示；同音频模型）；④ 主题色=**只改背景+可视化**（文字颜色不动，一键应用入撤销栈）。
> 规则：勾选行 = 状态真相。每里程碑完成后汇报并等用户确认。

## 任务列表

- [x] T1: 数据模型——layout 新增 `overlayLayers: OverlayLayerConfig[]`（id/rect/opacity/fx(复用 MainImageConfig['fx'] 类型)/entry(EntryStyle 子集：none|fade|slide|bounce)；z 序=数组序，默认 []）+ `hasDynamicFx` 计入 overlay 的 fx/entry；assets 侧平行资产（id→{url,file,element}）；layout.test 默认值与类型回归
- [x] T2: 共享组件提取——把 MainImageLayer 的图像动效（fxGroup 呼吸/微旋转/发光脉冲 + mask 裁剪 + 描边 + 命令式 fx 槽）抽成 `SharedImageFxLayer`；MainImageLayer 改薄壳复用；行为零变化（smoke-visual 主图 fx 项回归全绿）
- [x] T3: 附加层渲染——SceneLayers 新增 'overlay' 层（位于主图之上、文本之下）：遍历 `overlayLayers` 渲染 SharedImageFxLayer（拖动/Transformer/选中/边界 clamp 复用）+ 每层命令式 fx 槽注册；ExportStageHost 静态/全层清单含 'overlay'（预览/导出同源）
- [x] T4: 附加层面板 UI——「素材与画面」页签新增附加层分组：添加图像（文件选择）、层列表（选中/上移/下移/删除）、透明度滑块、四角快速摆位、遮罩/描边复用完整 fx 控件、入场动画（fade/slide/bounce + 时长/延迟）；i18n 三语
- [x] T5: 附加层资产与项目文件——setOverlayFile(id,file)（解码上限 3200px 同封面）；buildProjectFile/applyProjectFile 内嵌 dataURL；dirty snapshot 纳入（层 id + 图像存在性）；smoke-project 扩展（多层 → 保存 → 还原 → 层数/图像/参数恢复）
- [ ] T6: 自定义字体（路径引用，不内嵌）——TextPanel「自定义字体」：选择 ttf/otf → FontFace 注册（document.fonts.add，家庭名=确定性合成名，与文件基名绑定）→ 歌名/作者下拉可选（内置/系统/自定义分组）；项目文件只存 { name, path }（同音频模型）；打开项目：本机路径存在 → 读文件重建 FontFace；缺失 → 提示 + 回退默认字体（下拉标记缺失）；字体=导出与预览同字形（同进程 FontFace，smoke 校验渲染字体名）
- [ ] T7: 自动主题色——shared 纯函数：封面 32×32 降采样 → 亮度过滤（去过暗/过曝）→ 频次桶主色 → 派生背景基色 + 可视化渐变双色；单测（固定像素数组 → 确定性输出）；「一键应用」按钮（只改 background.color + visualizer.colors，入撤销栈一次撤销）
- [ ] T8: 端到端与回归——typecheck/lint/测试（新增模型/主题色/字体序列化单测）/build；smoke-visual 扩展（附加层渲染位置像素校验 + 主题应用后背景色变化）；smoke-export 含附加层+字体用例（全层动态路径与 WYSIWYG）；smoke-project（含 T5 扩展）
- [ ] T9: 文档与交付——ROADMAP 0.8.0 勾选+验收记录；DECISIONS §23（0.8.0 决策：多层模型、fx 全量复用提取、字体内嵌+版权提示、主题色范围只改背景+可视化）；README 简述；版本 0.7.0→0.8.0；提交推送 + 汇报等用户验收

## 执行记录

- T1：数据模型——layout.ts 新增 OverlayLayerConfig（id/rect/opacity/fx 复用 ImageFxConfig/entry 子集 none|fade|slide|bounce/fillMode='contain'）+ ProjectLayout.overlayLayers(默认 []) + hasDynamicFx 计入（呼吸/旋转/发光/入场；mask/border 静态不算）；useProject 平行资产 overlayImages（id→{url,file,element}）+ snapshotsOf 纳入（id+存在性稳定序列化）+ 层 CRUD（add/update/remove/move，全部入撤销栈）；i18n 三语 project.overlayType/overlayLoadFail；layout.test 默认值 + hasDynamicFx 附加层用例（65 测试全绿）。
- T2：共享组件提取——MainImageLayer 的图像动效整体抽成 SharedImageFxLayer（中心锚定内容/mask 裁剪/描边/整体透明度/命令式动效槽：呼吸·微旋转·发光脉冲·节拍 kick，beatPulse/beatPeriodSec 参数化）+ SharedImageLayer（可拖拽外层 Group/Transformer/边界 clamp/无图占位 全参数化）；MainImageLayer 变薄壳（行为零变化——smoke-visual 主图/动效/片头黑场/前导校验全绿）；顺手修复前导 WYSIWYG 校验时序竞态（改用重试轮询等黑幕到位，防布局提交/绘制调度抖动，同「片头黑场」既有模式）。

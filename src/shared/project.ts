import type { ProjectLayout } from './layout'

/** 项目文件格式（.niko.json）：布局全量 + 封面内嵌 + 音频路径引用 */
export interface ProjectFile {
  version: 1
  app: 'NikoKaraokeVideoMaker'
  savedAt: string
  layout: ProjectLayout
  /** 封面内嵌为 dataURL（体积可控）；无封面为 null */
  cover: { name: string; dataUrl: string } | null
  /** 独立背景图（用户额外上传；null = 使用封面图） */
  backgroundImage: { name: string; dataUrl: string } | null
  /** 音频只存磁盘路径（音频过大不入 JSON）；无路径来源（如内存生成）为 null */
  audio: { name: string; path: string } | null
  /** 自定义字体（0.8.0）：只存路径引用（同音频模型）；换机器缺字体 → 回退默认并提示 */
  font: { name: string; path: string } | null
  /** 附加图像层（0.8.0）：按 layerId 内嵌 dataURL（体积可控；与布局 overlayLayers 平行；旧文件缺省 null） */
  overlays: { layerId: string; name: string; dataUrl: string }[] | null
}

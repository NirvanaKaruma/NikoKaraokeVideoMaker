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
}

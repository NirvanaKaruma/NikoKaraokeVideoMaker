import { useCallback, useEffect, useRef, useState } from 'react'

/** 安全化家庭名：文件基名 → 只保留字母数字与 -_ ，前缀 NikoCustom-（确定性、与文件基名绑定） */
export function customFontFamily(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '_')
  return 'NikoCustom-' + (base || 'font')
}

export interface CustomFontState {
  /** 注册成功后的字体家庭名（未注册 = null） */
  family: string | null
  /** 字体文件名（未选择 = null） */
  name: string | null
  loading: boolean
  error: string | null
}

/**
 * 自定义字体（0.8.0）：字体字节经 FontFace 注册进 document.fonts。
 * 同进程预览/导出天然同字形；项目文件只存路径引用——换机器缺字体时由 useProject 回退默认并提示。
 * 输入 = useProject.assets.fontFile（文件变化时自动重新注册）。
 */
export function useCustomFont(fontFile: File | null): CustomFontState {
  const [family, setFamily] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const prevFaceRef = useRef<FontFace | null>(null)

  const register = useCallback(async (file: File) => {
    setLoading(true)
    setError(null)
    try {
      const buf = await file.arrayBuffer()
      const fam = customFontFamily(file.name)
      const face = new FontFace(fam, buf)
      await face.load()
      document.fonts.add(face)
      // 换字体时移除旧 Face（同名注册会覆盖行为不一致）
      if (prevFaceRef.current) {
        try {
          document.fonts.delete(prevFaceRef.current)
        } catch {
          /* 已是默认表？忽略 */
        }
      }
      prevFaceRef.current = face
      setFamily(fam)
    } catch (e) {
      setError(String(e))
      setFamily(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // 无文件：不重置（UI 以 name 门控显示）；注册延迟一拍（避免 effect 内同步 setState 级联渲染）
    if (!fontFile) return
    const id = setTimeout(() => void register(fontFile), 0)
    return () => clearTimeout(id)
  }, [fontFile, register])

  return { family, name: fontFile?.name ?? null, loading, error }
}

/** 从项目文件恢复的字体字节 File → 触发 useCustomFont 注册（与直接选择同一路径） */
export function fontFileFromBuffer(buf: ArrayBuffer, name: string): File {
  const ext = (name.split('.').pop() ?? 'ttf').toLowerCase()
  const mime = ext === 'otf' ? 'font/otf' : 'font/ttf'
  return new File([buf], name, { type: mime })
}

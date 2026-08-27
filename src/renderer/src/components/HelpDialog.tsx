interface HelpDialogProps {
  open: boolean
  onClose: () => void
}

function Section({
  title,
  children
}: {
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="help-section">
      <h3>{title}</h3>
      {children}
    </section>
  )
}

/** 内置使用帮助对话框（T24）：基本流程 + ffmpeg 三源说明 + FAQ */
export function HelpDialog({ open, onClose }: HelpDialogProps): React.JSX.Element | null {
  if (!open) return null
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>使用帮助</h2>
          <button type="button" className="mini-btn" onClick={onClose}>
            ✕ 关闭
          </button>
        </div>
        <div className="modal-body">
          <Section title="基本流程">
            <ol className="help-list">
              <li>
                拖入封面图（png / jpg / webp）与音频（mp3 / wav / flac / m4a，也支持 mp4 / mov /
                webm 视频，自动提取其中的音频）；
              </li>
              <li>输入歌曲名与作者；</li>
              <li>点选画布元素拖动位置（主图可拖角等比缩放），调背景、文本样式与频谱参数；</li>
              <li>点「▶ 播放」预览，频谱随音乐实时跳动；</li>
              <li>选好分辨率与帧率后点「导出视频」，等待进度完成。</li>
            </ol>
          </Section>

          <Section title="ffmpeg 三种来源">
            <ul className="help-list">
              <li>
                <b>系统 ffmpeg</b>：自动检测系统已安装的 ffmpeg，默认优先使用；
              </li>
              <li>
                <b>应用内置版</b>：一键下载安装； 网络不佳时可在设置里改下载地址（如镜像站）；
              </li>
              <li>
                <b>手动指定</b>：浏览选择本机任意 ffmpeg.exe。
              </li>
            </ul>
            <p className="panel-note">
              三种来源可随时切换并自动保存。没有任何可用 ffmpeg 时导出按钮会禁用，并出现顶部提示。
            </p>
          </Section>

          <Section title="导出说明">
            <ul className="help-list">
              <li>分辨率：1280×720 / 1920×1080 / 2560×1440 / 3840×2160（16:9）；帧率 30 / 60；</li>
              <li>导出的画面包含音乐与频谱；下半区预留给字幕。</li>
              <li>「检测 GPU 加速」会实测本机硬件/软件编码速度并自动选用更快的路径；</li>
              <li>可随时取消；失败会给出可读原因（如 4K 编码失败建议降为 1080p）。</li>
            </ul>
          </Section>

          <Section title="项目保存 / 打开 / 新建">
            <ul className="help-list">
              <li>「保存项目」把布局、样式、封面存入 .niko 项目文件；</li>
              <li>「打开项目」一键恢复；音频文件被移动后会提示重新拖入；</li>
              <li>「新建项目」清空当前内容，恢复默认布局。</li>
            </ul>
          </Section>

          <Section title="常见问题">
            <ul className="help-list">
              <li>
                <b>无网络且没有 ffmpeg？</b> 从其他电脑拷贝一个 ffmpeg.exe，用「手动指定」即可；
              </li>
              <li>
                <b>SmartScreen 警告？</b> 本软件未签名，属正常提示，点「更多信息 → 仍要运行」；
              </li>
              <li>
                <b>透明底封面？</b> 背景层会先与「背景色」合成再模糊，主图透明区透出背景；
              </li>
              <li>
                <b>4K 很慢？</b> 4K 编码量大，建议先用 1080p 出片。{' '}
              </li>
            </ul>
          </Section>
        </div>
      </div>
    </div>
  )
}

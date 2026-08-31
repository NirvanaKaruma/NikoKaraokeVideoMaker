/**
 * 所有 IPC channel 名称的唯一定义点。
 * main / preload / renderer 一律从这里引用，禁止硬编码字符串。
 */
export const IPC = {
  /** M1 hello：ping → 'pong'，验证 renderer→main 往返链路 */
  appPing: 'app:ping',

  /** 界面语言（i18n）：读取/保存用户偏好 */
  appGetLocale: 'app:get-locale',
  appSetLocale: 'app:set-locale',

  /** 应用级偏好（1.0.0）：主题/预览音量/自动保存/快捷键（AppPrefs 整体读写） */
  appPrefsGet: 'app:prefs:get',
  appPrefsSet: 'app:prefs:set',

  /** ffmpeg 三源管理 */
  ffmpegDetect: 'ffmpeg:detect',
  ffmpegConfigGet: 'ffmpeg:config:get',
  ffmpegConfigSet: 'ffmpeg:config:set',
  ffmpegValidate: 'ffmpeg:validate',
  ffmpegPickCustom: 'ffmpeg:pick-custom',
  ffmpegDownload: 'ffmpeg:download',
  ffmpegDownloadCancel: 'ffmpeg:download:cancel',
  /** main → renderer 进度事件 */
  ffmpegDownloadProgress: 'ffmpeg:download:progress',

  /** 音频时长探测（0.7.0 护栏）：ffmpeg -i 容器头（不解码）→ 秒或 null */
  audioProbeDuration: 'audio:probe-duration',

  /** 流式解码（P0 重构：ffmpeg stdout → 临时 PCM 文件，Node pipeline 背压——删除手写流控）
   * start=起子进程并 await 解码完成（返回临时文件路径/声道数）；read=渲染侧按偏移分块拉取；
   * dispose=读毕清理（删临时文件）；cancel=中断（kill 子进程 + 删临时文件）。 */
  audioDecodeStart: 'audio:decode-start',
  audioDecodeRead: 'audio:decode-read',
  audioDecodeDispose: 'audio:decode-dispose',
  audioDecodeCancel: 'audio:decode-cancel',

  /** 自更新（1.0.0）：GitHub release 检测 + 下载 portable exe + bat 自替换 */
  updaterCheck: 'updater:check',
  updaterDownload: 'updater:download',
  updaterApply: 'updater:apply',
  /** main → renderer 下载进度事件（{percent, receivedBytes, totalBytes, phase}） */
  updaterDownloadProgress: 'updater:download-progress',

  /** 项目保存/加载（T23） */
  projectSave: 'project:save',
  /** 静默保存到指定路径（1.0.0 自动保存：renderer 记住上次路径；无路径则报 canceled） */
  projectSaveTo: 'project:save-to',
  projectLoad: 'project:load',
  projectReadFile: 'project:read-file',

  /** 导出 */
  exportPickOutput: 'export:pick-output',
  exportSaveVideo: 'export:save-video',
  exportSaveAudio: 'export:save-audio',
  exportMerge: 'export:merge',
  exportMergeCancel: 'export:merge:cancel',
  exportMergeProgress: 'export:merge:progress',

  /** 1.0.0 T7b 流式写盘：renderer 分块 invoke 写（每块 = 一次 fs write，resolve = ACK；背压=在途窗口 1 块）
   * 注：MessageChannelMain 端口经 contextBridge 传递在本构建不可达（实测），采用 invoke 同协议降级。 */
  muxerStart: 'muxer:start',
  muxerWrite: 'muxer:write',
  muxerFinish: 'muxer:finish',
  muxerCancel: 'muxer:cancel'
} as const

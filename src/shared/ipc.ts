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

  /** 项目保存/加载（T23） */
  projectSave: 'project:save',
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

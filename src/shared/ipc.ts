/**
 * 所有 IPC channel 名称的唯一定义点。
 * main / preload / renderer 一律从这里引用，禁止硬编码字符串。
 */
export const IPC = {
  /** M1 hello：ping → 'pong'，验证 renderer→main 往返链路 */
  appPing: 'app:ping',

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
  exportMergeProgress: 'export:merge:progress'
} as const

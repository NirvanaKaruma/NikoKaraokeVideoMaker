/**
 * English language resource — fill values, empty strings fall back to zh-cn.
 * NOTE: key structure must stay isomorphic with zh-cn.ts; don't add/remove keys.
 * Keys with {xxx} placeholders are filled by t(key, params); e.g. `'Bar count: {v}'`.
 */
export const en = {
  common: {
    close: '✕ Close',
    cancel: 'Cancel'
  },
  app: {
    title: 'NikoKaraokeVideoMaker'
  },
  header: {
    undo: '↩ Undo',
    redo: '↪ Redo',
    saveProject: '💾 Save Project',
    newProject: '🆕 New Project',
    openProject: '📂 Open Project',
    export: '📤 Export',
    help: '❓ Help',
    settings: '⚙ Settings',
    undoTitle: 'Undo (Ctrl+Z)',
    redoTitle: 'Redo (Ctrl+Y / Ctrl+Shift+Z)',
    newProjectConfirm: 'Creating a new project will clear the current content. Continue?'
  },
  banner: {
    noFfmpeg: '⚠ ffmpeg not detected — export is disabled.',
    downloadTool: 'Download encoding tool',
    specifyTool: 'Manually specify ffmpeg.exe',
    cancelDownload: 'Cancel download'
  },
  canvas: {
    subtitleZoneWarn: '⚠ The main image has entered the bottom half (reserved subtitle area).',
    dropCoverPlaceholder: 'Drop cover image'
  },
  tabs: {
    assets: 'Assets & Layout',
    text: 'Text Style',
    visualizer: 'Audio Visualizer'
  },
  input: {
    title: 'Input',
    songTitle: 'Song Title',
    artist: 'Artist',
    cover: 'Cover image (png / jpg / webp)',
    coverDrop: 'Click or drop cover image',
    coverHint: '＋ Cover image',
    audio: 'Audio / video (mp3 / wav / flac / m4a / mp4 / mov / webm)',
    audioDrop: 'Click or drop audio or video',
    audioHint: '♪ Audio'
  },
  mainImage: {
    title: 'Main Image',
    fillMode: 'Fill mode',
    contain: 'Fit',
    cover: 'Cover',
    stretch: 'Stretch'
  },
  audio: {
    title: 'Preview Playback',
    emptyHint: 'Drag in an audio or video file to preview.',
    decoding: 'Decoding audio…',
    loadFailed: 'Failed to load audio',
    play: '▶ Play',
    pause: '⏸ Pause'
  },
  background: {
    title: 'Background',
    useImage: 'Use image background',
    source: 'Background image source',
    sourceCover: 'Cover image',
    sourceCustom: 'Custom image',
    customImage: 'Custom background image',
    uploadHint: '＋ Upload background image',
    dropOrClick: 'Click or drop image',
    clearCustom: '✕ Clear custom image',
    color: 'Background color',
    blur: 'Gaussian blur: {v}',
    dim: 'Darken: {v}%'
  },
  textPanel: {
    title: 'Text Style',
    font: 'Font',
    commonFonts: 'Common fonts',
    systemFonts: 'System fonts',
    rescan: 'Reload system fonts',
    scanning: 'Scanning…',
    loaded: 'Loaded {n} system fonts',
    loadFailed: 'Unable to read system font list (showing common fonts only)',
    firstScan: 'Initial automatic scan…',
    size: 'Font size: {v}%',
    bold: 'Bold',
    textColor: 'Text color',
    strokeColor: 'Stroke color',
    strokeWidth: 'Stroke width: {v}%',
    glow: 'Outer glow',
    glowColor: 'Glow color',
    glowStrength: 'Glow strength: {v}',
    songTitle: 'Song title',
    artist: 'Artist',
    fontDefault: 'System default',
    fontYahei: 'Microsoft YaHei',
    fontHei: 'SimHei',
    fontSong: 'SimSun',
    fontKai: 'KaiTi',
    fontFangSong: 'FangSong',
    fontDengXian: 'DengXian',
    fontYouYuan: 'YouYuan'
  },
  visualizer: {
    title: 'Audio Visualizer',
    barCount: 'Bar count: {v} (100–160)',
    freqRange: 'Frequency range: {min}–{max} Hz',
    freqMin: 'Minimum frequency: {v} Hz',
    freqMax: 'Maximum frequency: {v} Hz',
    freqNote:
      'Left is low frequency, right is high frequency; if the bars on the right barely move, lower the upper limit.',
    presetFull: 'Full range 30–16k',
    presetCommon: 'Common 30–8k',
    presetMidLow: 'Mid-low 30–4k',
    presetBass: 'Kick/bass 20–1k',
    barWidth: 'Bar width: {v}%',
    maxHeight: 'Max bar height: {v}%',
    roundness: 'Bar top roundness: {v}px',
    smoothing: 'Smoothing: {v}%',
    sensitivity: 'Sensitivity: {v}',
    attack: '',
    decay: '',
    peakFall: '',
    attackHint: '',
    styleLabel: '',
    styleBars: '',
    styleMirror: '',
    styleCenter: '',
    styleRadial: '',
    styleWave: '',
    styleArea: '',
    styleDots: '',
    colors: 'Color scheme',
    pickPinkCyan: 'Pink → Cyan',
    pickCyanViolet: 'Cyan → Violet',
    pickWarmRed: 'Warm orange → Red',
    pickWhite: 'Pure white',
    pickGreenYellow: 'Green → Yellow',
    customGradient: 'Custom gradient (1–8 color values, comma-separated)',
    customGradientOption: 'Custom gradient {i}',
    customUnnamed: 'Custom (unnamed)',
    gradientError: 'Format: #ff0000,#00ff00 (1–8 color values)',
    apply: 'Apply',
    saveAsPreset: 'Save as preset',
    deletePreset: '✕ Delete current custom preset'
  },
  exportDialog: {
    title: 'Export Video',
    resolution: 'Resolution',
    fps: 'Frame rate',
    fps30: '30 fps',
    fps60: '60 fps',
    encodeAccel: 'Encoding acceleration',
    modeAuto: 'Auto (based on local detection)',
    modeHw: 'Force GPU hardware encoding',
    modeSw: 'Force CPU software encoding',
    detailNote: 'For detailed detection, see Settings → Encoding Acceleration.',
    noFfmpeg: 'ffmpeg not detected: export disabled. Install or specify it in Settings → ffmpeg.',
    needAudio: 'Please drop in audio first; export will be available when it is ready.',
    start: 'Start Export',
    cancel: 'Cancel Export'
  },
  settings: {
    title: 'Settings',
    language: 'Language',
    uiLanguage: 'Interface language',
    languageZh: '简体中文',
    languageEn: 'English',
    languageJp: '日本語',
    encodeAccel: 'Encoding Acceleration',
    encodeMode: 'Encoding mode',
    modeAuto: 'Auto (based on local detection)',
    modeHw: 'Force GPU hardware encoding',
    modeSw: 'Force CPU software encoding',
    detectGpu: 'Re-detect local GPU acceleration',
    detecting: 'Detecting…',
    hw: 'Hardware encoding: {v}',
    sw: 'Software encoding: {v}',
    unavailable: 'Unavailable',
    autoNote: 'Auto mode selects the faster encoding method based on local benchmark results.'
  },
  ffmpegPanel: {
    title: 'ffmpeg Settings',
    currentActive: 'Currently active',
    notAvailable: 'No usable ffmpeg detected (export disabled)',
    useSource: 'Source',
    sourceSystem: 'System ffmpeg',
    sourceManaged: 'App-managed version',
    sourceCustom: 'Manual specification',
    redetect: 'Re-detect',
    detecting: 'Detecting…',
    browseExe: 'Browse for ffmpeg.exe',
    threeSources: 'Three-source status',
    rowSystem: 'System PATH',
    rowManaged: 'App-managed',
    rowCustom: 'Manual specification',
    notDetected: '{title}: not detected',
    installTitle: 'One-click install encoding tool',
    installBtn: 'One-click download & install',
    installDone: '✓ Installation complete; automatically re-detected.',
    downloadCancel: 'Cancel',
    urlLabel: 'Download URL override (leave empty for default gyan.dev; mirrors allowed)',
    saveUrl: 'Save URL',
    versionSep: '{title}: {version}',
    errorSep: ' | {error}'
  },
  help: {
    title: 'Help',
    basics: 'Basic workflow',
    basicsStep1:
      'Drag in a cover image (png / jpg / webp) and audio (mp3 / wav / flac / m4a; mp4 / mov / webm videos are also supported and their audio is extracted automatically);',
    basicsStep2: 'Enter the song title and artist;',
    basicsStep3:
      'Click and drag canvas elements to move them (drag the corners of the main image to scale proportionally), then adjust the background, text style, and visualizer settings;',
    basicsStep4: 'Click “▶ Play” to preview; the visualizer reacts to the music in real time;',
    basicsStep5:
      'Choose the resolution and frame rate, then click “Export Video” and wait for the process to finish.',
    sources: 'Three ffmpeg sources',
    sourceSystemLabel: 'System ffmpeg',
    sourceSystemDesc:
      'Automatically detects ffmpeg installed on the system and uses it by default;',
    sourceManagedLabel: 'App-managed version',
    sourceManagedDesc:
      'One-click download and install; if the network is poor, change the download URL in Settings (for example, use a mirror);',
    sourceCustomLabel: 'Manual specification',
    sourceCustomDesc: 'Browse and select any ffmpeg.exe on this computer.',
    sourcesNote:
      'The three sources can be switched at any time and are saved automatically. If no usable ffmpeg is available, the export button is disabled and a notice appears at the top.',
    exportTitle: 'Export notes',
    exportRes:
      'Resolution: 1280×720 / 1920×1080 / 2560×1440 / 3840×2160 (16:9); frame rate: 30 / 60;',
    exportContent:
      'The exported video includes music and the audio visualizer; the bottom half is reserved for subtitles.',
    exportGpu:
      '“Detect GPU acceleration” benchmarks hardware/software encoding on this machine and automatically chooses the faster path;',
    exportCancel:
      'You can cancel at any time; failures show readable reasons (for example, if 4K encoding fails, try lowering to 1080p).',
    projectTitle: 'Project save / open / new',
    projectSave:
      '“Save Project” stores the layout, styles, and cover image in a .niko project file;',
    projectOpen:
      '“Open Project” restores the project; if the audio file has been moved, you will be prompted to drag it in again;',
    projectNew: '“New Project” clears the current content and restores the default layout.',
    faqTitle: 'FAQ',
    faqNoNetLabel: 'No network and no ffmpeg?',
    faqNoNetBody: 'Copy ffmpeg.exe from another computer and use “Manual specification”;',
    faqSmartLabel: 'SmartScreen warning?',
    faqSmartBody:
      'This app is unsigned, so this warning is normal. Click “More info → Run anyway”;',
    faqTransparentLabel: 'Transparent cover?',
    faqTransparentBody:
      'The background layer is first composited with the background color and then blurred; transparent areas of the main image show the background through.',
    faq4kLabel: '4K too slow?',
    faq4kBody: '4K encoding is heavy; 1080p is recommended for first exports.'
  },
  project: {
    saved: 'Project saved: {path}',
    saveFailed: 'Save failed',
    saveError: 'Failed to save project: {err}',
    opened: 'Project opened',
    openFailed: 'Failed to open project: {err}',
    badFormat: 'Project file format is unsupported or corrupted',
    coverType: 'Cover image supports only png/jpg/webp (received .{ext})',
    audioType: 'Only mp3/wav/flac/m4a/ogg/mp4/m4v/mov/webm are supported (received .{ext})',
    bgType: 'Background image supports only png/jpg/webp (received .{ext})',
    coverLoadFail: 'Failed to load the cover image; please try another image',
    bgLoadFail: 'Failed to load the background image; please try another image',
    audioMissing: 'Audio file not found ({path}); please drag in the audio again',
    audioNoPath:
      'The audio had no disk path when the project was saved; please drag in the audio again',
    defaultName: 'Untitled project'
  },
  exporter: {
    noFfmpeg: 'No usable ffmpeg: please install or specify it in Settings',
    needAudio: 'Please load audio first (export is available after audio is ready)',
    unnamedSong: 'Untitled song',
    sameFile:
      'The output file is the same as the audio source file. Please choose a different file name or save location and export again.',
    preparing: 'Preparing export…',
    encoding: 'Generating video…',
    encodingProgress: 'Generating video… {p}% complete (average {ms} ms/frame)',
    encodeDone: 'Video encoding complete ({s} s elapsed)',
    prepareMerge: 'Preparing to merge…',
    merging: 'Merging audio and video…',
    exportDone: 'Export complete: {path}',
    exportCancelled: 'Export cancelled',
    exportFailed: 'Export failed',
    mergeFailed: 'Merge failed',
    noAudioPath: 'Unable to locate the audio file path',
    unsupportedH264:
      'H.264 encoding is not supported in the current environment (WebCodecs unavailable). Try a lower resolution, or use a computer with hardware acceleration support.',
    canvasFail: 'Unable to create the export canvas',
    verdictHwUnavailable:
      'Hardware encoding unavailable: export will use software encoding (speed depends on CPU)',
    verdictSwUnavailable:
      'Software encoding unavailable, hardware encoding OK: export will use GPU acceleration',
    verdictHwFaster:
      'GPU acceleration available: hardware encoding is clearly faster than software; export will automatically use GPU encoding',
    verdictSwFaster:
      'GPU encoding on this machine did not provide acceleration (software is faster) → export automatically uses software encoding; re-detect after changing GPU/drivers'
  },
  playback: {
    noWebAudio: 'Web Audio is not supported in the current environment',
    decodeFailed: 'Audio decoding failed: {err}',
    fontEnumFailed: 'Font enumeration is not supported in the current environment'
  },
  ffmpeg: {
    downloading: 'Downloading ffmpeg…',
    extracting: 'Extracting ffmpeg.exe…',
    validating: 'Validating encoder…',
    installed: 'Installed: ffmpeg {v}',
    execFailed: 'Cannot execute (-version failed): {msg}',
    noAac: 'Missing aac encoder; cannot be used for export',
    redirects: 'Too many redirects',
    httpFail: 'Download failed: HTTP {code}',
    cancelled: 'Download cancelled',
    zipOpenFail: 'Failed to open the archive',
    zipReadFail: 'Failed to read an archive entry',
    zipNoExe: 'ffmpeg.exe not found in the archive',
    mergeFailSameFile:
      'The output file is the same as the audio source file. Please choose a different file name or save location and try again.',
    mergeFailPermission:
      'No permission to write to the selected location (the file may be in use or protected). Please choose another save location and try again.',
    mergeFailDisk: 'Not enough disk space; please free up space and try again.',
    mergeFailNoStream: 'The audio file has no usable audio track; please try another audio file.',
    mergeFailGeneric: 'ffmpeg merge failed: {tail}',
    downloadFail: 'Download failed; please check your network or download URL and try again',
    mergeProgress: 'Merging audio and video…',
    noAvailable:
      'No usable ffmpeg: please download the app-managed version in Settings or manually specify a path',
    invalidProject: 'Not a valid NikoKaraokeVideoMaker project file'
  },
  dialogs: {
    pickFfmpeg: 'Select ffmpeg.exe',
    ffmpegExeFilter: 'ffmpeg executable',
    exportVideo: 'Export Video',
    mp4Filter: 'MP4 video',
    saveProject: 'Save Project',
    openProject: 'Open Project',
    projectFilter: 'NikoKaraokeVideoMaker project'
  },
  closeGuard: {
    title: 'Project has unsaved changes',
    detail: 'Save before exiting?',
    saveExit: 'Save and exit',
    exitNoSave: 'Exit without saving',
    cancel: 'Cancel'
  }
}

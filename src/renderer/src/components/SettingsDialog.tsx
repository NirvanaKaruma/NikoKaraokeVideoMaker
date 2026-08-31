import { useEffect, useRef, useState } from 'react'
import type { FfmpegStatusReport } from '@shared/ffmpeg'
import { SUPPORTED_LOCALES, type Locale } from '@shared/i18n'
import type { ShortcutAction, ShortcutMap } from '@shared/appSettings'
import { prettyShortcut } from '@shared/appSettings'
import { useLocale } from '../hooks/useLocale'
import { useAppPrefs } from '../hooks/useAppPrefs'
import { SettingsPanel } from './panels/SettingsPanel'
import type { UpdateCheckResult, DownloadProgress } from '@shared/updater'
import { DeferredSlider } from './DeferredSlider'
import {
  benchmarkEncoder,
  getEncodeModePref,
  setEncodeModePref,
  type EncodeBenchmark,
  type EncodeModePref
} from '../export/exportVideo'
import { RESOLUTIONS } from '@shared/layout'

interface SettingsDialogProps {
  open: boolean
  onClose: () => void
  status: FfmpegStatusReport | null
  loading: boolean
  onRefresh: () => void
  /** 主题（深色/浅色）：兼容旧接口——主题已并入 AppPrefs（useAppPrefs），此参数仅作初始值 */
  theme: 'dark' | 'light'
  onThemeChange: (t: 'dark' | 'light') => void
  /** autoSave 服务（由 App 注入：定时器调度 + dirty 检查 + saveProject） */
  autoSave?: {
    enabled: boolean
    intervalMin: number
    onToggle: (enabled: boolean) => void
    onInterval: (min: number) => void
  } | null
}

const MODE_LABEL_KEY: Record<EncodeModePref, string> = {
  auto: 'settings.modeAuto',
  hw: 'settings.modeHw',
  sw: 'settings.modeSw'
}

type SettingsTab = 'general' | 'autosave' | 'shortcuts' | 'export' | 'about'

const TABS: { id: SettingsTab; labelKey: string }[] = [
  { id: 'general', labelKey: 'settings.tabGeneral' },
  { id: 'autosave', labelKey: 'settings.tabAutoSave' },
  { id: 'shortcuts', labelKey: 'settings.tabShortcuts' },
  { id: 'export', labelKey: 'settings.tabExport' },
  { id: 'about', labelKey: 'settings.tabAbout' }
]

const SHORTCUT_ROWS: { action: ShortcutAction; labelKey: string; descKey: string }[] = [
  { action: 'togglePlay', labelKey: 'shortcuts.togglePlay', descKey: 'shortcuts.descTogglePlay' },
  { action: 'stopPlay', labelKey: 'shortcuts.stopPlay', descKey: 'shortcuts.descStopPlay' },
  { action: 'undo', labelKey: 'shortcuts.undo', descKey: 'shortcuts.descUndo' },
  { action: 'redo', labelKey: 'shortcuts.redo', descKey: 'shortcuts.descRedo' },
  {
    action: 'saveProject',
    labelKey: 'shortcuts.saveProject',
    descKey: 'shortcuts.descSaveProject'
  },
  { action: 'exportVideo', labelKey: 'shortcuts.exportVideo', descKey: 'shortcuts.descExportVideo' }
]

/** 统一行组件：图标 + 名称 + 描述 + 右侧控件 */
function SettingsRow({
  icon,
  labelKey,
  descKey,
  children
}: {
  icon: string
  labelKey: string
  descKey?: string
  children?: React.ReactNode
}): React.JSX.Element {
  const { t } = useLocale()
  return (
    <div className="settings-row">
      <div className="settings-row-main">
        <span className="settings-row-icon" aria-hidden>
          {icon}
        </span>
        <div className="settings-row-text">
          <span className="settings-row-label">{t(labelKey)}</span>
          {descKey && <span className="settings-row-desc">{t(descKey)}</span>}
        </div>
      </div>
      <div className="settings-row-ctl">{children}</div>
    </div>
  )
}

/** 设置窗口（1.0.0 重构）：左侧一级 Tab + 右侧分组行（参考 KTV 打轴工具设置页）。 */
export function SettingsDialog(props: SettingsDialogProps): React.JSX.Element | null {
  const { t, locale, setLocale } = useLocale()
  const { open, onClose, status, loading, onRefresh, onThemeChange, autoSave } = props
  const { prefs, setPrefs, recordSeq } = useAppPrefs()
  const [tab, setTab] = useState<SettingsTab>('general')
  const [mode, setMode] = useState<EncodeModePref>(() => getEncodeModePref())
  const [diag, setDiag] = useState<EncodeBenchmark | null>(null)
  const [diagRunning, setDiagRunning] = useState(false)
  // 录键状态：正在改绑的 action（null = 未在录）
  const [recording, setRecording] = useState<ShortcutAction | null>(null)
  // 自更新状态（1.0.0）：check 结果 / 下载进度 / 就绪的安装包路径
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResult | null>(null)
  const [updateBusy, setUpdateBusy] = useState(false)
  const [dlProgress, setDlProgress] = useState<DownloadProgress | null>(null)
  const [dlPath, setDlPath] = useState<string | null>(null)
  /** 录键提交回调（ref 化：hooks 顺序稳定；keyup 时读最新 prefs 不触发重渲染依赖） */
  const prefsRef = useRef(prefs)
  useEffect(() => {
    prefsRef.current = prefs
  }, [prefs])

  // 下载进度订阅（下载会话生命周期内）
  useEffect(() => {
    const off = window.api.updater.onDownloadProgress((p) => setDlProgress(p))
    return off
  }, [])

  // 录键会话：window 级 keydown（capture）——录制时全接管，防止 Space/Enter 触发按钮或滚动
  // （React 合成事件绑定在容器 div 上时，按钮聚焦的 Space 会先触发 click）
  useEffect(() => {
    if (recording == null) return
    let pendingSeq: string | null = null
    const h = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setRecording(null)
        return
      }
      // 纯修饰键等待实质键
      if (e.key === 'Control' || e.key === 'Shift' || e.key === 'Alt' || e.key === 'Meta') return
      const seq = recordSeq({
        key: e.key,
        code: e.code,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey
      })
      if (seq != null) pendingSeq = seq
    }
    const keyup = (): void => {
      if (pendingSeq != null) {
        const action = recording
        const shortcuts = { ...prefsRef.current.shortcuts, [action]: pendingSeq } as ShortcutMap
        void setPrefs({ shortcuts })
        setRecording(null)
        pendingSeq = null
      }
    }
    window.addEventListener('keydown', h, true)
    window.addEventListener('keyup', keyup, true)
    return () => {
      window.removeEventListener('keydown', h, true)
      window.removeEventListener('keyup', keyup, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording])

  if (!open) return null

  // ── 自更新动作（1.0.0）──
  const doCheck = async (): Promise<void> => {
    setUpdateBusy(true)
    try {
      const r = await window.api.updater.check()
      setUpdateInfo(r)
    } finally {
      setUpdateBusy(false)
    }
  }
  const doDownload = async (): Promise<void> => {
    if (!updateInfo?.downloadUrl) return
    setDlProgress(null)
    setDlPath(null)
    const jobId = 'dl-' + Date.now()
    const r = await window.api.updater.download(
      jobId,
      updateInfo.downloadUrl,
      updateInfo.sha256 ?? null
    )
    if (r.ok && r.path) setDlPath(r.path)
    else if (r.error) setDlProgress({ phase: 'error', percent: 0, receivedBytes: 0, totalBytes: 0 })
  }
  const doApply = async (): Promise<void> => {
    if (!dlPath) return
    const r = await window.api.updater.apply(dlPath)
    if (!r.ok && r.error) {
      setDlProgress({ phase: 'error', percent: 0, receivedBytes: 0, totalBytes: 0 })
    }
  }

  const runDiag = async (): Promise<void> => {
    setDiagRunning(true)
    try {
      setDiag(await benchmarkEncoder(1920, 1080))
    } finally {
      setDiagRunning(false)
    }
  }

  const applyMode = (m: EncodeModePref): void => {
    setMode(m)
    setEncodeModePref(m)
  }

  const fmtMs = (v: number | null): string =>
    v == null ? t('settings.unavailable') : Math.round(v) + ' ms/帧'

  const defaultExport = prefs.defaultExportResolution
  const exportResOptions = RESOLUTIONS

  // 主题/音量同步：旧接口 onThemeChange 兼容（App 用 useAppPrefs 后传入）
  const onTheme = (v: 'dark' | 'light'): void => {
    void setPrefs({ theme: v })
    onThemeChange(v)
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-settings" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{t('settings.title')}</h2>
          <button type="button" className="mini-btn" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
        <div className="modal-body settings-layout">
          {/* 一级 Tab（左侧竖排，参考 KTV 打轴工具） */}
          <nav className="settings-tabs">
            {TABS.map((tb) => (
              <button
                key={tb.id}
                type="button"
                className={'settings-tab' + (tab === tb.id ? ' active' : '')}
                onClick={() => setTab(tb.id)}
              >
                {t(tb.labelKey)}
              </button>
            ))}
          </nav>

          <div className="settings-content">
            {tab === 'general' && (
              <>
                <h2>{t('settings.secGeneral')}</h2>
                <SettingsRow
                  icon="🌐"
                  labelKey="settings.uiLanguage"
                  descKey="settings.descLanguage"
                >
                  <select value={locale} onChange={(e) => setLocale(e.target.value as Locale)}>
                    {SUPPORTED_LOCALES.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.nativeName}
                      </option>
                    ))}
                  </select>
                </SettingsRow>
                <SettingsRow icon="🎨" labelKey="settings.theme" descKey="settings.descTheme">
                  <div className="audio-row">
                    <button
                      type="button"
                      className={'mini-btn' + (prefs.theme === 'dark' ? ' mini-btn-active' : '')}
                      onClick={() => onTheme('dark')}
                    >
                      {t('settings.themeDark')}
                    </button>
                    <button
                      type="button"
                      className={'mini-btn' + (prefs.theme === 'light' ? ' mini-btn-active' : '')}
                      onClick={() => onTheme('light')}
                    >
                      {t('settings.themeLight')}
                    </button>
                  </div>
                </SettingsRow>
                <SettingsRow
                  icon="🔊"
                  labelKey="settings.previewVolume"
                  descKey="settings.descPreviewVolume"
                >
                  <DeferredSlider
                    label={(v) => t('settings.previewVolumeValue', { v: Math.round(v * 100) })}
                    value={prefs.previewVolume}
                    min={0}
                    max={1}
                    step={0.01}
                    unitScale={100}
                    onCommit={(v) => void setPrefs({ previewVolume: v })}
                  />
                </SettingsRow>
              </>
            )}

            {tab === 'autosave' && (
              <>
                <h2>{t('settings.secAutoSave')}</h2>
                <SettingsRow icon="💾" labelKey="settings.autoSave" descKey="settings.descAutoSave">
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={prefs.autoSave.enabled}
                      onChange={(e) =>
                        autoSave?.onToggle(e.currentTarget.checked) ??
                        void setPrefs({
                          autoSave: { ...prefs.autoSave, enabled: e.currentTarget.checked }
                        })
                      }
                    />
                    <span className="switch-track" />
                    <span className="switch-label">
                      {prefs.autoSave.enabled ? t('common.on') : t('common.off')}
                    </span>
                  </label>
                </SettingsRow>
                <SettingsRow
                  icon="⏱"
                  labelKey="settings.autoSaveInterval"
                  descKey="settings.descAutoSaveInterval"
                >
                  <DeferredSlider
                    label={(v) => t('settings.autoSaveIntervalValue', { v: Math.round(v) })}
                    value={prefs.autoSave.intervalMin}
                    min={1}
                    max={60}
                    step={1}
                    unitScale={1}
                    onCommit={(v) =>
                      autoSave?.onInterval(Math.round(v)) ??
                      void setPrefs({ autoSave: { ...prefs.autoSave, intervalMin: Math.round(v) } })
                    }
                  />
                </SettingsRow>
              </>
            )}

            {tab === 'shortcuts' && (
              <>
                <h2>{t('settings.secShortcuts')}</h2>
                <p className="panel-note">{t('shortcuts.recordingHint')}</p>
                {SHORTCUT_ROWS.map((row) => (
                  <SettingsRow
                    key={row.action}
                    icon="⌨️"
                    labelKey={row.labelKey}
                    descKey={row.descKey}
                  >
                    {recording === row.action ? (
                      <button
                        type="button"
                        className="mini-btn recording"
                        tabIndex={-1}
                        title={t('shortcuts.pressKey')}
                      >
                        {t('shortcuts.pressKey')}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={'shortcut-key' + (recording != null ? ' disabled' : '')}
                        onClick={() => setRecording(row.action)}
                        title={t('shortcuts.clickToRebind')}
                      >
                        {prettyShortcut(prefs.shortcuts[row.action])}
                      </button>
                    )}
                  </SettingsRow>
                ))}
                <div className="audio-row">
                  <button
                    type="button"
                    className="mini-btn"
                    onClick={() =>
                      void setPrefs({
                        shortcuts: {
                          togglePlay: 'Space',
                          stopPlay: 'Ctrl+.',
                          undo: 'Ctrl+Z',
                          redo: 'Ctrl+Shift+Z',
                          saveProject: 'Ctrl+S',
                          exportVideo: 'Ctrl+E'
                        }
                      })
                    }
                  >
                    {t('shortcuts.resetAll')}
                  </button>
                </div>
              </>
            )}

            {tab === 'export' && (
              <>
                <h2>{t('settings.secExport')}</h2>
                <SettingsRow
                  icon="🎥"
                  labelKey="settings.defaultResolution"
                  descKey="settings.descDefaultResolution"
                >
                  <select
                    value={defaultExport}
                    onChange={(e) =>
                      void setPrefs({ defaultExportResolution: e.currentTarget.value })
                    }
                  >
                    <option value="">{t('settings.resolutionFollowProject')}</option>
                    {exportResOptions.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </SettingsRow>
                <SettingsRow
                  icon="⚙"
                  labelKey="settings.encodeAccel"
                  descKey="settings.descEncodeAccel"
                >
                  <select
                    value={mode}
                    onChange={(e) => applyMode(e.target.value as EncodeModePref)}
                  >
                    <option value="auto">{t(MODE_LABEL_KEY.auto)}</option>
                    <option value="hw">{t(MODE_LABEL_KEY.hw)}</option>
                    <option value="sw">{t(MODE_LABEL_KEY.sw)}</option>
                  </select>
                </SettingsRow>
                <div className="audio-row">
                  <button
                    type="button"
                    className="mini-btn"
                    onClick={() => void runDiag()}
                    disabled={diagRunning}
                  >
                    {diagRunning ? t('settings.detecting') : t('settings.detectGpu')}
                  </button>
                </div>
                {diag && (
                  <div className="panel-note">
                    <p>
                      {t('settings.hw', { v: fmtMs(diag.hardwareMsPerFrame) })} ｜{' '}
                      {t('settings.sw', { v: fmtMs(diag.softwareMsPerFrame) })}
                    </p>
                    <p>{diag.verdict}</p>
                  </div>
                )}
                <p className="panel-note">{t('settings.autoNote')}</p>
              </>
            )}

            {tab === 'about' && (
              <>
                <h2>{t('settings.secAbout')}</h2>
                <p className="panel-note">{t('settings.aboutText')}</p>

                {/* 1.0.0 自更新：检查 → 下载（进度+校验）→ portable 自替换 */}
                <SettingsRow icon="🔄" labelKey="updater.title" descKey="updater.descCheck">
                  <div className="updater-ctl">
                    <button
                      type="button"
                      className="mini-btn"
                      onClick={() => void doCheck()}
                      disabled={updateBusy}
                    >
                      {updateBusy ? t('updater.checking') : t('updater.checkNow')}
                    </button>
                  </div>
                </SettingsRow>

                {updateInfo?.hasUpdate && (
                  <SettingsRow
                    icon="⬆"
                    labelKey="updater.newVersion"
                    descKey="updater.descNewVersion"
                  >
                    <div className="updater-ctl">
                      <span className="updater-version">
                        {t('updater.versionLine', {
                          cur: updateInfo.current,
                          latest: updateInfo.latest
                        })}
                      </span>
                      {!dlPath && updateInfo.downloadUrl && (
                        <button
                          type="button"
                          className="mini-btn"
                          onClick={() => void doDownload()}
                          disabled={
                            dlProgress?.phase === 'downloading' || dlProgress?.phase === 'verifying'
                          }
                        >
                          {t('updater.download')}
                        </button>
                      )}
                    </div>
                  </SettingsRow>
                )}

                {/* 更新日志摘要（存在时） */}
                {updateInfo?.hasUpdate && updateInfo.notes && (
                  <p className="panel-note updater-notes">{updateInfo.notes}</p>
                )}

                {/* 下载进度 UI */}
                {dlProgress && dlProgress.phase === 'downloading' && (
                  <div className="dl-row updater-dlrow">
                    <div className="dl-bar">
                      <div className="dl-fill" style={{ width: dlProgress.percent + '%' }} />
                    </div>
                    <span className="panel-note">
                      {t('updater.downloading', { p: dlProgress.percent })}
                    </span>
                  </div>
                )}
                {dlProgress && dlProgress.phase === 'verifying' && (
                  <p className="panel-note">{t('updater.verifying')}</p>
                )}
                {dlProgress && dlProgress.phase === 'error' && (
                  <p className="field-error">{t('updater.downloadFailed')}</p>
                )}

                {/* 已下载 → 应用更新 */}
                {dlPath != null && (
                  <SettingsRow
                    icon="🔧"
                    labelKey="updater.readyApply"
                    descKey="updater.descReadyApply"
                  >
                    <div className="updater-ctl">
                      <button type="button" className="btn" onClick={() => void doApply()}>
                        {t('updater.applyNow')}
                      </button>
                    </div>
                  </SettingsRow>
                )}

                {/* 已是最新 / 有更新但无资产 */}
                {updateInfo && !updateInfo.hasUpdate && !updateInfo.error && (
                  <p className="panel-note">✓ {t('updater.upToDate', { v: updateInfo.latest })}</p>
                )}
                {updateInfo && updateInfo.error && (
                  <p className="field-error">
                    {t('updater.checkFailed')}（{updateInfo.error}）
                  </p>
                )}

                <SettingsPanel status={status} loading={loading} onRefresh={onRefresh} />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

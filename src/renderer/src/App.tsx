import { useEffect, useState } from 'react'

type PingState = 'checking' | 'ok' | 'error'

const PING_LABEL: Record<PingState, string> = {
  checking: 'IPC 检测中…',
  ok: 'IPC 连接正常',
  error: 'IPC 连接失败'
}

function App(): React.JSX.Element {
  const [ping, setPing] = useState<PingState>('checking')

  useEffect(() => {
    window.api
      .ping()
      .then((value) => setPing(value === 'pong' ? 'ok' : 'error'))
      .catch(() => setPing('error'))
  }, [])

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1 className="app-title">NikoKaraokeVideoMaker</h1>
        <span className={'ipc-badge ipc-' + ping}>{PING_LABEL[ping]}</span>
      </header>
      <main className="app-main">
        <p className="placeholder">编辑器（画布、输入、频谱可视化）将在 M2–M3 就绪。</p>
      </main>
      <footer className="app-footer">M1 脚手架 · electron-vite + React + TypeScript</footer>
    </div>
  )
}

export default App

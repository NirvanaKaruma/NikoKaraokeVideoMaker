/**
 * 1.0.0 T7b 流式写盘：mp4-muxer → 分块 invoke（带字节偏移 position + ACK）→ 定位写盘。
 *
 * 协议（renderer → main，经 IPC invoke，每块一次 fs.write(fd, buf, 0, len, position)）：
 * - muxer:write(jobId, buffer, position)：写完成回调后 resolve（= ACK）；磁盘/权限错误 → reject
 *   （可读提示经 UI 抛出）+ 临时文件清理。position 定位写 → 乱序到达也能正确落盘（moov 尾置）。
 * - muxer:cancel(jobId)：关 fd + 删临时文件（取消语义：不留产物）。
 * - muxer:finish(jobId)：关 fd → 临时文件路径（重排交给 ffmpeg merge 的 -movflags +faststart）。
 *
 * 背压（三级，用户确认）：① renderer 编码器 queue≤2；② 编码输出自然小；③ ACK = fs.write 回调
 * ——renderer 逐块等待（在途 1 块，4MiB），内存峰值有界。
 */
import { ipcMain, app } from 'electron'
import { mkdir, open, rm, type FileHandle } from 'fs/promises'
import { join } from 'path'
import { IPC } from '../shared/ipc'

interface MuxJob {
  jobId: string
  target: string
  fh: FileHandle
  error: string | null
}

const jobs = new Map<string, MuxJob>()

async function tempDir(): Promise<string> {
  const dir = join(app.getPath('temp'), 'niko-export')
  await mkdir(dir, { recursive: true })
  return dir
}

async function cleanupJob(job: MuxJob): Promise<void> {
  jobs.delete(job.jobId)
  try {
    await job.fh.close()
  } catch {
    /* 已关闭 */
  }
  try {
    await rm(job.target, { force: true })
  } catch {
    /* 已不存在 */
  }
}

export function registerMuxIpc(): void {
  ipcMain.handle(IPC.muxerStart, async () => {
    const jobId = crypto.randomUUID()
    const dir = await tempDir()
    const target = join(dir, 'niko-stream-' + jobId + '.mp4.part')
    const fh = await open(target, 'w')
    jobs.set(jobId, { jobId, target, fh, error: null })
    return { jobId }
  })

  ipcMain.handle(
    IPC.muxerWrite,
    async (_e, jobId: string, buffer: ArrayBuffer, position: number) => {
      const job = jobs.get(jobId)
      if (!job) throw new Error('unknown mux job')
      if (job.error) throw new Error(job.error)
      try {
        const buf = Buffer.from(buffer)
        // 定位写：position = 文件字节偏移（mp4-muxer 语义；乱序到达同样正确落盘）
        await job.fh.write(buf, 0, buf.length, position)
      } catch (err) {
        job.error = err instanceof Error ? err.message : String(err)
        await cleanupJob(job)
        throw err
      }
    }
  )

  ipcMain.handle(IPC.muxerFinish, async (_e, jobId: string) => {
    const job = jobs.get(jobId)
    if (!job) return { ok: false, error: 'unknown job' }
    jobs.delete(jobId)
    if (job.error) {
      await cleanupJob(job)
      return { ok: false, error: job.error }
    }
    try {
      await job.fh.close()
      return { ok: true, target: job.target }
    } catch (err) {
      await cleanupJob(job)
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.muxerCancel, async (_e, jobId: string) => {
    const job = jobs.get(jobId)
    if (job) {
      await cleanupJob(job)
      return true
    }
    return false
  })
}

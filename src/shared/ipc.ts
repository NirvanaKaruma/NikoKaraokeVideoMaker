/**
 * 所有 IPC channel 名称的唯一定义点。
 * main / preload / renderer 一律从这里引用，禁止硬编码字符串。
 */
export const IPC = {
  /** M1 hello：ping → 'pong'，验证 renderer→main 往返链路 */
  appPing: 'app:ping'
} as const

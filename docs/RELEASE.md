# 发布 SOP（手动 GitHub Release）

> 本应用内置「检查更新」（设置 → 关于）：应用启动后在 GitHub Releases 检测最新版本。
> **检测规则**：releases/latest 的 tag 必须形如 vX.Y.Z（v 前缀 + semver），且资产名含 -portable.exe（应用内用 SHA-256 digest 校验后自替换）。不满足这些约定的 release 会被忽略或仅提示（无资产时显示「发现新版本」但不能一键更新）。

## 发布步骤（全程手动，无需脚本）

1. **升版本号**：改 package.json 的 version（如 1.0.0 → 1.1.0）。
   **必须与 tag 完全一致**（tag 加 v 前缀，如 v1.1.0）。
2. **提交并打 tag**：
   git add -A && git commit -m 'release: v1.1.0'
   git tag v1.1.0
   git push origin main --tags
3. **本地打包**（Windows）：
   npm run build:win
   产物在 dist/：niko-karaoke-video-maker-1.1.0-portable.exe（**必须上传**）、*-setup.exe（可选）、*.blockmap/*.yml（无需上传）。
4. **网页登录 GitHub 建 Release**：
   - 仓库 → Releases → Draft a new release
   - Choose a tag：选刚推的 v1.1.0
   - Release title：v1.1.0（与 tag 同名即可）
   - 描述：写用户可见的更新说明（应用内会显示前 500 字）
   - 附件：拖入 *-portable.exe（**必须**；*-setup.exe 可一并传）
   - 点 Publish release

## 校验点（发布后自查）

- [ ] tag 是 v + semver，如 v1.1.0（不是 1.1.0 / release-1.1.0）
- [ ] assets 里**确定包含** -portable.exe（文件名含小写 -portable）
- [ ] package.json version 与 tag 数字部分一致（如 1.1.0）
- [ ] 应用内「检查更新」显示新版本 → 下载 → 校验通过 → 应用更新后重启到新版

## 常见问题

- **「检查更新失败」**：网络不通 / GitHub API 限流（等 1 分钟重试）。
- **「发现新版本」但没有「下载更新」**：release 未上传 portable exe，或文件名不含 -portable。
- **下载后校验失败**：上传的 exe 与 GitHub digest 不符（重新上传；上传后 GitHub 自动生成 digest，无需手动计算）。
- **应用更新后仍旧版**：启动的 exe 被别的快捷方式指向（portable 自替换只替换当前运行的 exe 路径）；请从替换后的 exe 重新创建快捷方式。

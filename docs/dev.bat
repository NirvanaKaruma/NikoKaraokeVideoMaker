@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo  NikoKaraokeVideoMaker 开发模式启动中...
echo  首次启动需编译，约 5-15 秒，请稍候。
echo  关闭应用窗口即可退出（或在本窗口按 Ctrl+C）。
echo ============================================
call npm run dev
pause

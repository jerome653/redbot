@echo off
rem ---------------------------------------------------------------------------
rem  Launch redbot as a desktop app WITHOUT a packaged build.
rem
rem  WHY THIS EXISTS.
rem
rem  A convenience: it runs the app straight from a source checkout, with no packaging step.
rem  Useful while developing, because `npm run dist` takes minutes and this takes seconds.
rem
rem  HISTORY, AND A CORRECTION. This file previously claimed that Smart App Control blocks the
rem  packaged executable outright, and that running through Electron's signed binary was the
rem  only way to launch it. That was measured once and is NOT true on this machine now.
rem  Re-measured 2026-07-30 with SAC still enforcing
rem  (HKLM\SYSTEM\CurrentControlSet\Control\CI\Policy VerifiedAndReputablePolicyState = 1):
rem
rem      release\win-unpacked\redbot.exe                 -> launched, console reached
rem      %LOCALAPPDATA%\Programs\redbot\redbot.exe       -> launched, console reached
rem
rem  So the packaged and installed builds run fine unsigned here. The installer is still
rem  unsigned, which means SmartScreen will warn anyone who downloads it — that is a
rem  distribution problem needing a certificate, not a reason to avoid the packaged build.
rem ---------------------------------------------------------------------------

setlocal
cd /d "%~dp0"

if not exist "node_modules\electron\dist\electron.exe" (
  echo.
  echo   Electron is not installed. Run:  npm install
  echo.
  pause
  exit /b 1
)

if not exist "dist\cli.js" (
  echo.
  echo   The engine is not built. Run:  npm run build
  echo.
  pause
  exit /b 1
)

rem `start ""` so the console window does not stay open behind the app. The empty quotes are the
rem window TITLE argument — without them, start treats the exe path as the title and does nothing.
start "" "node_modules\electron\dist\electron.exe" "."
endlocal

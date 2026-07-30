@echo off
rem ---------------------------------------------------------------------------
rem  Launch redbot as a desktop app WITHOUT a packaged build.
rem
rem  WHY THIS EXISTS.
rem
rem  Smart App Control (Windows 11) blocks unsigned executables outright — it is not the
rem  one-click "Run anyway" SmartScreen prompt. Measured on this machine:
rem
rem      release\win-unpacked\redbot.exe
rem        -> "was blocked by your organization's Device Guard policy"
rem
rem  and HKLM\SYSTEM\CurrentControlSet\Control\CI\Policy has
rem  VerifiedAndReputablePolicyState = 1. Neither artefact carried a Mark-of-the-Web, so this
rem  was never about the file having been downloaded: SAC checks EVERY executable.
rem
rem  A code-signing certificate would not fix it on its own either — Microsoft's own guidance
rem  says signed binaries still have to accumulate reputation, and that EV no longer buys an
rem  exemption.
rem
rem  What IS permitted is Electron's official prebuilt binary, which is signed and has
rem  reputation. So this runs the SAME application code through that binary instead of through
rem  a packaged copy. It is not a bypass and it weakens nothing: the app, the database and the
rem  console are identical — only the executable that hosts them differs.
rem
rem  For testing, this is the path. Packaging is for distribution, and distribution is what
rem  needs the certificate.
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

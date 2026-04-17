@echo off
REM ============================================
REM  BUD - EOD Runner
REM ============================================

REM Set working directory to script location
cd /d "%~dp0"

REM Run BUD in scheduled mode
node index.js --scheduled

exit /b %ERRORLEVEL%

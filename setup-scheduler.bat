@echo off

echo.
echo  ====================================
echo   BUD - Task Scheduler Setup
echo  ====================================
echo.

REM Get the directory of this script
set SCRIPT_DIR=%~dp0
set BAT_PATH=%SCRIPT_DIR%run-bud.bat

echo  Script path: %BAT_PATH%
echo.

REM Create scheduled task for 6:00 PM every weekday (Mon-Fri)
schtasks /create /tn "BUD_EOD_Report" /tr "\"%BAT_PATH%\"" /sc weekly /d MON,TUE,WED,THU,FRI /st 18:00 /f /rl HIGHEST

if %ERRORLEVEL% EQU 0 (
    echo.
    echo  ✅ Task "BUD_EOD_Report" created successfully!
    echo  📅 Schedule: Mon-Fri at 6:00 PM
    echo.
    echo  To modify the time, open Task Scheduler or run:
    echo    schtasks /change /tn "BUD_EOD_Report" /st HH:MM
    echo.
    echo  To run manually:
    echo    schtasks /run /tn "BUD_EOD_Report"
    echo.
    echo  To delete the task:
    echo    schtasks /delete /tn "BUD_EOD_Report" /f
    echo.
) else (
    echo.
    echo  ❌ Failed to create task. 
    echo  Make sure you're running this as Administrator!
    echo.
)

pause

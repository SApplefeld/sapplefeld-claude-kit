@echo off
rem Execution-policy-proof entry point for doctor.ps1: a fresh machine's
rem default policy blocks .ps1 files, and a blocked script cannot fix the
rem policy that blocks it. Usage: doctor.cmd [-Fix]
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0doctor.ps1" %*
exit /b %ERRORLEVEL%

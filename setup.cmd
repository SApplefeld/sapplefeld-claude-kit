@echo off
rem Execution-policy-proof entry point for setup.ps1: a fresh machine's
rem default policy blocks .ps1 files before setup can run at all.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" %*
exit /b %ERRORLEVEL%

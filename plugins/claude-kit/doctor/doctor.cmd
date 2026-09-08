@echo off
rem Execution-policy-proof entry point for doctor.ps1: a fresh machine's
rem default policy blocks .ps1 files, and a blocked script cannot fix the
rem policy that blocks it. Usage: doctor.cmd [-Fix] [-Yes]
rem cmd.exe resolves a bare command name against the current directory before
rem PATH, and it reads NoDefaultCurrentDirectoryInExePath from its own
rem environment, so setting it here closes that search for the launch below.
rem This copy is invoked by absolute path from whatever directory the caller is
rem in, so the exposed directory is that one rather than this wrapper's: the
rem script beside this wrapper stays out of the caller's reach while the
rem interpreter would not have. Setting the variable is preferred over naming an
rem absolute path, which would depend on %SystemRoot% and so trade one
rem caller-influenced value for another.
set "NoDefaultCurrentDirectoryInExePath=1"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0doctor.ps1" %*
exit /b %ERRORLEVEL%

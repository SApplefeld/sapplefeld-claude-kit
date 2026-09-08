@echo off
rem Execution-policy-proof entry point for doctor.ps1: a fresh machine's
rem default policy blocks .ps1 files, and a blocked script cannot fix the
rem policy that blocks it. Usage: doctor.cmd [-Fix] [-Yes]
rem cmd.exe resolves a bare command name against the current directory before
rem PATH, and it reads NoDefaultCurrentDirectoryInExePath from its own
rem environment, so setting it here closes that search for the launch below.
rem This wrapper is documented as being run from a clone's root, which is the
rem exposed directory: an unread clone carrying its own powershell.exe would
rem otherwise supply the interpreter. Setting the variable is preferred over
rem naming an absolute path, which would depend on %SystemRoot% and so trade one
rem caller-influenced value for another.
set "NoDefaultCurrentDirectoryInExePath=1"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0doctor.ps1" %*
exit /b %ERRORLEVEL%

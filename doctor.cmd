@echo off
rem Execution-policy-proof entry point for doctor.ps1: a fresh machine's
rem default policy blocks .ps1 files, and a blocked script cannot fix the
rem policy that blocks it. Usage: doctor.cmd [-Fix] [-Yes]
rem cmd.exe resolves a bare command name against the current directory before
rem PATH, and it reads NoDefaultCurrentDirectoryInExePath from its own
rem environment, so setting it here closes that search for the launch below.
rem This wrapper is documented as being run from a clone's root, which is the
rem exposed directory: an unread clone carrying its own powershell.exe would
rem otherwise supply the interpreter.
rem setlocal scopes the setting to this wrapper. A batch file started from an
rem interactive prompt runs inside the caller's own cmd.exe, so an unscoped set
rem would change how every later command that caller types resolves, for the
rem life of that shell. The implicit endlocal preserves the exit code, so the
rem propagation below is unaffected.
rem What this closes is the interpreter hop and nothing before it: cmd.exe
rem resolves this wrapper's own name against the current directory ahead of
rem PATH and ahead of any line here, so a file of this name in the caller's
rem directory is reached first, and only the caller's environment closes that.
rem PATH order stays open either way, which is why naming an absolute path
rem under %SystemRoot% is an alternative rather than a weaker form: it closes
rem the PATH leg and leaves this one, and depends on %SystemRoot% in turn.
setlocal
set "NoDefaultCurrentDirectoryInExePath=1"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0doctor.ps1" %*
exit /b %ERRORLEVEL%

@echo off
rem Execution-policy-proof entry point for doctor.ps1: a fresh machine's
rem default policy blocks .ps1 files, and a blocked script cannot fix the
rem policy that blocks it. Usage: doctor.cmd [-Fix] [-Yes]
rem cmd.exe resolves a bare command name against the current directory before
rem PATH, and it reads NoDefaultCurrentDirectoryInExePath from its own
rem environment, so setting it here closes that search for the launch below.
rem This copy is invoked by absolute path from whatever directory the caller is
rem in, so the exposed directory is that one rather than this wrapper's. The
rem script this launches is named through %~dp0, which is this wrapper's own
rem directory and is therefore fixed; the bare interpreter name is not, which
rem is the gap the setting closes.
rem setlocal scopes the setting to this wrapper. A batch file started from an
rem interactive prompt runs inside the caller's own cmd.exe, so an unscoped set
rem would change how every later command that caller types resolves, for the
rem life of that shell. The implicit endlocal preserves the exit code, so the
rem propagation below is unaffected.
rem What this closes is the interpreter hop and nothing before it: cmd.exe
rem resolves this wrapper's own name against the current directory ahead of
rem PATH and ahead of any line here, so a file of this name in the caller's
rem directory is reached first, and only the caller's environment closes that.
rem PATH order stays open here. An absolute interpreter path under %SystemRoot%
rem would close both that leg and this one, so it is the stronger guard on this
rem hop; it is not taken because it depends on %SystemRoot%, which is itself a
rem caller-supplied value, and it closes nothing on the wrapper's own hop above.
setlocal
set "NoDefaultCurrentDirectoryInExePath=1"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0doctor.ps1" %*
exit /b %ERRORLEVEL%

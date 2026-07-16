---
name: kit-doctor
description: "Validate and repair this machine's claude-kit installation. Use when the kit was just installed or updated on a machine, when a kit capability misbehaves (compaction, summarizer, resume relay, hooks, doctrine not loading), or when I ask to run the doctor, check the install, or verify kit setup."
---

# Kit Doctor

One command validates the whole install and names the fix for anything missing. The doctor ships inside the plugin payload, so every machine with the plugin has it; there is nothing to fetch first.

## Locate the doctor

Take the first path that exists:

1. `<plugin root>\doctor\doctor.cmd` - the installed plugin's own copy (`CLAUDE_PLUGIN_ROOT` when the harness provides it, else this skill's base directory's grandparent).
2. `<kitRepoPath>\plugins\claude-kit\doctor\doctor.cmd`, where `kitRepoPath` comes from `~/.claude/claude-kit.local.json` - the machine's registered dev clone.
3. `doctor.cmd` at the cwd's repo root, when working inside a kit clone. Last resort only; prefer 1 and 2.

Before invoking any located `doctor.cmd`, verify it is the real kit doctor: for path 1, `..\.claude-plugin\plugin.json` must exist beside its parent; for paths 2 and 3, `plugins\claude-kit\.claude-plugin\plugin.json` must exist under the same root. A `doctor.cmd` that fails that shape check is not the kit's; surface it instead of running it.

Always invoke the `.cmd` wrapper, not the `.ps1`: a fresh machine's execution policy blocks `.ps1` files, and the wrapper bypasses that for exactly this script.

## Run it

- **Check first, always:** run with no flags and show me the PASS/WARN/FAIL lines with a one-line reading of each WARN and FAIL (what breaks because of it, and the printed remediation).
- **`-Fix` on my word:** it applies durable repairs (execution policy, bun PATH wiring, kaizen signpost and git hooks on a clone, a consent-gated relay re-arm or watcher refresh) and prompts before installing anything. Do not run it unprompted.
- **`-Fix -Yes` only when I say unattended:** `-Yes` pre-answers install prompts (bun via winget). Name that before running it. A `-Fix` run through a tool shell cannot show me its install prompt (the doctor declines on a redirected stdin), so when an install is needed, ask me in chat first and then pass `-Yes`.
- **`-NoProbe`** skips the CLI login probe (the one check that spends a model call, a single Haiku call, and needs the network) and the relay round-trip probes (the checks that write synthetic relay state). Use it when I ask for a fast or offline pass.

## Interpret

- Exit 0 with warnings is a working install with named gaps; exit 1 means something the kit depends on is broken.
- The login WARN means the compaction summarizer and headless chain-mode workers cannot run on that machine until `claude /login` is run once in a terminal. That command is mine to run, not yours: hand it to me as a step, never attempt an authentication flow yourself.
- The doctrine-freshness WARN usually means the installed plugin lags the clone (or the reverse); the doctrine-refresh hook resyncs on the next session once the plugin is current. No manual file copying.
- Relay lines report three separate planes, plus a failures count; read them separately rather than as one "relay broken" verdict:
  - `Resume relay` is the durable watcher plane (process alive, deployed copy current, Startup shortcut, window.txt present). `-Fix` repairs this plane (consent-gated re-arm or refresh, deferred while a request is pending); first-time arming and the AutoHotkey install stay with `arm-resume-relay.ps1`. An armed relay also self-refreshes at session start after a kit update, so a stale-watcher WARN usually clears itself.
  - `Relay attended path` proves the watcher resolves and would type into this session's own window (a marker-protected dryrun that is never actually typed). A PASS here is the green light for attended runs in this window, whatever the fallback line says.
  - `Relay fallback target` is environmental: whether the fallback expression (the `window.txt` snapshot the watcher read at its startup) resolves to exactly one window right now. A WARN affects headless-origin resumes only (background sessions, scheduled runs); attended sessions capture their own window per request and never use the fallback. Remediation: open or retitle a window matching the expression (resolution is per-request, no restart), or edit `window.txt` to the intended expression and re-run `arm-resume-relay.ps1` (the file is read only at watcher startup, so re-arming, which restarts the watcher, is what applies an edit; the arm script never captures the window it is run from).
  - `Resume relay failures` counts unattended runs that never auto-resumed. Triage each against real git state before resuming anything: a stall whose work already landed via pushed commits and plan-doc Chapters needs no resume, just the reap.

After a `-Fix` run, re-run check mode and report the delta (which lines flipped), plus anything the fix changed on the machine (PATH, execution policy, installed software) in one line each.

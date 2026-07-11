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
- **`-Fix` on my word:** it applies durable repairs (execution policy, bun PATH wiring, kaizen signpost and git hooks on a clone) and prompts before installing anything. Do not run it unprompted.
- **`-Fix -Yes` only when I say unattended:** `-Yes` pre-answers install prompts (bun via winget). Name that before running it. A `-Fix` run through a tool shell cannot show me its install prompt (the doctor declines on a redirected stdin), so when an install is needed, ask me in chat first and then pass `-Yes`.
- **`-NoProbe`** skips the CLI login probe, the one check that spends a model call (a single Haiku call) and needs the network. Use it when I ask for a fast or offline pass.

## Interpret

- Exit 0 with warnings is a working install with named gaps; exit 1 means something the kit depends on is broken.
- The login WARN means the compaction summarizer and headless chain-mode workers cannot run on that machine until `claude /login` is run once in a terminal. That command is mine to run, not yours: hand it to me as a step, never attempt an authentication flow yourself.
- The doctrine-freshness WARN usually means the installed plugin lags the clone (or the reverse); the doctrine-refresh hook resyncs on the next session once the plugin is current. No manual file copying.
- Relay WARNs route to `arm-resume-relay.ps1` (it owns AutoHotkey install and arming); the doctor only detects.

After a `-Fix` run, re-run check mode and report the delta (which lines flipped), plus anything the fix changed on the machine (PATH, execution policy, installed software) in one line each.

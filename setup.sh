#!/usr/bin/env sh
# Dev-clone setup for the claude-kit repo: record the kaizen signpost and wire git
# hooks. Run from the repo root: ./setup.sh
#
# POSIX only. On Windows these first-run duties live in doctor: doctor.cmd -Fix
# does setup and verification in one pass. This script remains the POSIX path
# until a doctor.sh exists (tracked in docs/backlog.md).
#
# The operating doctrine ships via the plugin now (the operating-instructions
# skill), so setup no longer installs a user-level CLAUDE.md. On Claude Code the
# doctrine-refresh hook maintains ~/.claude/claude-kit-doctrine.md and your
# ~/.claude/CLAUDE.md imports it with one line (see the Next hints).

set -e

# Resolve Paths.
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
TARGET_DIR="$HOME/.claude"

# Validate this is the kit repo (so the signpost's kitRepoPath is meaningful).
if [ ! -f "$SCRIPT_DIR/plugins/claude-kit/.claude-plugin/plugin.json" ]; then
    echo "Not the claude-kit repo root (plugins/claude-kit/.claude-plugin/plugin.json missing). Run from the repo root." >&2
    exit 1
fi

# Ensure Target Directory.
mkdir -p "$TARGET_DIR"

# Record the kaizen signpost: where this machine's kit clone lives, so kaizen
# capture (the kaizen skill) can find the clone from any project. Machine-local,
# never committed.
SIGNPOST="$TARGET_DIR/claude-kit.local.json"
MACHINE=$(hostname 2>/dev/null || echo unknown)
printf '{\n  "kitRepoPath": "%s",\n  "machine": "%s"\n}\n' "$SCRIPT_DIR" "$MACHINE" > "$SIGNPOST"
echo "Recorded kaizen signpost at $SIGNPOST"

# Wire Git Hooks. Make the hook + build script executable and point this clone at
# .githooks so the pre-commit hook rebuilds plugins/claude-kit.zip when plugin
# sources change.
if command -v git >/dev/null 2>&1; then
    chmod +x "$SCRIPT_DIR/.githooks/pre-commit" "$SCRIPT_DIR/build.sh" 2>/dev/null || true
    git -C "$SCRIPT_DIR" config core.hooksPath .githooks
    echo "Configured git core.hooksPath -> .githooks"
else
    echo "git not found; skipped hook wiring. Run later: git config core.hooksPath .githooks" >&2
fi

echo "Next:"
echo "  1. Install the plugin:  /plugin marketplace add <your-github-username>/claude-kit ; /plugin install claude-kit@applefeld"
echo "  2. (Claude Code, once per machine) add to ~/.claude/CLAUDE.md so the doctrine loads always-on:  @claude-kit-doctrine.md"
echo "  3. (Cowork/Chat, once per account) add to your account preferences:  Before any non-trivial task, consult the operating-instructions skill."

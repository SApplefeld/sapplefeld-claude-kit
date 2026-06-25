#!/usr/bin/env sh
# Install home/CLAUDE.md as the user-level CLAUDE.md, backing up any existing file.
# Run from the repo root: ./setup.sh

set -e

# Resolve Paths.
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SOURCE="$SCRIPT_DIR/home/CLAUDE.md"
TARGET_DIR="$HOME/.claude"
TARGET="$TARGET_DIR/CLAUDE.md"

# Validate Source.
if [ ! -f "$SOURCE" ]; then
    echo "home/CLAUDE.md not found next to setup.sh. Run from the repo root." >&2
    exit 1
fi

# Ensure Target Directory.
mkdir -p "$TARGET_DIR"

# Back Up Existing File.
if [ -f "$TARGET" ]; then
    BACKUP="$TARGET.bak.$(date +%Y%m%d-%H%M%S)"
    cp "$TARGET" "$BACKUP"
    echo "Existing CLAUDE.md backed up to $BACKUP"
fi

# Install.
cp "$SOURCE" "$TARGET"
echo "Installed $SOURCE -> $TARGET"

# Record the kaizen signpost: where this machine's kit clone lives, so kaizen
# capture can find it from any project. Machine-local, never committed.
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

echo "Next: /plugin marketplace add <your-github-username>/claude-kit ; /plugin install claude-kit@applefeld (user scope)"

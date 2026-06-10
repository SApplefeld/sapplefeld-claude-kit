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
echo "Next: /plugin marketplace add <your-github-username>/claude-kit ; /plugin install claude-kit@applefeld (user scope)"

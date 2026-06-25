#!/usr/bin/env sh
# build.sh - Package the claude-kit plugin into an installable zip (POSIX parity
# with build.ps1). Produces plugins/claude-kit.zip with claude-kit/ at the
# archive root. build.ps1 is the canonical builder on Windows; this path is for
# Linux/macOS, where the `zip` command is normally available.

set -eu

# Resolve Paths.
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PLUGIN_NAME=claude-kit
SOURCE_DIR="$SCRIPT_DIR/plugins/$PLUGIN_NAME"
ZIP_PATH="$SCRIPT_DIR/plugins/$PLUGIN_NAME.zip"

# Validate Tooling.
if ! command -v zip >/dev/null 2>&1; then
    echo "build.sh requires the 'zip' command. On Windows use build.ps1 instead." >&2
    exit 1
fi

# Validate Source.
if [ ! -d "$SOURCE_DIR" ]; then
    echo "Plugin source not found: $SOURCE_DIR" >&2
    exit 1
fi

# Recreate Archive From Scratch. Zipping from plugins/ stores claude-kit/ at the
# archive root. -X drops platform extra-attributes for more reproducible output.
rm -f "$ZIP_PATH"
cd "$SCRIPT_DIR/plugins"
zip -r -X -q "$PLUGIN_NAME.zip" "$PLUGIN_NAME" \
    -x "*/.DS_Store" -x "*/Thumbs.db" -x "*/desktop.ini"

echo "Built $ZIP_PATH"

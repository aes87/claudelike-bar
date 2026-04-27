#!/usr/bin/env bash
# Publishes the current package.json version to VS Code Marketplace + Open VSX.
#
# The two registries require different `name` fields because Microsoft
# permanently reserved `claudelike-bar` after a deletion. This script flips
# the slug, builds, publishes, and restores canonical (hyphenated) state.
#
# Required env vars:
#   AZURE_DEVOPS_PAT   — vsce PAT for the harteWired publisher
#   OVSX_PAT           — ovsx PAT for the harteWired namespace
#
# Or with secrets-manager:
#   AZURE_DEVOPS_PAT=$(node /workspace/projects/secrets-manager/bin/secrets.js get azure AZURE_DEVOPS_PAT) \
#   OVSX_PAT=$(node /workspace/projects/secrets-manager/bin/secrets.js get openvsx OVSX_PAT) \
#   ./scripts/publish.sh

set -euo pipefail

cd "$(dirname "$0")/.."

: "${AZURE_DEVOPS_PAT:?need AZURE_DEVOPS_PAT}"
: "${OVSX_PAT:?need OVSX_PAT}"

VERSION=$(node -p "require('./package.json').version")
HYPHEN_NAME="claudelike-bar"
NOHYPHEN_NAME="claudelikebar"
HYPHEN_DISPLAY="Claudelike Bar"
NOHYPHEN_DISPLAY="Claudelike-Bar"

restore() {
  sed -i "s/\"name\": \"$NOHYPHEN_NAME\"/\"name\": \"$HYPHEN_NAME\"/" package.json
  sed -i "s/\"displayName\": \"$NOHYPHEN_DISPLAY\"/\"displayName\": \"$HYPHEN_DISPLAY\"/" package.json
}
trap restore EXIT

rm -f "$HYPHEN_NAME-$VERSION.vsix" "$NOHYPHEN_NAME-$VERSION.vsix"

echo "==> Open VSX: building + publishing $HYPHEN_NAME@$VERSION"
npm run package
npx ovsx publish "$HYPHEN_NAME-$VERSION.vsix" -p "$OVSX_PAT"

echo "==> VS Code Marketplace: building + publishing $NOHYPHEN_NAME@$VERSION"
sed -i "s/\"name\": \"$HYPHEN_NAME\"/\"name\": \"$NOHYPHEN_NAME\"/" package.json
sed -i "s/\"displayName\": \"$HYPHEN_DISPLAY\"/\"displayName\": \"$NOHYPHEN_DISPLAY\"/" package.json
npm run package
npx vsce publish -p "$AZURE_DEVOPS_PAT" --packagePath "$NOHYPHEN_NAME-$VERSION.vsix"

echo "==> Done. Both registries at v$VERSION."

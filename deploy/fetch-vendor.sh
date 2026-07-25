#!/usr/bin/env bash
# Descarrega o Three.js para ser servido localmente pelo orchestrator.
#
# Porquê local e não CDN: o escritório 3D corre no ecrã exterior de um
# telemóvel, muitas vezes em dados móveis. Servir da própria VPS arranca
# mais depressa e não depende de o CDN estar de pé.
set -euo pipefail

VERSION="0.161.0"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$ROOT/orchestrator/public/vendor"

mkdir -p "$DEST"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "==> A descarregar three@$VERSION"
cd "$TMP"
npm pack "three@$VERSION" --silent >/dev/null
tar -xzf "three-$VERSION.tgz"
cp package/build/three.module.min.js "$DEST/three.module.min.js"

echo "==> Pronto: $DEST/three.module.min.js ($(du -h "$DEST/three.module.min.js" | cut -f1))"

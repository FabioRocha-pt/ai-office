#!/usr/bin/env bash
# =============================================================
# Compila o APK da app "Consultoria" na própria VPS.
#
# Porquê na VPS: precisa do SDK Android e do Gradle, que vêm de
# dl.google.com e services.gradle.org. A VPS tem internet livre;
# assim não precisas de Android Studio nem de PC.
#
# Primeira execução: ~10 min e ~3 GB de disco (SDK + Gradle).
# Execuções seguintes: menos de um minuto.
#
#   ./build-apk.sh
# =============================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_DIR="$ROOT/android"
SDK_DIR="${ANDROID_SDK_ROOT:-$HOME/android-sdk}"
GRADLE_VERSION="8.7"
GRADLE_DIR="$HOME/gradle-$GRADLE_VERSION"
CMDLINE_ZIP="commandlinetools-linux-11076708_latest.zip"

echo "==> Java 17 (o AGP 8.5 exige 17; o 21 dá erro)"
if ! java -version 2>&1 | grep -q '"17'; then
  apt-get update -qq
  apt-get install -y -qq openjdk-17-jdk unzip curl
fi
export JAVA_HOME="$(dirname "$(dirname "$(readlink -f "$(which javac)")")")"
if [ -d /usr/lib/jvm/java-17-openjdk-amd64 ]; then
  export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
fi
echo "    JAVA_HOME=$JAVA_HOME"
"$JAVA_HOME/bin/java" -version 2>&1 | head -1

echo "==> SDK Android"
if [ ! -d "$SDK_DIR/cmdline-tools/latest" ]; then
  mkdir -p "$SDK_DIR/cmdline-tools"
  cd /tmp
  curl -fsSL -o "$CMDLINE_ZIP" "https://dl.google.com/android/repository/$CMDLINE_ZIP"
  unzip -q -o "$CMDLINE_ZIP" -d "$SDK_DIR/cmdline-tools"
  mv "$SDK_DIR/cmdline-tools/cmdline-tools" "$SDK_DIR/cmdline-tools/latest"
  rm -f "$CMDLINE_ZIP"
fi
export ANDROID_SDK_ROOT="$SDK_DIR"
export ANDROID_HOME="$SDK_DIR"
export PATH="$SDK_DIR/cmdline-tools/latest/bin:$PATH"

echo "==> Licenças e componentes"
yes | sdkmanager --licenses >/dev/null 2>&1 || true
sdkmanager --install "platform-tools" "platforms;android-34" "build-tools;34.0.0" >/dev/null

echo "==> Gradle $GRADLE_VERSION"
if [ ! -x "$GRADLE_DIR/bin/gradle" ]; then
  cd /tmp
  curl -fsSL -o gradle.zip "https://services.gradle.org/distributions/gradle-$GRADLE_VERSION-bin.zip"
  unzip -q -o gradle.zip -d "$HOME"
  rm -f gradle.zip
fi
export PATH="$GRADLE_DIR/bin:$PATH"
gradle --version | grep Gradle

echo "==> A compilar"
cd "$ANDROID_DIR"
gradle assembleRelease --no-daemon -q

APK="$ANDROID_DIR/app/build/outputs/apk/release/app-release.apk"
[ -f "$APK" ] || APK="$ANDROID_DIR/app/build/outputs/apk/release/app-release-unsigned.apk"

if [ ! -f "$APK" ]; then
  echo "!! Não encontrei o APK. Procura em app/build/outputs/apk/"
  find "$ANDROID_DIR/app/build/outputs" -name "*.apk" 2>/dev/null || true
  exit 1
fi

# Publica na pasta servida pelo orchestrator, para descarregares do telemóvel
PUBLIC="$ROOT/orchestrator/public/download"
mkdir -p "$PUBLIC"
cp "$APK" "$PUBLIC/consultoria.apk"

echo ""
echo "=================================================================="
echo " APK pronto:"
echo "   $PUBLIC/consultoria.apk    ($(du -h "$APK" | cut -f1))"
echo ""
echo " Descarrega no telemóvel abrindo:"
echo "   http://SEU_IP:3000/download/consultoria.apk"
echo "=================================================================="

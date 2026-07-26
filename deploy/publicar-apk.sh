#!/usr/bin/env bash
# Serve o APK a partir da tua VPS, para o telemóvel o descarregar direto.
#
# Alternativa à Release do GitHub, e mais rápida para testar seguido:
# põe o APK numa pasta que o orchestrator já serve, e fica atrás da
# mesma autenticação do painel — ninguém descarrega sem a password.
set -euo pipefail

APK="${1:-}"
DESTINO="/root/ai-office/orchestrator/public/apk"

if [ -z "$APK" ] || [ ! -f "$APK" ]; then
  echo "Uso: $0 /caminho/para/daisy.apk"
  echo
  echo "Para trazer o APK do GitHub para a VPS, com o gh CLI:"
  echo "  gh run download --name daisy-apk --dir /tmp/apk"
  echo "  $0 /tmp/apk/*.apk"
  exit 1
fi

mkdir -p "$DESTINO"
cp "$APK" "$DESTINO/daisy.apk"
chmod 644 "$DESTINO/daisy.apk"

TAMANHO=$(du -h "$DESTINO/daisy.apk" | cut -f1)
IP=$(hostname -I | awk '{print $1}')

echo "APK publicado ($TAMANHO)"
echo
echo "No telemóvel, abre:"
echo "  http://169.58.37.101:3000/apk/daisy.apk"
echo
echo "O browser vai pedir utilizador e password (as mesmas do painel)."
echo "Depois é preciso autorizar 'instalar apps de fontes desconhecidas'"
echo "para o Chrome — o Android pergunta na altura."

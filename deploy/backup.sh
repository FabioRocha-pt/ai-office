#!/usr/bin/env bash
# =============================================================
# Cópia de segurança do vault e da configuração.
#
# O vault é a única cópia de tudo o que o escritório construiu. Se o
# disco encher ou a VPS morrer, perde-se. Isto guarda um arquivo por dia
# e mantém os últimos 14.
#
# Instalar como tarefa diária às 4 da manhã:
#   chmod +x deploy/backup.sh
#   (crontab -l 2>/dev/null; echo "0 4 * * * /root/ai-office/deploy/backup.sh") | crontab -
# =============================================================
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESTINO="${BACKUP_DIR:-/root/backups}"
MANTER="${BACKUP_KEEP:-14}"
DATA="$(date +%Y-%m-%d_%H%M)"

mkdir -p "$DESTINO"

# Espaço: um backup que enche o disco é pior que nenhum.
LIVRE_MB=$(df -Pm "$DESTINO" | awk 'NR==2{print $4}')
if [ "$LIVRE_MB" -lt 500 ]; then
  echo "!! Só ${LIVRE_MB}MB livres em $DESTINO. Não vou arriscar encher o disco."
  exit 1
fi

ARQUIVO="$DESTINO/ai-office_$DATA.tar.gz"

echo "==> A arquivar vault e configuração"
# node_modules fora: reinstalam-se com um comando e são a maior parte do peso
tar -czf "$ARQUIVO" \
  --exclude='node_modules' \
  --exclude='.next' \
  --exclude='out' \
  -C "$RAIZ" \
  $( [ -d "$RAIZ/vault" ] && echo vault ) \
  $( [ -f "$RAIZ/assignments.json" ] && echo assignments.json ) \
  $( [ -f "$RAIZ/models.json" ] && echo models.json ) \
  $( [ -f "$RAIZ/.env" ] && echo .env ) \
  2>/dev/null || true

if [ ! -s "$ARQUIVO" ]; then
  echo "!! O arquivo saiu vazio. O vault existe?"
  exit 1
fi

echo "==> $(du -h "$ARQUIVO" | cut -f1)  $ARQUIVO"

# Rotação: fica só com os mais recentes
QUANTOS=$(ls -1t "$DESTINO"/ai-office_*.tar.gz 2>/dev/null | wc -l)
if [ "$QUANTOS" -gt "$MANTER" ]; then
  ls -1t "$DESTINO"/ai-office_*.tar.gz | tail -n +$((MANTER + 1)) | while read -r velho; do
    echo "    a remover antigo: $(basename "$velho")"
    rm -f "$velho"
  done
fi

echo "==> Pronto. $(ls -1 "$DESTINO"/ai-office_*.tar.gz | wc -l) cópias guardadas."
echo ""
echo "Para restaurar:"
echo "  tar -xzf $ARQUIVO -C /root/ai-office"

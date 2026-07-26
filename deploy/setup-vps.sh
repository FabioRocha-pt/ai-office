#!/usr/bin/env bash
# =============================================================
# Setup inicial da VPS Contabo para o "AI Office"
# Corre como root (ou com sudo) numa Ubuntu 22.04/24.04 limpa.
# =============================================================
set -euo pipefail

echo "==> A atualizar o sistema..."
apt update && apt upgrade -y

echo "==> A instalar dependências base (git, build tools, ufw)..."
apt install -y curl git build-essential ufw

echo "==> A instalar Node.js 20 LTS..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

echo "==> Versões instaladas:"
node -v
npm -v

echo "==> A instalar pm2 (gestor de processos)..."
npm install -g pm2

echo "==> A configurar firewall básico..."
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 3000/tcp   # porta do orchestrator (temporário, até teres nginx/proxy)
# Intervalo de preview: as plataformas com servidor (nextjs-server,
# nextjs-pagamentos) correm cada uma na sua porta deste intervalo. Sem
# isto o preview arranca, dá-te um link, e o browser fica a marcar passo
# sem erro que se perceba.
#
# ATENÇÃO: isto expõe à internet servidores escritos por agentes, sem
# autenticação nenhuma. Enquanto não houver password no nginx, usa só em
# modo de teste e fecha o intervalo quando não estiveres a usar.
ufw allow 8100:8149/tcp
ufw --force enable

echo "==> A instalar nginx (para servir o frontend + reverse proxy)..."
apt install -y nginx

echo "==> A instalar as CLIs dos agentes..."
npm install -g @anthropic-ai/claude-code
echo "   (Claude Code instalado — confirma com: claude --version)"

npm install -g @google/gemini-cli || echo "   [aviso] falhou @google/gemini-cli — confirma o nome do pacote em https://github.com/google-gemini/gemini-cli"

npm install -g @openai/codex || echo "   [aviso] falhou @openai/codex — confirma o nome do pacote em https://github.com/openai/codex"

echo ""
echo "=================================================================="
echo " Setup base concluído. Próximos passos manuais (autenticação):"
echo ""
echo " 1) claude          -> segue o login (vai pedir para abrires um URL"
echo "                       no browser do teu telemóvel/PC e autorizares"
echo "                       com a tua conta Claude Pro/Max)"
echo " 2) gemini          -> idem, login com a tua conta Google"
echo " 3) codex           -> idem, login com a tua conta ChatGPT"
echo ""
echo " Corre cada um destes UMA VEZ manualmente e interativamente via SSH"
echo " (ssh -t ainda funciona bem para isto) antes de tentar automatizar."
echo "=================================================================="

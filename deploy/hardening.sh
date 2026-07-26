#!/usr/bin/env bash
# Endurecimento da VPS. Corre uma vez, como root.
#
# A autenticação do orchestrator protege a aplicação. Isto protege a
# máquina — que é outro problema: um IP público com SSH aberto leva
# milhares de tentativas de login por dia, todos os dias, de forma
# automática. Não é alguém a atacar-te em particular; é o fundo do mar
# da internet.
set -euo pipefail

echo "==> fail2ban (bane IPs que falham logins repetidos)"
apt update -qq
apt install -y fail2ban

# A configuração vive em jail.local, nunca em jail.conf: as atualizações
# do pacote reescrevem o .conf e levariam as alterações com elas.
cat > /etc/fail2ban/jail.local <<'EOF'
[DEFAULT]
# 1 hora de banimento após 5 falhas em 10 minutos
bantime  = 1h
findtime = 10m
maxretry = 5
# Reincidentes levam bloqueios progressivamente maiores
bantime.increment = true
bantime.factor = 2
bantime.maxtime = 1w

[sshd]
enabled = true
mode    = aggressive
EOF

systemctl enable --now fail2ban
systemctl restart fail2ban

echo "==> ufw: travar a força-bruta no SSH"
# 'limit' rejeita mais de 6 ligações por 30s do mesmo IP. Complementa o
# fail2ban: age antes de haver falhas de autenticação registadas.
ufw limit OpenSSH

echo "==> SSH: desligar login por password"
# ATENÇÃO: só faz sentido se JÁ tiveres a tua chave pública instalada.
# Correr isto sem chave deixa-te de fora da tua própria máquina.
if [ -s /root/.ssh/authorized_keys ]; then
  sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
  sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
  sed -i 's/^#\?ChallengeResponseAuthentication.*/ChallengeResponseAuthentication no/' /etc/ssh/sshd_config
  systemctl reload ssh || systemctl reload sshd
  echo "    login por password desligado (a tua chave está instalada)"
else
  echo "    SALTADO: /root/.ssh/authorized_keys está vazio."
  echo "    Instala primeiro a tua chave, senão ficas fechado fora da VPS:"
  echo "      no Windows: type %USERPROFILE%\\.ssh\\id_ed25519.pub | ssh root@IP \"cat >> ~/.ssh/authorized_keys\""
fi

echo "==> atualizações de segurança automáticas"
apt install -y unattended-upgrades
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "==> resumo"
ufw status verbose | head -20
echo
fail2ban-client status sshd 2>/dev/null || true
echo
echo "Feito. Para ver quem já foi banido:  fail2ban-client status sshd"
echo "Para desbanir um IP:                fail2ban-client set sshd unbanip <IP>"

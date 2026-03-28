#!/bin/bash
# 4PRO Identity Service - Deploy to VPS2
# Usage: bash deploy.sh

set -e

VPS="root@72.62.155.74"
SSH_KEY="~/.ssh/id_ed25519_vps"
REMOTE_DIR="/var/www/4pro-identity"
PM2_NAME="4pro-identity"
PORT=4100

echo "=== 4PRO Identity Service Deploy ==="

# 1. Test SSH
echo "[1/6] Testing SSH connection..."
ssh -i $SSH_KEY -o ConnectTimeout=10 $VPS "echo 'SSH OK'" || { echo "FAIL: SSH not available"; exit 1; }

# 2. Create directory on VPS if needed
echo "[2/6] Setting up remote directory..."
ssh -i $SSH_KEY $VPS "mkdir -p $REMOTE_DIR"

# 3. Copy project files (exclude node_modules, .env)
echo "[3/6] Uploading files..."
rsync -avz --delete \
  --exclude 'node_modules' \
  --exclude '.env' \
  --exclude '.git' \
  --exclude 'tests' \
  --exclude 'postman' \
  -e "ssh -i $SSH_KEY" \
  . $VPS:$REMOTE_DIR/

# 4. Create production .env on VPS
echo "[4/6] Configuring production environment..."
ssh -i $SSH_KEY $VPS "cat > $REMOTE_DIR/.env << 'ENVEOF'
# 4PRO Identity Service - Production
DATABASE_OWNER_URL=\"postgresql://neondb_owner:npg_PaXcL5yBOI3p@ep-green-heart-agn8mf8n.c-2.eu-central-1.aws.neon.tech/identity_service_db?sslmode=require\"
IDENTITY_DB_URL=\"postgresql://identity_service_user:npg_h2omrcxH5NLU@ep-green-heart-agn8mf8n.c-2.eu-central-1.aws.neon.tech/identity_service_db?sslmode=require\"
DATABASE_URL=\"postgresql://neondb_owner:npg_PaXcL5yBOI3p@ep-green-heart-agn8mf8n.c-2.eu-central-1.aws.neon.tech/identity_service_db?sslmode=require\"
JWT_SECRET=\"4pro-identity-jwt-secret-k9x2m7p4\"
COOKIE_DOMAIN=\".4pro.io\"
COOKIE_SECURE=true
COOKIE_SAMESITE=\"Lax\"
IDENTITY_PORT=$PORT
ENVEOF"

# 5. Install deps and generate Prisma
echo "[5/6] Installing dependencies..."
ssh -i $SSH_KEY $VPS "cd $REMOTE_DIR && npm ci --omit=dev && npx prisma generate"

# 6. Start/restart with PM2
echo "[6/6] Starting service with PM2..."
ssh -i $SSH_KEY $VPS "cd $REMOTE_DIR && pm2 delete $PM2_NAME 2>/dev/null; pm2 start src/server.js --name $PM2_NAME --env production && pm2 save"

# Verify
echo ""
echo "=== Verifying ==="
sleep 3
ssh -i $SSH_KEY $VPS "curl -s http://localhost:$PORT/health"
echo ""

echo "=== Deploy complete! ==="
echo "Identity Service running at http://72.62.155.74:$PORT"
echo "PM2 name: $PM2_NAME"

#!/bin/bash
# LosslessCut Web - Script de inicio

cd "$(dirname "$0")"

echo "🎬 Iniciando LosslessCut Web..."

# Verificar si Docker está corriendo
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker no está corriendo. Iniciando..."
    sudo systemctl start docker
    sleep 2
fi

# Iniciar el contenedor
docker-compose -f backend/docker-compose.yml up -d

echo ""
echo "✅ LosslessCut Web iniciado"
echo "🌐 Accede en: http://localhost:8080"
echo ""
echo "Para ver logs: docker-compose -f backend/docker-compose.yml logs -f"
echo "Para detener:  docker-compose -f backend/docker-compose.yml down"

#!/bin/bash
# Script para ver los logs de LosslessCut Web Edition

echo "📋 Mostrando logs de LosslessCut Web Edition..."
echo "   (Presiona Ctrl+C para salir)"
echo ""

cd backend
docker-compose logs -f --tail=100

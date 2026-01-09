#!/bin/bash
# Script para detener LosslessCut Web Edition

echo "🛑 Deteniendo LosslessCut Web Edition..."
echo ""

cd backend

# Verificar si está corriendo
if ! docker-compose ps | grep -q "Up"; then
    echo "ℹ️  El servidor no está corriendo"
    exit 0
fi

# Detener los contenedores
docker-compose down

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Servidor detenido exitosamente"
    echo ""
    echo "💡 Para volver a iniciar:"
    echo "   ./start.sh"
else
    echo ""
    echo "❌ Error al detener el servidor"
    exit 1
fi

cd ..

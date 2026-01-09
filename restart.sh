#!/bin/bash
# Script para reiniciar LosslessCut Web Edition

echo "🔄 Reiniciando LosslessCut Web Edition..."
echo ""

cd backend

# Verificar si Docker está corriendo
if ! docker info > /dev/null 2>&1; then
    echo "❌ Error: Docker no está corriendo"
    echo "   Por favor inicia Docker primero"
    exit 1
fi

# Reiniciar los contenedores
echo "📦 Reiniciando contenedores Docker..."
docker-compose restart

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Servidor reiniciado exitosamente!"
    echo ""
    echo "📍 Accede a la aplicación en:"
    echo "   http://localhost:8080"
    echo ""

    # Esperar un momento para que el servidor reinicie
    sleep 3

    # Verificar estado
    echo "Estado del contenedor:"
    docker-compose ps
else
    echo ""
    echo "❌ Error al reiniciar el servidor"
    echo "   Revisa los logs con: cd backend && docker-compose logs"
    exit 1
fi

cd ..

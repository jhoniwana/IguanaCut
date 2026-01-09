#!/bin/bash
# Script para reconstruir LosslessCut Web Edition

echo "🔨 Reconstruyendo LosslessCut Web Edition..."
echo ""

# Verificar si Docker está corriendo
if ! docker info > /dev/null 2>&1; then
    echo "❌ Error: Docker no está corriendo"
    echo "   Por favor inicia Docker primero"
    exit 1
fi

cd backend

echo "🛑 Deteniendo contenedores existentes..."
docker-compose down

echo ""
echo "📦 Reconstruyendo imagen Docker..."
docker-compose build

if [ $? -eq 0 ]; then
    echo ""
    echo "🚀 Iniciando contenedores con la nueva imagen..."
    docker-compose up -d

    if [ $? -eq 0 ]; then
        echo ""
        echo "✅ Reconstrucción completada exitosamente!"
        echo ""
        echo "📍 Accede a la aplicación en:"
        echo "   http://localhost:8080"
        echo ""

        # Esperar un momento para que el servidor inicie
        sleep 3

        # Verificar estado
        echo "Estado del contenedor:"
        docker-compose ps
    else
        echo ""
        echo "❌ Error al iniciar el servidor"
        echo "   Revisa los logs con: cd backend && docker-compose logs"
        exit 1
    fi
else
    echo ""
    echo "❌ Error al reconstruir la imagen"
    exit 1
fi

cd ..

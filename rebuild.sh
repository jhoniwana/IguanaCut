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

if [ $? -eq 0 ]; then
    echo ""
    echo "📦 Reconstruyendo e iniciando contenedores..."
    docker-compose up -d --build

    if [ $? -eq 0 ]; then
        echo ""
        echo "✅ Reconstrucción completada exitosamente!"
        echo ""
        echo "📍 Accede a la aplicación en:"
        echo "   http://localhost:8090"
        echo ""

        # Esperar un momento para que el servidor inicie
        sleep 3

        # Verificar estado
        echo "Estado del contenedor:"
        docker-compose ps
    else
        echo ""
        echo "❌ Error al reconstruir/iniciar el servidor"
        echo "   Revisa los logs con: cd backend && docker-compose logs"
        exit 1
    fi
else
    echo ""
    echo "❌ Error al detener contenedores"
    exit 1
fi

cd ..

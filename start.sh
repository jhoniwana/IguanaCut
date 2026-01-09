#!/bin/bash
# Script para iniciar LosslessCut Web Edition

echo "🚀 Iniciando LosslessCut Web Edition..."
echo ""

cd backend

# Verificar si Docker está corriendo
if ! docker info > /dev/null 2>&1; then
    echo "❌ Error: Docker no está corriendo"
    echo "   Por favor inicia Docker primero"
    exit 1
fi

# Verificar si ya está corriendo
if docker-compose ps | grep -q "Up"; then
    echo "ℹ️  El servidor ya está corriendo"
    echo ""
    docker-compose ps
else
    # Iniciar los contenedores
    echo "📦 Iniciando contenedores Docker..."
    docker-compose up -d

    if [ $? -eq 0 ]; then
        echo ""
        echo "✅ Servidor iniciado exitosamente!"
        echo ""
        echo "📍 Accede a la aplicación en:"
        echo "   http://localhost:8080"
        echo ""
        echo "📊 Para ver logs en tiempo real:"
        echo "   cd backend && docker-compose logs -f"
        echo ""
        echo "🛑 Para detener el servidor:"
        echo "   ./stop.sh"
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
fi

cd ..

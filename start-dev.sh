#!/bin/bash

# LosslessCut Web Development Starter
# Quick start script for development environment
# Usage: ./start-dev.sh

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
BACKEND_DIR="/root/losslesscut-web/backend"
FRONTEND_DIR="/root/losslesscut-web"
LOG_DIR="/root/losslesscut-web/logs"

# Create logs directory
mkdir -p "$LOG_DIR"

# Logging functions
log() {
    echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

success() {
    echo -e "${PURPLE}[SUCCESS]${NC} $1"
}

# Check dependencies
check_dependencies() {
    log "Checking dependencies..."
    
    # Check Go
    if ! command -v go &> /dev/null; then
        error "Go is not installed. Please install Go 1.21+"
        exit 1
    fi
    
    # Check Node.js
    if ! command -v node &> /dev/null; then
        error "Node.js is not installed. Please install Node.js 18+"
        exit 1
    fi
    
    # Check Yarn
    if ! command -v yarn &> /dev/null; then
        error "Yarn is not installed. Please install Yarn 4.x"
        exit 1
    fi
    
    # Check FFmpeg
    if ! command -v ffmpeg &> /dev/null; then
        warning "FFmpeg is not installed. Video processing will not work."
        warning "Install with: sudo apt-get install ffmpeg"
    fi
    
    # Check FFprobe
    if ! command -v ffprobe &> /dev/null; then
        warning "FFprobe is not installed. Video metadata extraction will not work."
        warning "Install with: sudo apt-get install ffmpeg"
    fi
    
    success "Dependencies check completed"
}

# Kill existing processes
kill_existing() {
    log "Stopping existing processes..."
    
    # Kill existing processes
    pkill -f "yarn.*dev:web" 2>/dev/null || true
    pkill -f "vite.*--config.*vite.config.web.ts" 2>/dev/null || true
    pkill -f "./server" 2>/dev/null || true
    pkill -f "./lossless-cut-server" 2>/dev/null || true
    pkill -f "air" 2>/dev/null || true
    
    # Wait for processes to die
    sleep 2
    
    log "Existing processes stopped"
}

# Install dependencies
install_dependencies() {
    log "Installing dependencies..."
    
    # Install frontend dependencies
    cd "$FRONTEND_DIR"
    if yarn install > "$LOG_DIR/frontend-install.log" 2>&1; then
        success "Frontend dependencies installed"
    else
        error "Failed to install frontend dependencies. Check $LOG_DIR/frontend-install.log"
        return 1
    fi
    
    # Install backend dependencies (Go modules)
    cd "$BACKEND_DIR"
    if go mod download > "$LOG_DIR/backend-install.log" 2>&1; then
        success "Backend dependencies installed"
    else
        error "Failed to install backend dependencies. Check $LOG_DIR/backend-install.log"
        return 1
    fi
}

# Build backend
build_backend() {
    log "Building backend..."
    cd "$BACKEND_DIR"
    
    if make build > "$LOG_DIR/backend-build.log" 2>&1; then
        success "Backend build successful"
    else
        error "Backend build failed. Check $LOG_DIR/backend-build.log"
        return 1
    fi
}

# Start backend
start_backend() {
    log "Starting backend server..."
    cd "$BACKEND_DIR"
    
    # Start backend in background
    nohup make run > "$LOG_DIR/backend.log" 2>&1 &
    BACKEND_PID=$!
    
    log "Backend started (PID: $BACKEND_PID)"
    echo $BACKEND_PID > /tmp/losslesscut-backend.pid
}

# Start frontend
start_frontend() {
    log "Starting frontend dev server..."
    cd "$FRONTEND_DIR"
    
    # Start frontend in background
    nohup yarn dev:web > "$LOG_DIR/frontend.log" 2>&1 &
    FRONTEND_PID=$!
    
    log "Frontend started (PID: $FRONTEND_PID)"
    echo $FRONTEND_PID > /tmp/losslesscut-frontend.pid
}

# Health check
health_check() {
    log "Performing health checks..."
    
    # Check backend
    for i in {1..10}; do
        if curl -s http://localhost:8080/health > /dev/null 2>&1; then
            success "Backend is healthy (attempt $i)"
            break
        else
            warning "Backend health check attempt $i failed"
            if [ $i -eq 10 ]; then
                error "Backend health check failed after 10 attempts"
                return 1
            fi
        fi
        sleep 2
    done
    
    # Check frontend
    for i in {1..10}; do
        if curl -s http://localhost:3001/ > /dev/null 2>&1; then
            success "Frontend is healthy (attempt $i)"
            break
        else
            warning "Frontend health check attempt $i failed"
            if [ $i -eq 10 ]; then
                error "Frontend health check failed after 10 attempts"
                return 1
            fi
        fi
        sleep 2
    done
    
    success "🎉 All services are healthy!"
}

# Show status
show_status() {
    echo ""
    echo "==================================="
    echo "🚀 LosslessCut Web Development"
    echo "==================================="
    echo ""
    echo "📊 Backend: http://localhost:8080"
    echo "🌐 Frontend: http://localhost:3001"
    echo "📋 API Health: http://localhost:8080/health"
    echo ""
    echo "📝 Logs:"
    echo "   Backend: $LOG_DIR/backend.log"
    echo "   Frontend: $LOG_DIR/frontend.log"
    echo ""
    echo "🛑 Stop services:"
    echo "   ./stop-dev.sh"
    echo ""
    echo "📊 View logs:"
    echo "   tail -f $LOG_DIR/backend.log"
    echo "   tail -f $LOG_DIR/frontend.log"
    echo "==================================="
}

# Main function
main() {
    echo ""
    echo "🎬 LosslessCut Web Development Starter"
    echo "==================================="
    echo ""
    
    # Check dependencies
    check_dependencies
    
    # Kill existing processes
    kill_existing
    
    # Install dependencies
    install_dependencies
    
    # Build backend
    build_backend
    
    # Start services
    start_backend
    sleep 3  # Give backend time to start
    start_frontend
    
    # Health check
    health_check
    
    # Show status
    show_status
    
    echo ""
    success "🎉 LosslessCut Web is now running!"
    info "Open your browser and navigate to:"
    echo ""
    echo -e "${CYAN}   Frontend: http://localhost:3001${NC}"
    echo -e "${CYAN}   Backend API: http://localhost:8080${NC}"
    echo ""
    info "Press Ctrl+C to stop watching logs"
    echo ""
    
    # Show logs
    echo "📊 Showing combined logs (Ctrl+C to exit):"
    echo "==================================="
    
    # Show combined logs
    tail -f "$LOG_DIR/backend.log" "$LOG_DIR/frontend.log" 2>/dev/null || {
        echo "Logs will appear here as services start..."
        sleep 5
        tail -f "$LOG_DIR/backend.log" "$LOG_DIR/frontend.log" 2>/dev/null || true
    }
}

# Setup signal handlers
cleanup() {
    log "Cleaning up..."
    kill_existing
    rm -f /tmp/losslesscut-backend.pid /tmp/losslesscut-frontend.pid
    exit 0
}

trap cleanup SIGINT SIGTERM

# Run main function
main "$@"
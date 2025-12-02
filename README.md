# LosslessCut Web Edition

Web-based lossless video/audio cutting tool powered by **Go + React + FFmpeg**.

## 🚀 Features

### Core Functionality
- **Lossless cutting** of video and audio files
- **Web-based UI** - no installation required
- **I/O workflow** (industry-standard video editing)
- **Waveform visualization** with enhanced rendering
- **Multi-segment editing** with merge/export
- **YouTube video download** via yt-dlp
- **Session management** (save/load projects)
- **Mobile responsive design**

### 🎨 Enhanced UI/UX (NEW)

#### TikTok-Inspired Mobile Interface
- **Modern Mobile Timeline**: Vertical layout with TikTok-style colors and glassmorphism effects
- **Social Media Design**: Dark theme with vibrant gradients (`#fe2c55`, `#25f4ee`)
- **Touch-Optimized Controls**: Swipe gestures and mobile-friendly interactions
- **Visual Feedback**: Smooth animations and micro-interactions

#### Advanced Visual Timeline
- **Enhanced Zoom Controls**: Dedicated panel with +/- buttons and reset
- **Performance Metrics**: Real-time FPS monitoring and optimization status
- **Smooth Animations**: Spring-based transitions and hover effects
- **Precise Navigation**: Click-to-seek and smooth panning

#### Professional Frame-by-Frame Playback
- **Hold Arrow Keys**: Continuous smooth frame stepping
- **Auto-Acceleration**: Speed increases from 1x to 10x after 500ms hold
- **Maximum Performance**: `requestAnimationFrame` optimization for 60fps playback
- **Instant Stop**: Release key to freeze on exact frame

#### Enhanced Download Modal
- **Platform Recognition**: Visual icons for YouTube, Vimeo, TikTok, Instagram, etc.
- **Better Error Handling**: Animated states and user-friendly error messages
- **Supported Sites Showcase**: Visual display of 1000+ supported platforms
- **Progress Tracking**: Real-time download progress with smooth animations

### ⚡ Performance Optimizations

#### Maximum Performance Without Rust/WASM
- **React Optimization**: Memoized components and efficient re-renders
- **CSS Hardware Acceleration**: `transform3d` and `will-change` properties
- **Virtual Scrolling**: Only render visible timeline sections
- **Image Optimization**: WebP format and lazy loading
- **Debounced Events**: Prevent excessive re-renders
- **RequestAnimationFrame**: 60fps smooth animations
- **Direct Video Control**: Bypass React state for instant updates

#### Frame-by-Frame Technical Details
```javascript
// Performance optimizations:
- requestAnimationFrame() instead of setTimeout()
- Direct video.currentTime manipulation (no React re-renders)
- 16ms update intervals (60fps target)
- Hardware video decoding utilization
- Memory-efficient state management
- CancelAnimationFrame cleanup
- Auto-acceleration from 1x to 10x speed
```

### 🎮 Enhanced Controls

#### Timeline Navigation
- **Enhanced Zoom**: Up to 100x zoom for frame-accurate editing
- **Comfort Zoom**: Auto-fit zoom for optimal view
- **Momentum Scrolling**: Physics-based smooth timeline panning
- **Precise Seeking**: Click anywhere on timeline for exact positioning

#### Keyboard Shortcuts (Enhanced)
| Key | Action | Enhancement |
|-----|--------|-------------|
| `Space` | Play/Pause | Standard |
| `I` | Set start point | Standard |
| `O` | Set end point | Standard |
| `←/→` | Seek 1 second | Standard |
| `Shift+←/→` | Seek 0.1 second | Standard |
| `Hold ←/→` | Frame-by-frame playback | **NEW** - Smooth continuous stepping |
| `Ctrl+Wheel` | Precise zoom | **NEW** - Enhanced zoom control |

### 📱 Mobile Enhancements

#### Touch-Optimized Interface
- **Mobile Timeline**: Vertical layout optimized for phone screens
- **Touch Gestures**: Swipe navigation and pinch-to-zoom
- **Responsive Controls**: Adaptive button sizes and spacing
- **Performance Mode**: Optimized for mobile processors

## 🎨 Modern UI Enhancements (NEW)

### TikTok/Instagram-Inspired Mobile Interface
- **Modern Mobile Timeline**: Vertical layout with TikTok-style colors and glassmorphism effects
- **Social Media Design**: Dark theme with vibrant gradients (`#fe2c55`, `#25f4ee`)
- **Touch-Optimized Controls**: Swipe gestures and mobile-friendly interactions
- **Visual Feedback**: Smooth animations and micro-interactions

### Advanced Visual Timeline
- **Thumbnail Generation**: Automatic thumbnail strips for visual timeline navigation
- **Waveform Integration**: Audio visualization with modern styling
- **Drag-and-Drop**: Touch-enabled file management

### Professional Batch Processing
- **Multi-File Workflows**: Drag-and-drop batch processing interface
- **Visual File Management**: Individual file controls with status indicators
- **Batch Operations**: Merge, convert, and export multiple files simultaneously

### Comprehensive Settings Panel
- **Advanced User Preferences**: Full control over application behavior
- **Keyboard Customization**: Configurable shortcuts and modifiers
- **FFmpeg Integration**: Advanced export and processing options
- **Project Management**: Auto-save and workspace preferences

## 🛠 Tech Stack

### Backend
- **Go 1.21+**: High-performance HTTP server
- **Gin Framework**: Fast HTTP router and middleware
- **FFmpeg 6.0+**: Video/audio processing engine
- **yt-dlp**: YouTube and media downloader
- **Viper**: Configuration management
- **Zap**: Structured logging

### Frontend
- **React 18**: Modern UI framework with hooks
- **TypeScript**: Type-safe development
- **Vite**: Fast build tool and dev server
- **Framer Motion**: Smooth animations and gestures
- **CSS Modules**: Scoped styling with TikTok-inspired theming

### Performance Features
- **Hardware Acceleration**: CSS transforms and GPU optimization
- **RequestAnimationFrame**: 60fps smooth animations
- **Lazy Loading**: Images and components load on demand
- **Virtual Scrolling**: Only render visible timeline sections
- **Debounced Events**: Optimized user interaction handling
- **Memoized Components**: Prevent unnecessary re-renders

### Mobile-First Design
- **Responsive Layout**: Optimized for all screen sizes
- **Touch Gestures**: Swipe, pinch, and tap interactions
- **Performance Mode**: Optimized for mobile processors
- **Progressive Enhancement**: Works on any device, better on modern ones

## 🚀 Quick Start

### Prerequisites

- Go 1.21+
- Node.js 18+
- FFmpeg 6.0+
- Yarn 4.x

### Development (Port 80 Focus)

```bash
# Quick development script (builds and serves on port 80)
./dev-80.sh

# Or manual setup:
# Terminal 1: Start Go backend (port 80)
cd backend
make run

# Terminal 2: Make changes, then rebuild
yarn build:web
```

**Access at: http://localhost:80** (or http://YOUR_SERVER_IP)

### Development (Hot Reload)

```bash
# Terminal 1: Start Go backend
cd backend
make run

# Terminal 2: Start React frontend with hot reload
yarn dev:web
```

**Access at: http://localhost:3001** (development with hot reload)

### Production Build

```bash
# Build frontend (outputs to backend/web/)
yarn build:web

# Build and run Go server
cd backend
make build
./server
```

**Access at: http://localhost:80** (production mode)

## Deployment (Hostinger VPS / Cloud Servers)

For cloud servers like Hostinger VPS, you may need to configure the server port and firewall.

### Configuration

Create a `config.yaml` in the `backend/` directory:

```yaml
server:
  host: "0.0.0.0"
  port: 80                    # Use port 80 for HTTP (usually open by default)
  max_upload_size: 10737418240  # 10GB
  production: true
  cors_origins:
    - "*"

storage:
  base_path: "/var/losslesscut"
  auto_cleanup: true
  cleanup_after_days: 7

ffmpeg:
  path: "ffmpeg"
  threads: 0                  # 0 = auto-detect

ytdlp:
  path: "yt-dlp"
  max_quality: "1080p"
```

### Running on Port 80

```bash
# Build and run
yarn build:web
cd backend && make build
./server
```

Access at `http://YOUR_SERVER_IP` (no port needed for port 80)

### Firewall Configuration

If using a cloud provider's firewall (Hostinger, AWS, DigitalOcean, etc.):

1. Log in to your provider's control panel
2. Navigate to **Firewall** or **Security Groups**
3. Open the following ports:
   - **Port 80** (TCP) - HTTP traffic
   - **Port 443** (TCP) - HTTPS traffic (if using SSL)
   - **Port 8080** (TCP) - Alternative port (optional)

### Environment Variables

You can also configure via environment variables (prefix: `LOSSLESSCUT_`):

```bash
export LOSSLESSCUT_SERVER_PORT=80
export LOSSLESSCUT_STORAGE_BASE_PATH=/var/losslesscut
./server
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/videos/upload` | Upload video/audio file |
| GET | `/api/videos/:id/stream` | Stream video |
| DELETE | `/api/videos/:id` | Delete video |
| POST | `/api/projects` | Create project |
| GET | `/api/projects` | List projects |
| GET | `/api/projects/:id` | Get project |
| PUT | `/api/projects/:id` | Update project |
| DELETE | `/api/projects/:id` | Delete project |
| POST | `/api/projects/:id/export` | Export/cut video |
| GET | `/api/operations/:id` | Check export progress |
| GET | `/api/outputs/:filename` | Download exported file |
| POST | `/api/download` | Download from URL (yt-dlp) |
| GET | `/health` | Health check |

## ⌨️ Keyboard Shortcuts

### Standard Controls
| Key | Action |
|-----|--------|
| `Space` | Play/Pause |
| `I` | Set start point |
| `O` | Set end point & create clip |
| `←` | Seek back 1 second |
| `→` | Seek forward 1 second |
| `Shift+←` | Seek back 0.1 second |
| `Shift+→` | Seek forward 0.1 second |

### 🎬 Enhanced Frame-by-Frame Controls (NEW)
| Key | Action | Enhancement |
|-----|--------|-------------|
| `Hold ←/→` | Frame-by-frame playback | **Smooth continuous stepping** |
| `Ctrl+Wheel` | Precise zoom | **Enhanced zoom control** |
| `Hold 500ms+` | Auto-acceleration | **1x to 10x speed ramp-up** |

### 🎯 Timeline Controls (NEW)
| Action | Method | Enhancement |
|--------|---------|-------------|
| **Zoom** | +/- buttons or Ctrl+Wheel | **Up to 100x zoom** |
| **Seek** | Click on timeline | **Precise positioning** |
| **Pan** | Drag or Wheel | **Momentum scrolling** |
| **Reset** | Comfort zoom button | **Auto-fit view** |

## License

GPL-2.0-only

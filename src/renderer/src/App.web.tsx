import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  IoMdCloudDownload, 
  IoMdCloudUpload, 
  IoMdTrash, 
  IoMdGitMerge,
  IoMdRocket,
  IoMdFilm,
  IoMdMusicalNotes,
  IoMdImages,
  IoMdClock,
  IoMdKeypad,
  IoMdSettings
} from 'react-icons/io';
import { 
  FiScissors, 
  FiDownload, 
  FiShield, 
  FiZap,
  FiPlay,
  FiMonitor,
  FiGrid
} from 'react-icons/fi';
import { 
  MdAutoDelete, 
  MdStorage,
  MdVideoLibrary,
  MdSpeed,
  MdTouchApp
} from 'react-icons/md';
import { FaStar, FaCheckCircle, FaArrowRight } from 'react-icons/fa';
import DownloadModal from './components/DownloadModal';
import VideoEditor from './components/VideoEditor';

const generateSessionId = () => 'sess_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();

// Neobrutalist color palette
const colors = {
  bg: '#0a0a0a',
  surface: '#141414',
  border: '#2a2a2a',
  accent1: '#00ff88', // Neon green
  accent2: '#ff6b35', // Orange
  accent3: '#a855f7', // Purple
  accent4: '#00d4ff', // Cyan
  text: '#ffffff',
  textMuted: '#888888',
  danger: '#ff3333',
};

export default function App() {
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [downloadedVideoId, setDownloadedVideoId] = useState<string | null>(null);
  const [isClearing, setIsClearing] = useState(false);
  const [autoCleanup, setAutoCleanup] = useState(true);
  const [stats, setStats] = useState({ videos: 0, downloads: 0, projects: 0 });
  const sessionIdRef = useRef<string>(generateSessionId());
  const heartbeatRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const initSession = async () => {
      try {
        await fetch('/api/system/session/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sessionIdRef.current, auto_clean: autoCleanup }),
        });
      } catch (error) {
        console.error('[Session] Failed to start:', error);
      }
    };

    initSession();
    loadStats();

    heartbeatRef.current = setInterval(async () => {
      try {
        await fetch('/api/system/session/heartbeat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sessionIdRef.current }),
        });
      } catch (error) {}
    }, 30000);

    const handleUnload = () => {
      navigator.sendBeacon('/api/system/session/end', JSON.stringify({
        session_id: sessionIdRef.current,
        cleanup: autoCleanup,
      }));
    };

    window.addEventListener('beforeunload', handleUnload);
    window.addEventListener('unload', handleUnload);

    return () => {
      window.removeEventListener('beforeunload', handleUnload);
      window.removeEventListener('unload', handleUnload);
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    };
  }, []);

  useEffect(() => {
    fetch('/api/system/session/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionIdRef.current, auto_clean: autoCleanup }),
    }).catch(() => {});
  }, [autoCleanup]);

  const loadStats = async () => {
    try {
      const response = await fetch('/api/system/stats');
      if (response.ok) setStats(await response.json());
    } catch (error) {}
  };

  const handleDownloadComplete = (download: any) => {
    setDownloadedVideoId(download.video_id);
    setShowDownloadModal(false);
    setShowEditor(true);
    loadStats();
  };

  const handleClearAll = async () => {
    if (!confirm('DELETE ALL DATA?\n\nThis cannot be undone!')) return;
    setIsClearing(true);
    try {
      await fetch('/api/system/clear-all', { method: 'DELETE' });
      loadStats();
    } catch (error: any) {
      alert(`Failed: ${error.message}`);
    } finally {
      setIsClearing(false);
    }
  };

  const features = [
    {
      icon: <IoMdFilm size={32} />,
      title: 'Lossless Cutting',
      description: 'Professional I/O workflow for frame-accurate video editing without quality loss',
      gradient: colors.accent1,
    },
    {
      icon: <IoMdCloudDownload size={32} />,
      title: 'Smart Downloads',
      description: 'Download from YouTube, Vimeo, and 1000+ platforms with yt-dlp',
      gradient: colors.accent4,
    },
    {
      icon: <FiMonitor size={32} />,
      title: 'Visual Timeline',
      description: 'Modern timeline with thumbnails, waveforms, and intuitive controls',
      gradient: colors.accent2,
    },
    {
      icon: <IoMdKeypad size={32} />,
      title: 'Keyboard Power',
      description: 'Professional keyboard shortcuts for lightning-fast editing',
      gradient: colors.accent3,
    },
    {
      icon: <IoMdImages size={32} />,
      title: 'Screenshot Capture',
      description: 'Extract high-quality frames from any point in your video',
      gradient: colors.accent1,
    },
    {
      icon: <FiGrid size={32} />,
      title: 'Batch Processing',
      description: 'Process multiple files simultaneously with powerful automation',
      gradient: colors.accent4,
    },
  ];

  const shortcuts = [
    { key: 'Space', action: 'Play/Pause', icon: <FiPlay /> },
    { key: 'I', action: 'Set Start Point', icon: <FiScissors /> },
    { key: 'O', action: 'Set End Point', icon: <FiScissors /> },
    { key: '←/→', action: 'Seek 1 Second', icon: <IoMdClock /> },
    { key: 'Shift+←/→', action: 'Seek 0.1 Second', icon: <MdSpeed /> },
  ];

  return (
    <div style={{
      background: colors.bg,
      fontFamily: "'Inter', 'SF Pro', -apple-system, sans-serif",
      height: '100vh',
      overflowY: 'auto',
      overflowX: 'hidden',
    }}>
      {/* Hero Section */}
      <motion.header
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        style={{
          background: colors.surface,
          borderBottom: `4px solid ${colors.accent1}`,
          padding: '24px 20px',
        }}
      >
        <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <motion.div 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 }}
            style={{ display: 'flex', alignItems: 'center', gap: '16px' }}
          >
            <div style={{
              width: '64px',
              height: '64px',
              background: `linear-gradient(135deg, ${colors.accent1}, ${colors.accent4})`,
              border: `3px solid ${colors.accent1}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '32px',
              borderRadius: '12px',
              boxShadow: `0 8px 32px rgba(0, 255, 136, 0.3)`,
            }}>
              🎬
            </div>
            <div>
              <h1 style={{
                margin: 0,
                fontSize: '36px',
                fontWeight: '900',
                background: `linear-gradient(135deg, ${colors.accent1}, ${colors.accent4})`,
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
                letterSpacing: '-1px',
                textTransform: 'uppercase',
                textShadow: `0 0 30px rgba(0, 255, 136, 0.3)`,
              }}>
                LosslessCut
              </h1>
              <p style={{
                margin: '4px 0 0 0',
                fontSize: '14px',
                color: colors.accent1,
                fontWeight: '700',
                textTransform: 'uppercase',
                letterSpacing: '2px',
              }}>
                Professional Web Edition
              </p>
            </div>
          </motion.div>

          {/* Stats badges */}
          <motion.div 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.4 }}
            style={{ display: 'flex', gap: '12px' }}
          >
            {[
              { label: 'VID', value: stats.videos, color: colors.accent1 },
              { label: 'DL', value: stats.downloads, color: colors.accent2 },
              { label: 'PRJ', value: stats.projects, color: colors.accent3 },
            ].map((stat, index) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.6 + index * 0.1 }}
                style={{
                  background: colors.bg,
                  border: `2px solid ${stat.color}`,
                  padding: '8px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  borderRadius: '8px',
                }}
              >
                <span style={{ color: stat.color, fontSize: '20px', fontWeight: '900' }}>{stat.value}</span>
                <span style={{ color: colors.textMuted, fontSize: '11px', fontWeight: '700', textTransform: 'uppercase' }}>{stat.label}</span>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </motion.header>

      {/* Main Content */}
      <main style={{ 
        maxWidth: '1200px', 
        margin: '0 auto', 
        padding: '60px 20px',
        minHeight: 'calc(100vh - 200px)',
      }}>
        {/* Hero CTA */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.8 }}
          style={{ textAlign: 'center', marginBottom: '80px' }}
        >
          <h2 style={{
            fontSize: '3em',
            fontWeight: 'bold',
            background: `linear-gradient(135deg, ${colors.accent1}, ${colors.accent4})`,
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            marginBottom: '1em',
            textShadow: `0 0 30px rgba(0, 255, 136, 0.3)`,
          }}>
            <IoMdRocket style={{ marginRight: '0.2em', verticalAlign: 'middle' }} />
            Edit Like a Pro
          </h2>
          <p style={{
            fontSize: '1.3em',
            color: colors.textMuted,
            marginBottom: '2em',
            maxWidth: '600px',
            marginLeft: 'auto',
            marginRight: 'auto',
            lineHeight: '1.6',
          }}>
            Professional video editing made simple. Cut, trim, and perfect your media with lossless quality and lightning-fast performance.
          </p>
          
          <div style={{ display: 'flex', gap: '20px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <motion.button
              whileHover={{ scale: 1.05, boxShadow: `0 8px 30px rgba(0, 255, 136, 0.4)` }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setShowEditor(true)}
              style={{
                background: `linear-gradient(135deg, ${colors.accent1}, ${colors.accent4})`,
                color: colors.bg,
                padding: '16px 32px',
                borderRadius: '50px',
                fontSize: '1.2em',
                fontWeight: 'bold',
                border: 'none',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '12px',
                transition: 'all 0.3s ease',
                boxShadow: `0 4px 20px rgba(0, 255, 136, 0.3)`,
                textTransform: 'uppercase',
                letterSpacing: '1px',
              }}
            >
              <MdVideoLibrary />
              Start Editing Now
              <FaArrowRight />
            </motion.button>

            <motion.button
              whileHover={{ scale: 1.05, boxShadow: `0 8px 30px rgba(0, 212, 255, 0.4)` }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setShowDownloadModal(true)}
              style={{
                background: `linear-gradient(135deg, ${colors.accent4}, ${colors.accent2})`,
                color: colors.bg,
                padding: '16px 32px',
                borderRadius: '50px',
                fontSize: '1.2em',
                fontWeight: 'bold',
                border: 'none',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '12px',
                transition: 'all 0.3s ease',
                boxShadow: `0 4px 20px rgba(0, 212, 255, 0.3)`,
                textTransform: 'uppercase',
                letterSpacing: '1px',
              }}
            >
              <IoMdCloudDownload />
              Download Video
              <FaArrowRight />
            </motion.button>
          </div>
        </motion.div>

        {/* Features Grid */}
        <div style={{ marginBottom: '80px' }}>
          <motion.h3
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.0 }}
            style={{
              fontSize: '2em',
              fontWeight: 'bold',
              color: colors.text,
              textAlign: 'center',
              marginBottom: '3em',
              textTransform: 'uppercase',
              letterSpacing: '2px',
            }}
          >
            <FiZap style={{ marginRight: '0.5em', verticalAlign: 'middle', color: colors.accent3 }} />
            Powerful Features
          </motion.h3>
          
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', 
            gap: '30px' 
          }}>
            {features.map((feature, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 1.2 + index * 0.1 }}
                whileHover={{ 
                  scale: 1.05, 
                  boxShadow: `0 12px 40px rgba(0, 255, 136, 0.2)`,
                }}
                style={{
                  background: 'rgba(255, 255, 255, 0.03)',
                  backdropFilter: 'blur(10px)',
                  border: `1px solid rgba(255, 255, 255, 0.1)`,
                  borderRadius: '20px',
                  padding: '40px 30px',
                  textAlign: 'center',
                  transition: 'all 0.3s ease',
                  cursor: 'pointer',
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                <div style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  height: '4px',
                  background: `linear-gradient(90deg, ${feature.gradient}, transparent)`,
                }} />
                <div style={{
                  fontSize: '3em',
                  marginBottom: '1.5em',
                  background: `linear-gradient(135deg, ${feature.gradient}, ${colors.accent4})`,
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}>
                  {feature.icon}
                </div>
                <h4 style={{
                  fontSize: '1.4em',
                  fontWeight: 'bold',
                  color: colors.text,
                  marginBottom: '1em',
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                }}>
                  {feature.title}
                </h4>
                <p style={{
                  fontSize: '1em',
                  color: colors.textMuted,
                  lineHeight: '1.6',
                  margin: 0,
                }}>
                  {feature.description}
                </p>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Quick Actions - Simplified */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.8 }}
          style={{ 
            textAlign: 'center',
            marginBottom: '80px' 
          }}
        >
          <p style={{
            fontSize: '1.2em',
            color: colors.textMuted,
            marginBottom: '2em',
          }}>
            Or choose an action below:
          </p>
          
          <div style={{ 
            display: 'flex', 
            gap: '20px', 
            justifyContent: 'center',
            flexWrap: 'wrap' 
          }}>
            <motion.button
              whileHover={{ scale: 1.02, y: -2 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setShowDownloadModal(true)}
              style={{
                background: colors.surface,
                border: `2px solid ${colors.accent4}`,
                padding: '20px 30px',
                cursor: 'pointer',
                transition: 'all 0.3s ease',
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                fontSize: '1.1em',
                fontWeight: 'bold',
                color: colors.text,
              }}
            >
              <IoMdCloudDownload size={24} color={colors.accent4} />
              Download Video
            </motion.button>

            <motion.button
              whileHover={{ scale: 1.02, y: -2 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setShowEditor(true)}
              style={{
                background: colors.surface,
                border: `2px solid ${colors.accent1}`,
                padding: '20px 30px',
                cursor: 'pointer',
                transition: 'all 0.3s ease',
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                fontSize: '1.1em',
                fontWeight: 'bold',
                color: colors.text,
              }}
            >
              <IoMdCloudUpload size={24} color={colors.accent1} />
              Upload & Edit
            </motion.button>
          </div>
        </motion.div>

        {/* Keyboard Shortcuts */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 2.0 }}
          style={{
            background: 'rgba(0, 0, 0, 0.3)',
            backdropFilter: 'blur(10px)',
            border: `1px solid rgba(255, 255, 255, 0.1)`,
            borderRadius: '20px',
            padding: '40px',
            marginBottom: '80px',
          }}
        >
          <h3 style={{
            fontSize: '1.8em',
            marginBottom: '2em',
            color: colors.text,
            textAlign: 'center',
            textTransform: 'uppercase',
            letterSpacing: '2px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
          }}>
            <IoMdKeypad />
            Essential Shortcuts
          </h3>
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', 
            gap: '20px' 
          }}>
            {shortcuts.map((shortcut, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 2.2 + index * 0.1 }}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '16px 20px',
                  background: 'rgba(255, 255, 255, 0.05)',
                  borderRadius: '12px',
                  border: `1px solid rgba(255, 255, 255, 0.1)`,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: colors.textMuted }}>
                  <span style={{ color: colors.accent1 }}>{shortcut.icon}</span>
                  <span>{shortcut.action}</span>
                </div>
                <div style={{
                  background: colors.accent1,
                  color: colors.bg,
                  padding: '6px 12px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: 'bold',
                  fontFamily: 'monospace',
                }}>
                  {shortcut.key}
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Settings Row */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 2.4 }}
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '24px' }}
        >
          {/* Auto-Cleanup */}
          <div style={{
            background: colors.surface,
            border: `3px solid ${autoCleanup ? colors.accent1 : colors.border}`,
            padding: '24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderRadius: '16px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div style={{
                width: '48px',
                height: '48px',
                background: autoCleanup ? colors.accent1 : colors.border,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '12px',
              }}>
                <MdAutoDelete size={24} color={colors.bg} />
              </div>
              <div>
                <h4 style={{ color: colors.text, margin: 0, fontSize: '14px', fontWeight: '700', textTransform: 'uppercase' }}>
                  Auto-Delete
                </h4>
                <p style={{ color: colors.textMuted, margin: 0, fontSize: '12px' }}>
                  {autoCleanup ? 'ON - Files deleted on exit' : 'OFF - Files persist'}
                </p>
              </div>
            </div>
            <button
              onClick={() => setAutoCleanup(!autoCleanup)}
              style={{
                width: '64px',
                height: '36px',
                background: autoCleanup ? colors.accent1 : colors.border,
                border: 'none',
                cursor: 'pointer',
                position: 'relative',
                transition: 'background 0.2s',
                borderRadius: '18px',
              }}
            >
              <div style={{
                width: '28px',
                height: '28px',
                background: colors.bg,
                position: 'absolute',
                top: '4px',
                left: autoCleanup ? '32px' : '4px',
                transition: 'left 0.2s',
                borderRadius: '50%',
              }} />
            </button>
          </div>

          {/* Danger Zone */}
          <div style={{
            background: colors.surface,
            border: `3px solid ${colors.danger}`,
            padding: '24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderRadius: '16px',
          }}>
            <div>
              <h4 style={{ color: colors.danger, margin: '0 0 4px 0', fontSize: '14px', fontWeight: '700', textTransform: 'uppercase' }}>
                Danger Zone
              </h4>
              <p style={{ color: colors.textMuted, margin: 0, fontSize: '12px' }}>
                Delete all data now
              </p>
            </div>
            <button
              onClick={handleClearAll}
              disabled={isClearing}
              style={{
                background: 'transparent',
                border: `2px solid ${colors.danger}`,
                color: colors.danger,
                padding: '10px 20px',
                cursor: isClearing ? 'not-allowed' : 'pointer',
                fontSize: '12px',
                fontWeight: '900',
                textTransform: 'uppercase',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                transition: 'all 0.15s',
                opacity: isClearing ? 0.5 : 1,
                borderRadius: '8px',
              }}
              onMouseOver={(e) => {
                if (!isClearing) {
                  e.currentTarget.style.background = colors.danger;
                  e.currentTarget.style.color = colors.bg;
                }
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = colors.danger;
              }}
            >
              <IoMdTrash size={16} />
              {isClearing ? 'Clearing...' : 'Clear All'}
            </button>
          </div>
        </motion.div>
      </main>

      {/* Footer */}
      <motion.footer
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 2.6 }}
        style={{
          borderTop: `2px solid ${colors.border}`,
          padding: '30px 20px',
          textAlign: 'center',
          marginTop: 'auto',
        }}
      >
        <p style={{ color: colors.textMuted, margin: 0, fontSize: '12px', textTransform: 'uppercase', letterSpacing: '1px' }}>
          <FaStar style={{ color: colors.accent1, marginRight: '8px' }} />
          Powered by FFmpeg & yt-dlp
          <FaStar style={{ color: colors.accent1, marginLeft: '8px' }} />
        </p>
      </motion.footer>

      <DownloadModal
        isOpen={showDownloadModal}
        onClose={() => setShowDownloadModal(false)}
        onDownloadComplete={handleDownloadComplete}
      />

      <AnimatePresence>
        {showEditor && (
          <VideoEditor
            onClose={() => {
              setShowEditor(false);
              setDownloadedVideoId(null);
              loadStats();
            }}
            initialVideoId={downloadedVideoId}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

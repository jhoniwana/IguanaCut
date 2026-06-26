import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  IoMdCloudUpload,
  IoMdTrash,
  IoMdPlay,
  IoMdCut,
  IoMdDownload,
  IoMdHelpCircle,
  IoMdFolder,
  IoMdFilm,
  IoMdRefresh,
  IoMdClose,
  IoMdTime,
  IoMdCheckmarkCircle
} from 'react-icons/io';
import { FiUpload, FiHardDrive, FiFile, FiVideo, FiTrash2, FiLink, FiDownload } from 'react-icons/fi';
import { MdBlurOn } from 'react-icons/md';
import { IoMdCloudDownload } from 'react-icons/io';
import VideoEditor from './components/VideoEditor';
import MultiSourceEditor from './components/MultiSourceEditor';

const generateSessionId = () => 'sess_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();

// Purple theme
const colors = {
  bg: '#0a0a0f',
  surface: '#12121a',
  card: '#1a1a24',
  border: '#2a2a3a',
  primary: '#8B5CF6',
  secondary: '#A78BFA',
  accent: '#C084FC',
  danger: '#ff4466',
  success: '#00FF88',
  text: '#ffffff',
  textSecondary: '#b0b0c0',
  textMuted: '#606070',
  gradient: 'linear-gradient(135deg, #8B5CF6 0%, #A78BFA 100%)',
  gradientAccent: 'linear-gradient(135deg, #A78BFA 0%, #C084FC 100%)',
};

interface VideoFile {
  id: string;
  file_name: string;
  size: number;
  duration: number;
  format: string;
  created_at: string;
}

export default function App() {
  const [showEditor, setShowEditor] = useState(false);
  const [showMultiSourceEditor, setShowMultiSourceEditor] = useState(false);
  const [showFileManager, setShowFileManager] = useState(false);
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  const [isClearing, setIsClearing] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [videos, setVideos] = useState<VideoFile[]>([]);
  const [isLoadingVideos, setIsLoadingVideos] = useState(false);
  const sessionIdRef = useRef<string>(generateSessionId());
  const heartbeatRef = useRef<NodeJS.Timeout | null>(null);

  // YouTube/URL Download states
  const [fileManagerTab, setFileManagerTab] = useState<'files' | 'download'>('files');
  const [downloadUrl, setDownloadUrl] = useState('');
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadStatus, setDownloadStatus] = useState('');
  const [downloadId, setDownloadId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [renamingVideoId, setRenamingVideoId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  useEffect(() => {
    const initSession = async () => {
      try {
        await fetch('/api/system/session/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sessionIdRef.current, auto_clean: false }),
        });
      } catch (error) {
        console.error('[Session] Failed to start:', error);
      }
    };

    initSession();

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
        cleanup: false,
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

  const loadVideos = async () => {
    setIsLoadingVideos(true);
    try {
      const res = await fetch('/api/videos');
      if (res.ok) {
        const data = await res.json();
        setVideos(data || []);
      }
    } catch (error) {
      console.error('Failed to load videos:', error);
    } finally {
      setIsLoadingVideos(false);
    }
  };

  const deleteVideo = async (id: string) => {
    if (!confirm('¿Eliminar este video?')) return;
    try {
      await fetch(`/api/videos/${id}`, { method: 'DELETE' });
      setVideos(videos.filter(v => v.id !== id));
    } catch (error) {
      console.error('Failed to delete video:', error);
    }
  };

  const startRename = (id: string, currentName: string) => {
    setRenamingVideoId(id);
    setRenameValue(currentName);
  };

  const submitRename = async (id: string) => {
    if (!renameValue.trim()) {
      setRenamingVideoId(null);
      return;
    }
    try {
      const res = await fetch(`/api/videos/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_name: renameValue.trim() }),
      });
      if (res.ok) {
        const updated = await res.json();
        setVideos(videos.map(v => v.id === id ? { ...v, file_name: updated.file_name } : v));
      }
    } catch (error) {
      console.error('Failed to rename video:', error);
    }
    setRenamingVideoId(null);
  };

  const openVideoInEditor = (videoId: string) => {
    setSelectedVideoId(videoId);
    localStorage.setItem('losslesscut_last_video', videoId);
    setShowFileManager(false);
    setShowEditor(true);
  };

  // Restore last session on mount
  useEffect(() => {
    const restore = async () => {
      // Try saved video ID first
      const lastVideo = localStorage.getItem('losslesscut_last_video');
      if (lastVideo) {
        // Verify it still exists
        try {
          const res = await fetch(`/api/videos`);
          if (res.ok) {
            const videos = await res.json();
            const found = videos.find((v: any) => v.id === lastVideo);
            if (found) {
              setSelectedVideoId(lastVideo);
              setShowEditor(true);
              return;
            }
          }
        } catch {}
      }
      // Fallback: if there are any videos, open the first one
      try {
        const res = await fetch('/api/videos');
        if (res.ok) {
          const videos = await res.json();
          if (videos.length > 0) {
            setSelectedVideoId(videos[videos.length - 1].id);
            localStorage.setItem('losslesscut_last_video', videos[videos.length - 1].id);
            setShowEditor(true);
          }
        }
      } catch {}
    };
    restore();
  }, []);

  const handleClearAll = async () => {
    if (!confirm('¿ELIMINAR TODOS LOS DATOS?\n\n¡Esta acción no se puede deshacer!')) return;
    setIsClearing(true);
    try {
      await fetch('/api/system/clear-all', { method: 'DELETE' });
      setVideos([]);
    } catch (error: any) {
      alert(`Error: ${error.message}`);
    } finally {
      setIsClearing(false);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Start download from URL (YouTube, etc.)
  const startDownload = async () => {
    if (!downloadUrl.trim()) return;

    setIsDownloading(true);
    setDownloadProgress(0);
    setDownloadStatus('Iniciando descarga...');
    setDownloadError(null);

    try {
      const res = await fetch('/api/downloads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: downloadUrl.trim() }),
      });

      if (!res.ok) {
        const text = await res.text();
        try {
          const errorData = JSON.parse(text);
          throw new Error(errorData.error || 'Error al iniciar descarga');
        } catch {
          throw new Error('Error al iniciar descarga');
        }
      }

      const data = await res.json();
      setDownloadId(data.id);
      pollDownloadStatus(data.id);
    } catch (error: any) {
      setDownloadError(error.message || 'Error desconocido');
      setIsDownloading(false);
    }
  };

  // Poll download status
  const pollDownloadStatus = async (id: string) => {
    let retries = 0;
    const maxRetries = 300; // 5 minutes max

    const poll = setInterval(async () => {
      retries++;
      if (retries > maxRetries) {
        clearInterval(poll);
        setIsDownloading(false);
        setDownloadError('Tiempo de espera agotado');
        return;
      }

      try {
        const res = await fetch(`/api/downloads/${id}`);
        if (!res.ok) throw new Error('Failed to get status');

        const data = await res.json();
        const progress = data.progress || 0;
        setDownloadProgress(progress);

        // Better status text
        if (data.status === 'downloading') {
          setDownloadStatus(`Descargando... ${progress.toFixed(1)}%`);
        } else if (data.status === 'processing') {
          setDownloadStatus('Procesando video...');
        } else {
          setDownloadStatus(data.status_text || data.status || 'Trabajando...');
        }

        if (data.status === 'completed') {
          clearInterval(poll);
          setIsDownloading(false);
          setDownloadUrl('');
          setDownloadId(null);
          setDownloadProgress(100);
          setDownloadStatus('¡Descarga completada!');

          // Get the video ID and open editor automatically
          const videoId = data.video_id;
          if (videoId) {
            setShowFileManager(false);
            setSelectedVideoId(videoId);
            localStorage.setItem('losslesscut_last_video', videoId);
            setShowEditor(true);
          } else {
            // Fallback: reload videos and switch to files tab
            loadVideos();
            setTimeout(() => {
              setFileManagerTab('files');
            }, 500);
          }
        } else if (data.status === 'failed' || data.status === 'error') {
          clearInterval(poll);
          setIsDownloading(false);
          setDownloadError(data.error || data.status_text || 'Descarga fallida');
        }
      } catch (error) {
        // Don't stop on network errors, just log
        console.warn('Poll error:', error);
      }
    }, 1000);
  };

  const tutorialSteps = [
    {
      step: 1,
      icon: <FiUpload size={28} />,
      title: 'Sube tu video',
      description: 'Selecciona un archivo de tu computadora para comenzar a editarlo.',
    },
    {
      step: 2,
      icon: <IoMdPlay size={28} />,
      title: 'Navega al punto de inicio',
      description: 'Usa las flechas ← → para moverte. Shift+flechas para movimientos precisos.',
    },
    {
      step: 3,
      icon: <span style={{ fontSize: '24px', fontWeight: 'bold', color: colors.accent }}>I</span>,
      title: 'Marca el inicio',
      description: 'Presiona "I" para marcar donde inicia tu clip.',
    },
    {
      step: 4,
      icon: <span style={{ fontSize: '24px', fontWeight: 'bold', color: colors.secondary }}>O</span>,
      title: 'Marca el final',
      description: 'Presiona "O" para crear el clip automáticamente.',
    },
    {
      step: 5,
      icon: <MdBlurOn size={28} />,
      title: 'Censura rostros',
      description: 'Activa la censura automática de rostros en los clips que necesites.',
    },
    {
      step: 6,
      icon: <IoMdDownload size={28} />,
      title: 'Exporta',
      description: 'Descarga tu video editado sin perder calidad.',
    },
  ];

  return (
    <div style={{
      background: `radial-gradient(ellipse at 50% 0%, ${colors.surface} 0%, ${colors.bg} 70%)`,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Header */}
      <header style={{
        background: `linear-gradient(180deg, ${colors.surface} 0%, ${colors.bg} 100%)`,
        padding: '20px 24px',
        borderBottom: `1px solid ${colors.border}`,
        boxShadow: '0 4px 30px rgba(0, 0, 0, 0.3)',
      }}>
        <div style={{ maxWidth: '900px', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{
              width: '48px',
              height: '48px',
              borderRadius: '12px',
              background: colors.gradient,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '22px',
              fontWeight: '700',
              color: '#fff',
            }}>
              LC
            </div>
            <div>
              <h1 style={{
                margin: 0,
                fontSize: '18px',
                fontWeight: '600',
                color: colors.textSecondary,
              }}>
                Video Studio
              </h1>
              <p style={{ margin: 0, fontSize: '11px', color: colors.textMuted }}>
                Edición profesional sin pérdida
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowTutorial(true)}
            style={{
              background: `linear-gradient(145deg, ${colors.card} 0%, ${colors.surface} 100%)`,
              border: `1px solid ${colors.border}`,
              color: colors.text,
              padding: '10px 18px',
              borderRadius: '12px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '14px',
              fontWeight: '500',
              transition: 'all 0.2s ease',
            }}
          >
            <IoMdHelpCircle size={18} color={colors.primary} />
            ¿Cómo funciona?
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '50px 20px',
        maxWidth: '700px',
        margin: '0 auto',
        width: '100%',
      }}>
        {/* Welcome */}
        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          <div style={{
            marginBottom: '24px',
            padding: '16px',
            background: `linear-gradient(145deg, rgba(26, 26, 36, 0.6) 0%, rgba(18, 18, 26, 0.8) 100%)`,
            borderRadius: '20px',
            display: 'inline-block',
            border: `1px solid ${colors.border}`,
            boxShadow: `0 8px 40px rgba(139, 92, 246, 0.15)`,
          }}>
            <div style={{
              width: '70px',
              height: '70px',
              borderRadius: '16px',
              background: colors.gradient,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '32px',
              fontWeight: '700',
              color: '#fff',
            }}>
              LC
            </div>
          </div>
          <h2 style={{
            color: colors.text,
            fontSize: '26px',
            fontWeight: '600',
            marginBottom: '12px',
          }}>
            Edita videos como un profesional
          </h2>
          <p style={{
            color: colors.textSecondary,
            fontSize: '15px',
            lineHeight: '1.6',
            maxWidth: '480px',
            margin: '0 auto',
          }}>
            Corta, recorta y censura rostros en tus videos sin perder calidad.
            Simple, rápido y poderoso.
          </p>
        </div>

        {/* Main Action Buttons */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
          width: '100%',
          maxWidth: '420px',
        }}>
          <motion.button
            whileHover={{ scale: 1.02, boxShadow: '0 8px 35px rgba(0, 229, 255, 0.4)' }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setShowEditor(true)}
            style={{
              background: colors.gradient,
              color: '#fff',
              padding: '20px 32px',
              borderRadius: '9999px',
              fontSize: '17px',
              fontWeight: '700',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '12px',
              boxShadow: '0 6px 25px rgba(0, 229, 255, 0.3)',
              transition: 'box-shadow 0.2s ease',
            }}
          >
            <IoMdCloudUpload size={24} />
            Subir Video
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.02, boxShadow: '0 8px 35px rgba(255, 200, 0, 0.4)' }}
            whileTap={{ scale: 0.98 }}
            onClick={() => {
              setFileManagerTab('download');
              setShowFileManager(true);
            }}
            style={{
              background: colors.accent,
              color: '#000',
              padding: '20px 32px',
              borderRadius: '9999px',
              fontSize: '17px',
              fontWeight: '700',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '12px',
              boxShadow: '0 6px 25px rgba(255, 200, 0, 0.3)',
              transition: 'box-shadow 0.2s ease',
            }}
          >
            <FiLink size={22} />
            Descargar desde URL
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.02, boxShadow: '0 8px 35px rgba(0, 255, 136, 0.4)' }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setShowMultiSourceEditor(true)}
            style={{
              background: 'linear-gradient(135deg, #00FF88 0%, #00E5FF 100%)',
              color: '#000',
              padding: '16px 32px',
              borderRadius: '9999px',
              fontSize: '15px',
              fontWeight: '600',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '12px',
              boxShadow: '0 6px 25px rgba(0, 255, 136, 0.3)',
              transition: 'box-shadow 0.2s ease',
            }}
          >
            <IoMdFilm size={22} />
            Multi-Source Editor
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.02, boxShadow: '0 8px 35px rgba(255, 20, 138, 0.4)' }}
            whileTap={{ scale: 0.98 }}
            onClick={() => {
              setFileManagerTab('files');
              loadVideos();
              setShowFileManager(true);
            }}
            style={{
              background: colors.gradientAccent,
              color: '#fff',
              padding: '16px 32px',
              borderRadius: '9999px',
              fontSize: '15px',
              fontWeight: '600',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '12px',
              boxShadow: '0 6px 25px rgba(255, 20, 138, 0.3)',
              transition: 'box-shadow 0.2s ease',
            }}
          >
            <FiHardDrive size={22} />
            Mis Archivos
          </motion.button>
        </div>

        {/* Quick Features */}
        <div style={{
          marginTop: '50px',
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '16px',
          width: '100%',
          maxWidth: '500px',
        }}>
          {[
            { icon: <IoMdCut size={24} />, label: 'Corte preciso', color: colors.primary },
            { icon: <MdBlurOn size={24} />, label: 'Censura rostros', color: colors.secondary },
            { icon: <IoMdCheckmarkCircle size={24} />, label: 'Sin pérdida', color: colors.success },
          ].map((feature, i) => (
            <div key={i} style={{
              background: `linear-gradient(145deg, ${colors.card} 0%, ${colors.surface} 100%)`,
              border: `1px solid ${colors.border}`,
              borderRadius: '16px',
              padding: '20px 16px',
              textAlign: 'center',
            }}>
              <div style={{ color: feature.color, marginBottom: '8px' }}>
                {feature.icon}
              </div>
              <span style={{ color: colors.textSecondary, fontSize: '12px', fontWeight: '500' }}>
                {feature.label}
              </span>
            </div>
          ))}
        </div>

        {/* Keyboard Shortcuts */}
        <div style={{
          marginTop: '40px',
          padding: '20px 24px',
          background: `linear-gradient(145deg, ${colors.card} 0%, ${colors.surface} 100%)`,
          borderRadius: '16px',
          border: `1px solid ${colors.border}`,
          width: '100%',
          maxWidth: '420px',
        }}>
          <h3 style={{
            color: colors.text,
            fontSize: '14px',
            fontWeight: '600',
            marginBottom: '14px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}>
            <span style={{ color: colors.primary }}>◆</span>
            Atajos de teclado
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {[
              { key: 'Espacio', action: 'Play / Pausa' },
              { key: 'I', action: 'Marcar inicio', keyColor: colors.accent },
              { key: 'O', action: 'Marcar fin', keyColor: colors.secondary },
              { key: '← →', action: '±1 segundo' },
            ].map((item) => (
              <div key={item.key} style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}>
                <span style={{ color: colors.textSecondary, fontSize: '13px' }}>{item.action}</span>
                <span style={{
                  background: item.keyColor || colors.card,
                  color: item.keyColor ? '#000' : colors.primary,
                  padding: '4px 12px',
                  borderRadius: '8px',
                  fontSize: '12px',
                  fontWeight: '700',
                  fontFamily: 'monospace',
                  border: item.keyColor ? 'none' : `1px solid ${colors.border}`,
                }}>
                  {item.key}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Clear Data Button */}
        <button
          onClick={handleClearAll}
          disabled={isClearing}
          style={{
            marginTop: '36px',
            background: 'transparent',
            border: `1px solid ${colors.danger}`,
            color: colors.danger,
            padding: '10px 20px',
            borderRadius: '9999px',
            cursor: isClearing ? 'not-allowed' : 'pointer',
            fontSize: '13px',
            fontWeight: '500',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            opacity: isClearing ? 0.5 : 1,
            transition: 'all 0.2s ease',
          }}
        >
          <IoMdTrash size={16} />
          {isClearing ? 'Limpiando...' : 'Limpiar todos los datos'}
        </button>
      </main>

      {/* Footer */}
      <footer style={{
        borderTop: `1px solid ${colors.border}`,
        padding: '16px',
        textAlign: 'center',
        background: colors.surface,
      }}>
        <p style={{
          color: colors.textMuted,
          fontSize: '12px',
          margin: 0,
        }}>
          Powered by <span style={{ color: colors.primary }}>FFmpeg</span>
        </p>
      </footer>

      {/* File Manager Modal */}
      <AnimatePresence>
        {showFileManager && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(10, 10, 15, 0.95)',
              backdropFilter: 'blur(8px)',
              zIndex: 200,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '20px',
            }}
            onClick={() => setShowFileManager(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              style={{
                background: `linear-gradient(180deg, ${colors.card} 0%, ${colors.surface} 100%)`,
                borderRadius: '24px',
                padding: '0',
                maxWidth: '700px',
                width: '100%',
                maxHeight: '80vh',
                overflow: 'hidden',
                border: `1px solid ${colors.border}`,
                boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
              }}
            >
              {/* File Manager Header with Tabs */}
              <div style={{
                background: colors.gradient,
              }}>
                <div style={{
                  padding: '16px 20px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    {fileManagerTab === 'files' ? <FiHardDrive size={22} /> : <IoMdCloudDownload size={22} />}
                    <h2 style={{ margin: 0, fontSize: '17px', fontWeight: '700' }}>
                      {fileManagerTab === 'files' ? 'Mis Archivos' : 'Descargar Video'}
                    </h2>
                  </div>
                  <button
                    onClick={() => setShowFileManager(false)}
                    style={{
                      background: 'rgba(255,255,255,0.2)',
                      border: 'none',
                      color: '#fff',
                      padding: '8px',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                  >
                    <IoMdClose size={20} />
                  </button>
                </div>
                {/* Tabs */}
                <div style={{
                  display: 'flex',
                  gap: '4px',
                  padding: '0 16px 12px',
                }}>
                  <button
                    onClick={() => setFileManagerTab('files')}
                    style={{
                      flex: 1,
                      background: fileManagerTab === 'files' ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.1)',
                      border: 'none',
                      color: '#fff',
                      padding: '10px 16px',
                      borderRadius: '10px',
                      cursor: 'pointer',
                      fontSize: '13px',
                      fontWeight: fileManagerTab === 'files' ? '700' : '500',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                      transition: 'all 0.2s ease',
                    }}
                  >
                    <FiHardDrive size={16} />
                    Archivos ({videos.length})
                  </button>
                  <button
                    onClick={() => setFileManagerTab('download')}
                    style={{
                      flex: 1,
                      background: fileManagerTab === 'download' ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.1)',
                      border: 'none',
                      color: '#fff',
                      padding: '10px 16px',
                      borderRadius: '10px',
                      cursor: 'pointer',
                      fontSize: '13px',
                      fontWeight: fileManagerTab === 'download' ? '700' : '500',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                      transition: 'all 0.2s ease',
                    }}
                  >
                    <FiLink size={16} />
                    Descargar URL
                  </button>
                </div>
              </div>

              {/* Tab Content */}
              <div style={{
                padding: '16px',
                maxHeight: '55vh',
                overflowY: 'auto',
              }}>
                {/* Download Tab */}
                {fileManagerTab === 'download' && (
                  <div style={{ padding: '8px 0' }}>
                    {/* URL Input */}
                    <div style={{
                      background: colors.card,
                      borderRadius: '14px',
                      padding: '20px',
                      marginBottom: '16px',
                      border: `1px solid ${colors.border}`,
                    }}>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        marginBottom: '14px',
                      }}>
                        <FiLink size={20} color={colors.primary} />
                        <span style={{ color: colors.text, fontWeight: '600', fontSize: '14px' }}>
                          Pega la URL del video
                        </span>
                      </div>
                      <input
                        type="text"
                        value={downloadUrl}
                        onChange={(e) => setDownloadUrl(e.target.value)}
                        placeholder="https://youtube.com/watch?v=... o cualquier URL"
                        disabled={isDownloading}
                        style={{
                          width: '100%',
                          background: colors.surface,
                          border: `1px solid ${colors.border}`,
                          borderRadius: '10px',
                          padding: '14px 16px',
                          color: colors.text,
                          fontSize: '14px',
                          outline: 'none',
                          marginBottom: '14px',
                        }}
                        onKeyDown={(e) => e.key === 'Enter' && !isDownloading && startDownload()}
                      />
                      <button
                        onClick={startDownload}
                        disabled={isDownloading || !downloadUrl.trim()}
                        style={{
                          width: '100%',
                          background: isDownloading ? colors.card : colors.gradient,
                          color: '#fff',
                          border: 'none',
                          borderRadius: '9999px',
                          padding: '14px 20px',
                          fontSize: '15px',
                          fontWeight: '700',
                          cursor: isDownloading ? 'not-allowed' : 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '10px',
                          opacity: !downloadUrl.trim() ? 0.5 : 1,
                          boxShadow: isDownloading ? 'none' : '0 4px 20px rgba(0, 229, 255, 0.3)',
                        }}
                      >
                        {isDownloading ? (
                          <>
                            <IoMdRefresh size={20} style={{ animation: 'spin 1s linear infinite' }} />
                            Descargando...
                          </>
                        ) : (
                          <>
                            <FiDownload size={20} />
                            Descargar Video
                          </>
                        )}
                      </button>
                    </div>

                    {/* Download Progress */}
                    {isDownloading && (
                      <div style={{
                        background: colors.card,
                        borderRadius: '14px',
                        padding: '16px',
                        marginBottom: '16px',
                        border: `1px solid ${colors.border}`,
                      }}>
                        <div style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          marginBottom: '10px',
                        }}>
                          <span style={{ color: colors.textSecondary, fontSize: '13px' }}>
                            {downloadStatus}
                          </span>
                          <span style={{
                            color: colors.primary,
                            fontSize: '14px',
                            fontWeight: '700',
                            fontFamily: 'monospace',
                          }}>
                            {downloadProgress.toFixed(1)}%
                          </span>
                        </div>
                        <div style={{
                          width: '100%',
                          height: '8px',
                          background: colors.border,
                          borderRadius: '4px',
                          overflow: 'hidden',
                        }}>
                          <div style={{
                            width: `${downloadProgress}%`,
                            height: '100%',
                            background: colors.gradient,
                            borderRadius: '4px',
                            transition: 'width 0.3s ease',
                          }} />
                        </div>
                      </div>
                    )}

                    {/* Download Error */}
                    {downloadError && (
                      <div style={{
                        background: `${colors.danger}22`,
                        border: `1px solid ${colors.danger}`,
                        borderRadius: '10px',
                        padding: '14px',
                        color: colors.danger,
                        fontSize: '13px',
                        marginBottom: '16px',
                      }}>
                        ⚠️ {downloadError}
                      </div>
                    )}

                    {/* Supported Sites */}
                    <div style={{
                      background: colors.surface,
                      borderRadius: '12px',
                      padding: '16px',
                      border: `1px solid ${colors.border}`,
                    }}>
                      <div style={{
                        color: colors.textMuted,
                        fontSize: '12px',
                        marginBottom: '10px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px',
                      }}>
                        Sitios compatibles
                      </div>
                      <div style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '8px',
                      }}>
                        {['YouTube', 'TikTok', 'Instagram', 'Twitter/X', 'Facebook', 'Vimeo', '+1000 más'].map((site) => (
                          <span key={site} style={{
                            background: colors.card,
                            color: colors.textSecondary,
                            padding: '6px 12px',
                            borderRadius: '6px',
                            fontSize: '11px',
                            fontWeight: '500',
                          }}>
                            {site}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Files Tab */}
                {fileManagerTab === 'files' && (
                  <>
                    {/* Refresh button */}
                    <div style={{
                      display: 'flex',
                      justifyContent: 'flex-end',
                      marginBottom: '10px',
                    }}>
                      <button
                        onClick={loadVideos}
                        disabled={isLoadingVideos}
                        style={{
                          background: colors.card,
                          border: `1px solid ${colors.border}`,
                          color: colors.textSecondary,
                          padding: '8px 14px',
                          borderRadius: '8px',
                          cursor: 'pointer',
                          fontSize: '12px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        <IoMdRefresh size={16} style={{
                          animation: isLoadingVideos ? 'spin 1s linear infinite' : 'none'
                        }} />
                        Actualizar
                      </button>
                    </div>
                    {isLoadingVideos ? (
                  <div style={{
                    textAlign: 'center',
                    padding: '40px',
                    color: colors.textMuted,
                  }}>
                    <IoMdRefresh size={32} style={{ animation: 'spin 1s linear infinite' }} />
                    <p>Cargando archivos...</p>
                  </div>
                ) : videos.length === 0 ? (
                  <div style={{
                    textAlign: 'center',
                    padding: '50px 20px',
                  }}>
                    <div style={{
                      width: '80px',
                      height: '80px',
                      margin: '0 auto 20px',
                      background: colors.card,
                      borderRadius: '20px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}>
                      <IoMdFolder size={40} color={colors.textMuted} />
                    </div>
                    <h3 style={{ color: colors.text, margin: '0 0 8px', fontSize: '18px' }}>
                      No hay archivos
                    </h3>
                    <p style={{ color: colors.textMuted, margin: 0, fontSize: '14px' }}>
                      Sube un video para comenzar a editar
                    </p>
                    <button
                      onClick={() => {
                        setShowFileManager(false);
                        setShowEditor(true);
                      }}
                      style={{
                        marginTop: '20px',
                        background: colors.gradient,
                        color: '#fff',
                        border: 'none',
                        padding: '12px 24px',
                        borderRadius: '9999px',
                        fontSize: '14px',
                        fontWeight: '600',
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '8px',
                      }}
                    >
                      <FiUpload size={18} />
                      Subir Video
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {videos.map((video) => (
                      <div
                        key={video.id}
                        style={{
                          background: `linear-gradient(145deg, ${colors.card} 0%, ${colors.surface} 100%)`,
                          border: `1px solid ${colors.border}`,
                          borderRadius: '14px',
                          padding: '14px 16px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '14px',
                          transition: 'all 0.2s ease',
                          cursor: 'pointer',
                        }}
                        onClick={() => openVideoInEditor(video.id)}
                      >
                        {/* Video Thumbnail/Preview */}
                        <div style={{
                          width: '56px',
                          height: '56px',
                          borderRadius: '12px',
                          overflow: 'hidden',
                          flexShrink: 0,
                          background: colors.card,
                        }}>
                          <img
                            src={`/api/videos/${video.id}/thumbnail`}
                            alt=""
                            loading="lazy"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                              (e.target as HTMLImageElement).parentElement!.innerHTML = '<svg stroke="currentColor" fill="currentColor" stroke-width="0" viewBox="0 0 24 24" height="24" width="24" color="#fff" xmlns="http://www.w3.org/2000/svg" style="margin:16px 0 0 16px"><path d="M17 9H7V7h10v2zm0 4H7v-2h10v2zm-4 4H7v-2h6v2zM5 3h14v2H5V3zm16 2v2h2V5h-2zm0 14v2h2v-2h-2zM5 19h14v2H5v-2zM3 5h2v2H3V5zm0 14h2v2H3v-2z"></path></svg>';
                            }}
                            style={{
                              width: '100%',
                              height: '100%',
                              objectFit: 'cover',
                            }}
                          />
                        </div>

                        {/* Video Info */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          {renamingVideoId === video.id ? (
                            <input
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onBlur={() => submitRename(video.id)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') submitRename(video.id);
                                if (e.key === 'Escape') setRenamingVideoId(null);
                              }}
                              autoFocus
                              onClick={(e) => e.stopPropagation()}
                              style={{
                                width: '100%',
                                boxSizing: 'border-box',
                                background: colors.bg,
                                border: `1px solid ${colors.primary}`,
                                color: colors.text,
                                padding: '4px 8px',
                                borderRadius: '6px',
                                fontSize: '14px',
                                fontWeight: '600',
                                outline: 'none',
                                marginBottom: '4px',
                              }}
                            />
                          ) : (
                            <h4 style={{
                              margin: '0 0 4px',
                              color: colors.text,
                              fontSize: '14px',
                              fontWeight: '600',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}>
                              {video.file_name}
                            </h4>
                          )}
                          <div style={{
                            display: 'flex',
                            gap: '12px',
                            color: colors.textMuted,
                            fontSize: '12px',
                          }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <IoMdTime size={14} />
                              {video.duration > 0 ? formatDuration(video.duration) : '--:--'}
                            </span>
                            <span>{formatFileSize(video.size)}</span>
                            <span style={{
                              background: colors.card,
                              padding: '2px 6px',
                              borderRadius: '4px',
                              color: colors.primary,
                              fontWeight: '500',
                            }}>
                              {video.format?.toUpperCase() || 'VIDEO'}
                            </span>
                          </div>
                        </div>

                        {/* Actions */}
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              startRename(video.id, video.file_name);
                            }}
                            title="Renombrar"
                            style={{
                              background: 'transparent',
                              border: `1px solid ${colors.border}`,
                              color: colors.textSecondary,
                              padding: '8px',
                              borderRadius: '8px',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                            }}
                          >
                            <IoMdCreate size={14} />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openVideoInEditor(video.id);
                            }}
                            style={{
                              background: colors.primary,
                              border: 'none',
                              color: '#000',
                              padding: '8px 14px',
                              borderRadius: '8px',
                              cursor: 'pointer',
                              fontSize: '12px',
                              fontWeight: '600',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                            }}
                          >
                            <IoMdCut size={14} />
                            Editar
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteVideo(video.id);
                            }}
                            style={{
                              background: 'transparent',
                              border: `1px solid ${colors.danger}`,
                              color: colors.danger,
                              padding: '8px',
                              borderRadius: '8px',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                            }}
                            title="Eliminar"
                          >
                            <FiTrash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                  </>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tutorial Modal */}
      <AnimatePresence>
        {showTutorial && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(10, 10, 15, 0.95)',
              backdropFilter: 'blur(8px)',
              zIndex: 200,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '20px',
              overflowY: 'auto',
            }}
            onClick={() => setShowTutorial(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              style={{
                background: `linear-gradient(180deg, ${colors.card} 0%, ${colors.surface} 100%)`,
                borderRadius: '24px',
                padding: '28px',
                maxWidth: '600px',
                width: '100%',
                maxHeight: '90vh',
                overflowY: 'auto',
                border: `1px solid ${colors.border}`,
                boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{
                    width: '40px',
                    height: '40px',
                    background: colors.gradient,
                    borderRadius: '10px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    <span style={{ fontSize: '20px' }}>◆</span>
                  </div>
                  <h2 style={{ color: colors.text, margin: 0, fontSize: '20px', fontWeight: '700' }}>
                    ¿Cómo usar?
                  </h2>
                </div>
                <button
                  onClick={() => setShowTutorial(false)}
                  style={{
                    background: colors.card,
                    border: `1px solid ${colors.border}`,
                    color: colors.textMuted,
                    width: '36px',
                    height: '36px',
                    borderRadius: '10px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <IoMdClose size={20} />
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {tutorialSteps.map((step) => (
                  <div
                    key={step.step}
                    style={{
                      display: 'flex',
                      gap: '14px',
                      padding: '14px',
                      background: colors.surface,
                      borderRadius: '14px',
                      border: `1px solid ${colors.border}`,
                    }}
                  >
                    <div style={{
                      width: '50px',
                      height: '50px',
                      background: colors.gradient,
                      borderRadius: '12px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#fff',
                      flexShrink: 0,
                    }}>
                      {step.icon}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        marginBottom: '4px',
                      }}>
                        <span style={{
                          background: colors.primary,
                          color: '#000',
                          width: '20px',
                          height: '20px',
                          borderRadius: '50%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '11px',
                          fontWeight: '700',
                        }}>
                          {step.step}
                        </span>
                        <h4 style={{ color: colors.text, margin: 0, fontSize: '14px', fontWeight: '600' }}>
                          {step.title}
                        </h4>
                      </div>
                      <p style={{
                        color: colors.textSecondary,
                        margin: 0,
                        fontSize: '13px',
                        lineHeight: '1.4',
                      }}>
                        {step.description}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              <button
                onClick={() => setShowTutorial(false)}
                style={{
                  width: '100%',
                  marginTop: '20px',
                  background: colors.gradient,
                  color: '#fff',
                  padding: '14px',
                  borderRadius: '9999px',
                  border: 'none',
                  fontSize: '15px',
                  fontWeight: '700',
                  cursor: 'pointer',
                  boxShadow: '0 4px 20px rgba(0, 229, 255, 0.3)',
                }}
              >
                ¡Entendido!
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showEditor && (
          <VideoEditor
            onClose={() => {
              setShowEditor(false);
              setSelectedVideoId(null);
            }}
            initialVideoId={selectedVideoId}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showMultiSourceEditor && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 300,
            }}
          >
            <MultiSourceEditor
              onClose={() => setShowMultiSourceEditor(false)}
              initialVideoId={null}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* CSS Animation for spinner */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

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
  IoMdCheckmarkCircle,
  IoMdCreate,
  IoMdCloudDownload
} from 'react-icons/io';
import { FiUpload, FiHardDrive, FiFile, FiVideo, FiTrash2, FiLink, FiDownload, FiGithub, FiShare2 } from 'react-icons/fi';
import { MdBlurOn } from 'react-icons/md';
import { FiChevronDown, FiChevronUp } from 'react-icons/fi';
import VideoEditor from './components/VideoEditor';
import MultiSourceEditor from './components/MultiSourceEditor';
import { useIsMobile } from './hooks/useIsMobile';
import { apiClient, OutputFile } from './api/client';

const generateSessionId = () => 'sess_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();

// La sesion real vive en localStorage (la usa api/client.ts); los fetch
// directos de esta vista deben mandarla, si no el server filtra a vacio.
const sessHeaders = (): HeadersInit => ({
  'X-Session-ID': localStorage.getItem('losslesscut_session_id') || '',
});

// Tema Iguana: estilo oscuro de la pagina de referencia (contenedores
// neutros #232326, textos #e1e3ea/#afb1c4, pills 999px) con la paleta
// verde del logo oficial (verde marca #0CB691, lima #D1F566, teal #095A51).
const colors = {
  bg: '#0d1110',
  surface: '#151b19',
  card: '#1c2421',
  border: '#2e3d37',
  primary: '#0CB691',
  secondary: '#4FD6B8',
  accent: '#D1F566',
  danger: '#f55353',
  success: '#00b784',
  text: '#ffffff',
  textSecondary: '#c3cfc9',
  textMuted: '#7d8f88',
  gradient: 'linear-gradient(135deg, #089477 0%, #4FD6B8 100%)',
  gradientAccent: 'linear-gradient(135deg, #0CB691 0%, #D1F566 100%)',
};

// Ocultar la descarga desde URL (se usa en builds para distribucion publica)
const HIDE_URL_DOWNLOAD = import.meta.env.VITE_HIDE_URL_DOWNLOAD === '1';

// Deteccion de Android: el WebView expone AndroidBridge y/o el userAgent
// contiene "Android". La censura de rostros requiere Python+OpenCV del
// backend de escritorio, no disponible en el APK -> se oculta en Android.
const IS_ANDROID =
  typeof window !== 'undefined' &&
  (/Android/i.test(navigator.userAgent) ||
    (window as any).AndroidBridge?.platform?.() === 'android');

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
  const [outputs, setOutputs] = useState<OutputFile[]>([]);
  const [isLoadingOutputs, setIsLoadingOutputs] = useState(false);
  const [deletingOutput, setDeletingOutput] = useState<string | null>(null);
  const isMobile = useIsMobile();
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
  const [completedDownloadName, setCompletedDownloadName] = useState<string | null>(null);
  const [completedDownloadId, setCompletedDownloadId] = useState<string | null>(null);
  const [renamingVideoId, setRenamingVideoId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [expandedVideoId, setExpandedVideoId] = useState<string | null>(null);

  // Altura del viewport medida con JS: las unidades vh/dvh se resuelven a
  // 0px en el WebView Android, asi que la altura fija del layout se calcula
  // con window.innerHeight (765px en el Pixel 6a) y se reajusta al rotar.
  const [viewportHeight, setViewportHeight] = useState<number>(
    typeof window !== 'undefined' ? window.innerHeight : 800
  );
  useEffect(() => {
    const update = () => setViewportHeight(window.innerHeight);
    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

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
      const res = await fetch('/api/videos', { headers: sessHeaders() });
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
    if (!confirm('Delete this video?')) return;
    try {
      await fetch(`/api/videos/${id}`, { method: 'DELETE', headers: sessHeaders() });
      setVideos(videos.filter(v => v.id !== id));
    } catch (error) {
      console.error('Failed to delete video:', error);
    }
  };

  // --- Exported files (cuts) ---
  const loadOutputs = async () => {
    setIsLoadingOutputs(true);
    try {
      setOutputs(await apiClient.listOutputs());
    } catch (error) {
      console.error('Failed to load outputs:', error);
    } finally {
      setIsLoadingOutputs(false);
    }
  };

  const deleteOutput = async (file_name: string) => {
    if (!confirm(`Delete "${file_name}"?`)) return;
    setDeletingOutput(file_name);
    try {
      await apiClient.deleteOutput(file_name);
      setOutputs(outputs.filter(o => o.file_name !== file_name));
    } catch (error) {
      console.error('Failed to delete output:', error);
    } finally {
      setDeletingOutput(null);
    }
  };

  const downloadOutput = (file_name: string) => {
    const a = document.createElement('a');
    a.href = apiClient.getOutputUrl(file_name);
    a.download = file_name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const shareOutput = (file_name: string) => {
    const bridge = (window as any).AndroidBridge;
    if (bridge?.shareFile) {
      bridge.shareFile(file_name);
    } else {
      downloadOutput(file_name);
    }
  };

  // Play a file (cut or download): system player
  // Android (bridge.openVideo) or the browser on desktop.
  const playOutput = (file_name: string, downloadId?: string) => {
    const bridge = (window as any).AndroidBridge;
    if (bridge?.openVideo) {
      bridge.openVideo(file_name);
    } else if (downloadId) {
      window.open(`/api/downloads/${downloadId}/file`, '_blank');
    } else {
      downloadOutput(file_name);
    }
  };

  // Save the file to the Android gallery (MediaStore).
  const saveToGallery = (file_name: string) => {
    const bridge = (window as any).AndroidBridge;
    if (bridge?.saveToGallery) {
      bridge.saveToGallery(file_name);
    } else {
      downloadOutput(file_name);
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
        headers: { 'Content-Type': 'application/json', ...sessHeaders() },
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
      // En Android no se reabre el ultimo archivo: la app debe arrancar
      // en el home con la gestion de archivos.
      if (IS_ANDROID) {
        loadVideos();
        loadOutputs();
        return;
      }
      // Try saved video ID first
      const lastVideo = localStorage.getItem('losslesscut_last_video');
      if (lastVideo) {
        // Verify it still exists
        try {
          const res = await fetch(`/api/videos`, { headers: sessHeaders() });
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
        const res = await fetch('/api/videos', { headers: sessHeaders() });
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
    if (!confirm('DELETE ALL DATA?\n\nThis action cannot be undone!')) return;
    setIsClearing(true);
    try {
      await fetch('/api/system/clear-all', { method: 'DELETE', headers: sessHeaders() });
      setVideos([]);
    } catch (error: any) {
      alert(`Error: ${error.message}`);
    } finally {
      setIsClearing(false);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (!bytes || bytes <= 0 || isNaN(bytes)) return '—';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  };

  // Formato corto: "MP4", "MKV"... (el campo format del backend puede
  // traer la lista de extensiones soportadas, no el formato del archivo)
  const formatShort = (video: VideoFile) => {
    const raw = (video.format || '').toUpperCase();
    if (raw.includes(',')) {
      const ext = video.file_name.split('.').pop()?.toUpperCase();
      return ext && ext.length <= 5 ? ext : 'VIDEO';
    }
    return raw || 'VIDEO';
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Start download from URL (YouTube, etc.)
  const startDownload = async () => {
    if (!downloadUrl.trim()) {
      setDownloadError('Paste a URL first (e.g. https://youtube.com/watch?v=...)');
      return;
    }

    setIsDownloading(true);
    setDownloadProgress(0);
    setDownloadStatus('Starting download...');
    setDownloadError(null);
    setCompletedDownloadName(null);
    setCompletedDownloadId(null);

    try {
      const res = await fetch('/api/downloads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...sessHeaders() },
        body: JSON.stringify({ url: downloadUrl.trim() }),
      });

      if (!res.ok) {
        const text = await res.text();
        try {
          const errorData = JSON.parse(text);
          throw new Error(errorData.error || 'Error starting download');
        } catch {
          throw new Error('Error starting download');
        }
      }

      const data = await res.json();
      setDownloadId(data.id);
      pollDownloadStatus(data.id);
    } catch (error: any) {
      setDownloadError(error.message || 'Unknown error');
      setIsDownloading(false);
    }
  };

  // Play a URL instead of downloading: system player (Android) or new
  // tab (web). YouTube URLs open the YouTube app on Android.
  const handlePlayUrl = () => {
    const url = downloadUrl.trim();
    if (!url) return;
    const bridge = (window as any).AndroidBridge;
    if (IS_ANDROID && bridge?.playUrl) {
      bridge.playUrl(url);
    } else {
      window.open(url, '_blank');
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
        setDownloadError('Timed out');
        return;
      }

      try {
        const res = await fetch(`/api/downloads/${id}`, { headers: sessHeaders() });
        if (!res.ok) throw new Error('Failed to get status');

        const data = await res.json();
        const progress = data.progress || 0;
        // El progreso nunca retrocede: entre fases (resolviendo ->
        // descargando -> procesando) el backend puede reportar 0 y la barra
        // parecia "muerta" hasta el salto final.
        setDownloadProgress((prev) => Math.max(prev, progress));

        // Better status text
        if (data.status === 'downloading') {
          // Con 0% yt-dlp todavia esta resolviendo el video (fase que puede
          // tardar); mostrar feedback para que no parezca colgado.
          setDownloadStatus(progress > 0
            ? `Downloading... ${progress.toFixed(1)}%`
            : 'Resolving video...');
        } else if (data.status === 'processing') {
          setDownloadStatus('Processing video...');
        } else {
          setDownloadStatus(data.status_text || data.status || 'Working...');
        }

        if (data.status === 'completed') {
          clearInterval(poll);
          setIsDownloading(false);
          setDownloadUrl('');
          setDownloadId(null);
          setDownloadProgress(100);
          setDownloadStatus('Download complete!');
          setCompletedDownloadName((data.file_path || '').split('/').pop() || null);
          setCompletedDownloadId(data.id || null);

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
          setDownloadError(data.error || data.status_text || 'Download failed');
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
      title: 'Upload your video',
      description: 'Import a file from your gallery or download any URL. Your file shows up in "My Files".',
    },
    {
      step: 2,
      icon: <IoMdPlay size={28} />,
      title: 'Go to the start point',
      description: 'Use the ← → arrows to move. Shift+arrows for precise moves.',
    },
    {
      step: 3,
      icon: <span style={{ fontSize: '24px', fontWeight: 'bold', color: colors.accent }}>I</span>,
      title: 'Set the start',
      description: 'Press "I" to mark where your clip starts.',
    },
    {
      step: 4,
      icon: <span style={{ fontSize: '24px', fontWeight: 'bold', color: colors.secondary }}>O</span>,
      title: 'Set the end',
      description: 'Press "O" to create the clip automatically.',
    },
    {
      step: 5,
      icon: <MdBlurOn size={28} />,
      title: 'Face blur',
      description: 'Enable automatic face blur on the clips you need.',
    },
    {
      step: 6,
      icon: <IoMdDownload size={28} />,
      title: 'Export',
      description: 'Export without losing quality. Your cut appears right under its source file with a preview: tap it to play, share or save it to the gallery.',
    },
  ];

  // Lista de archivos reutilizable: se muestra en el modal (desktop) y
  // como gestion de archivos del home en Android.
  // Fila de un archivo exportado (corte): preview frame, nombre y
  // acciones (Play / Share / Save to gallery / Delete).
  const renderCutRow = (cut: OutputFile) => (
    <div key={cut.file_name} style={{
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      background: colors.surface,
      borderRadius: '6px',
      padding: '4px 8px',
    }}>
      <img
        src={`/api/outputs/${encodeURIComponent(cut.file_name)}/thumbnail`}
        alt=""
        loading="lazy"
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        style={{
          width: '48px', height: '28px', borderRadius: '4px',
          objectFit: 'cover', background: colors.card, flexShrink: 0,
        }}
      />
      <span style={{
        flex: 1,
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        fontSize: '11px',
        color: colors.text,
      }}>
        {cut.file_name}
      </span>
      <span style={{ fontSize: '10px', color: colors.textMuted, flexShrink: 0 }}>
        {formatFileSize(cut.size)}
      </span>
      <button onClick={() => playOutput(cut.file_name)} title="Play" style={{
        background: colors.primary, border: 'none', color: '#000',
        width: '26px', height: '26px', borderRadius: '6px', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <IoMdPlay size={13} />
      </button>
      <button onClick={() => shareOutput(cut.file_name)} title="Share" style={{
        background: colors.card, border: `1px solid ${colors.border}`, color: colors.primary,
        width: '26px', height: '26px', borderRadius: '6px', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <FiShare2 size={12} />
      </button>
      {IS_ANDROID && (
      <button onClick={() => saveToGallery(cut.file_name)} title="Save to gallery" style={{
        background: colors.card, border: `1px solid ${colors.border}`, color: colors.text,
        width: '26px', height: '26px', borderRadius: '6px', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <IoMdCloudDownload size={12} />
      </button>
      )}
      <button onClick={() => deleteOutput(cut.file_name)} title="Delete" style={{
        background: 'transparent', border: `1px solid ${colors.danger}`, color: colors.danger,
        width: '26px', height: '26px', borderRadius: '6px', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <FiTrash2 size={12} />
      </button>
    </div>
  );

  const renderVideoList = () => (
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
                        Refresh
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
                      Upload a video to start editing
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
                      Upload Video
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {videos.map((video) => (
                      <>
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
                            src={apiClient.getThumbnailUrl(video.id)}
                            alt=""
                            loading="lazy"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
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
                              {formatShort(video)}
                            </span>
                          </div>
                        </div>

                        {/* Boton para expandir/colapsar el menu de acciones */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedVideoId(expandedVideoId === video.id ? null : video.id);
                          }}
                          title={expandedVideoId === video.id ? 'Ocultar acciones' : 'Ver acciones'}
                          aria-expanded={expandedVideoId === video.id}
                          style={{
                            background: expandedVideoId === video.id ? colors.primary : 'transparent',
                            border: `1px solid ${expandedVideoId === video.id ? colors.primary : colors.border}`,
                            color: expandedVideoId === video.id ? '#000' : colors.textSecondary,
                            padding: isMobile ? '12px' : '10px',
                            borderRadius: '10px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                            transition: 'all 0.2s ease',
                          }}
                        >
                          {expandedVideoId === video.id ? <FiChevronUp size={18} /> : <FiChevronDown size={18} />}
                        </button>
                      </div>

                      {/* Panel de acciones expandible */}
                      {(() => {
                            const cuts = outputs.filter(o => o.video_id === video.id);
                            // Padre-hijo: los cortes cuelgan del archivo de
                            // origen; visibles sin expandir, con acciones.
                            if (cuts.length === 0) return null;
                            return (
                              <div style={{
                                marginTop: '6px',
                                padding: '8px 10px',
                                marginLeft: '14px',
                                borderLeft: `2px solid ${colors.primary}`,
                                background: 'rgba(12, 182, 145, 0.06)',
                                borderRadius: '0 10px 10px 0',
                              }}>
                                <div style={{
                                  fontSize: '11px',
                                  fontWeight: '700',
                                  color: colors.textSecondary,
                                  marginBottom: '6px',
                                }}>
                                  ✂️ Cuts ({cuts.length})
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                                  {cuts.map((cut) => renderCutRow(cut))}
                                </div>
                              </div>
                            );
                          })()}
                      {expandedVideoId === video.id && (
                        <div style={{
                          marginTop: '10px',
                          padding: '14px',
                          background: colors.bg,
                          borderRadius: '12px',
                          border: `1px solid ${colors.border}`,
                        }}>
                          <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(3, 1fr)',
                            gap: '8px',
                            marginBottom: '12px',
                          }}>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                openVideoInEditor(video.id);
                              }}
                              style={{
                                background: colors.primary,
                                border: 'none',
                                color: '#000',
                                padding: isMobile ? '14px 8px' : '12px 8px',
                                borderRadius: '10px',
                                cursor: 'pointer',
                                fontSize: '13px',
                                fontWeight: '700',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                gap: '4px',
                              }}
                            >
                              <IoMdCut size={18} />
                              Edit
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                startRename(video.id, video.file_name);
                              }}
                              style={{
                                background: colors.card,
                                border: `1px solid ${colors.border}`,
                                color: colors.text,
                                padding: isMobile ? '14px 8px' : '12px 8px',
                                borderRadius: '10px',
                                cursor: 'pointer',
                                fontSize: '13px',
                                fontWeight: '600',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                gap: '4px',
                              }}
                            >
                              <IoMdCreate size={18} />
                              Rename
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
                                padding: isMobile ? '14px 8px' : '12px 8px',
                                borderRadius: '10px',
                                cursor: 'pointer',
                                fontSize: '13px',
                                fontWeight: '600',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                gap: '4px',
                              }}
                            >
                              <FiTrash2 size={18} />
                              Delete
                            </button>
                          </div>

                          {/* Info del archivo */}
                          <div style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: '6px 14px',
                            color: colors.textMuted,
                            fontSize: '12px',
                            paddingTop: '10px',
                            borderTop: `1px solid ${colors.border}`,
                          }}>
                            <span>📁 {formatShort(video)}</span>
                            <span>⏱ {video.duration > 0 ? formatDuration(video.duration) : '--:--'}</span>
                            <span>💾 {formatFileSize(video.size)}</span>
                            <span>🕒 {video.created_at ? new Date(video.created_at).toLocaleDateString() : ''}</span>
                          </div>

                          
                        </div>
                      )}
                      </>
                    ))}
                    {(() => {
                      const knownIds = new Set(videos.map((v) => v.id));
                      const orphans = outputs.filter((o) => !o.video_id || !knownIds.has(o.video_id));
                      if (orphans.length === 0) return null;
                      return (
                        <div style={{
                          marginTop: '4px',
                          padding: '10px',
                          background: colors.card,
                          borderRadius: '12px',
                          border: `1px dashed ${colors.border}`,
                        }}>
                          <div style={{ fontSize: '11px', fontWeight: '700', color: colors.textMuted, marginBottom: '6px' }}>
                            ⚠️ Exports sin archivo vinculado ({orphans.length})
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                            {orphans.map((cut) => renderCutRow(cut))}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}
    </>
  );


  return (
    <div style={{
      background: `radial-gradient(ellipse at 50% 0%, ${colors.surface} 0%, ${colors.bg} 70%)`,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      // En movil la altura es fija y el <main> scrollea internamente
      // (justify-content:center con overflow corta el contenido superior
      // y el WebView Android no puede hacer scroll hasta el).
      height: isMobile ? viewportHeight : undefined,
      minHeight: isMobile ? undefined : '100vh',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <header style={{
        background: `linear-gradient(180deg, ${colors.surface} 0%, ${colors.bg} 100%)`,
        padding: isMobile ? '12px 16px' : '20px 24px',
        borderBottom: `1px solid ${colors.border}`,
        boxShadow: '0 4px 30px rgba(0, 0, 0, 0.3)',
        flexShrink: 0,
      }}>
        <div style={{ maxWidth: '900px', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            {/* Logo oficial (iguana, SVG) */}
            <img
              src="/logo.svg"
              alt="IguanaCut"
              style={{ height: '34px', width: 'auto', filter: 'drop-shadow(0 0 12px rgba(12, 182, 145, 0.4))' }}
            />
            <div>
              <h1 style={{
                margin: 0,
                fontSize: '18px',
                fontWeight: '600',
                color: colors.textSecondary,
              }}>
                IguanaCut
              </h1>
              {!isMobile && (
                <p style={{ margin: 0, fontSize: '11px', color: colors.textMuted }}>
                  Professional lossless editing
                </p>
              )}
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
            {!isMobile && 'How does it work?'}
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main style={{
        flex: 1,
        minHeight: 0, // permite que overflowY funcione dentro del flex column
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        // En movil el contenido fluye desde arriba (scroll natural);
        // centrar verticalmente corta el overflow en el WebView.
        justifyContent: isMobile ? 'flex-start' : 'center',
        padding: isMobile ? '28px 14px 40px' : '50px 20px',
        maxWidth: '700px',
        margin: '0 auto',
        width: '100%',
        WebkitOverflowScrolling: 'touch',
      }}>
        {/* Bienvenida + acciones: solo desktop (en Android el home es la
            gestion de archivos, ver bloque IS_ANDROID abajo) */}
        {!IS_ANDROID && (<>
        {/* Welcome */}
        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          <div style={{
            marginBottom: '24px',
            padding: '16px',
            background: `linear-gradient(145deg, rgba(28, 36, 33, 0.6) 0%, rgba(21, 27, 25, 0.8) 100%)`,
            borderRadius: '20px',
            display: 'inline-block',
            border: `1px solid ${colors.border}`,
            boxShadow: `0 8px 40px rgba(12, 182, 145, 0.2)`,
          }}>
            <img
              src="/logo.svg"
              alt="IguanaCut"
              style={{ height: '64px', width: 'auto', filter: 'drop-shadow(0 0 16px rgba(209, 245, 102, 0.35))' }}
            />
          </div>
          <h2 style={{
            color: colors.text,
            fontSize: isMobile ? '21px' : '26px',
            fontWeight: '600',
            marginBottom: '12px',
          }}>
            Edit videos like a pro
          </h2>
          <p style={{
            color: colors.textSecondary,
            fontSize: '15px',
            lineHeight: '1.6',
            maxWidth: '480px',
            margin: '0 auto',
          }}>
            {IS_ANDROID
              ? 'Cut and trim your videos without losing quality. Simple, fast and powerful.'
              : 'Cut, trim and blur faces in your videos without losing quality. Simple, fast and powerful.'}
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
            whileHover={{ scale: 1.02, boxShadow: '0 8px 35px rgba(12, 182, 145, 0.4)' }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setShowEditor(true)}
            style={{
              background: colors.gradient,
              color: '#fff',
              padding: isMobile ? '16px 24px' : '20px 32px',
              borderRadius: '9999px',
              fontSize: isMobile ? '16px' : '17px',
              fontWeight: '700',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '12px',
              boxShadow: '0 6px 25px rgba(12, 182, 145, 0.3)',
              transition: 'box-shadow 0.2s ease',
            }}
          >
            <IoMdCloudUpload size={24} />
            Upload Video
          </motion.button>

          {!HIDE_URL_DOWNLOAD && (
          <motion.button
            whileHover={{ scale: 1.02, boxShadow: '0 8px 35px rgba(209, 245, 102, 0.4)' }}
            whileTap={{ scale: 0.98 }}
            onClick={() => {
              setFileManagerTab('download');
              setShowFileManager(true);
            }}
            style={{
              background: colors.accent,
              color: '#000',
              padding: isMobile ? '16px 24px' : '20px 32px',
              borderRadius: '9999px',
              fontSize: isMobile ? '16px' : '17px',
              fontWeight: '700',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '12px',
              boxShadow: '0 6px 25px rgba(209, 245, 102, 0.3)',
              transition: 'box-shadow 0.2s ease',
            }}
          >
            <FiLink size={22} />
            Download from URL
          </motion.button>
          )}

          <motion.button
            whileHover={{ scale: 1.02, boxShadow: '0 8px 35px rgba(12, 182, 145, 0.4)' }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setShowMultiSourceEditor(true)}
            style={{
              background: 'linear-gradient(135deg, #089477 0%, #4FD6B8 100%)',
              color: '#fff',
              padding: isMobile ? '16px 24px' : '16px 32px',
              borderRadius: '9999px',
              fontSize: isMobile ? '14px' : '15px',
              fontWeight: '600',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '12px',
              boxShadow: '0 6px 25px rgba(12, 182, 145, 0.3)',
              transition: 'box-shadow 0.2s ease',
            }}
          >
            <IoMdFilm size={22} />
            Multi-Source Editor
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.02, boxShadow: '0 8px 35px rgba(209, 245, 102, 0.4)' }}
            whileTap={{ scale: 0.98 }}
            onClick={() => {
              setFileManagerTab('files');
              loadVideos();
              setShowFileManager(true);
            }}
            style={{
              background: colors.gradientAccent,
              color: '#fff',
              padding: isMobile ? '16px 24px' : '16px 32px',
              borderRadius: '9999px',
              fontSize: isMobile ? '14px' : '15px',
              fontWeight: '600',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '12px',
              boxShadow: '0 6px 25px rgba(209, 245, 102, 0.3)',
              transition: 'box-shadow 0.2s ease',
            }}
          >
            <FiHardDrive size={22} />
            My Files
          </motion.button>
        </div>

        {/* Quick Features */}
        <div style={{
          marginTop: isMobile ? '32px' : '50px',
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: isMobile ? '10px' : '16px',
          width: '100%',
          maxWidth: '500px',
        }}>
          {[
            { icon: <IoMdCut size={24} />, label: 'Corte preciso', color: colors.primary },
            { icon: <MdBlurOn size={24} />, label: 'Face blur', color: colors.secondary },
            { icon: <IoMdCheckmarkCircle size={24} />, label: 'Lossless', color: colors.success },
          ]
            // En Android la censura de rostros no esta disponible (Python/OpenCV)
            .filter((f) => !(IS_ANDROID && f.label === 'Face blur'))
            .map((feature, i) => (
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
        </>)}

        {/* Gestion de archivos: home principal en Android */}
        {IS_ANDROID && (
          <div style={{ width: '100%', maxWidth: '500px' }}>
            {/* Logo oficial */}
            <div style={{ textAlign: 'center', marginBottom: '22px' }}>
              <img
                src="/logo.svg"
                alt="IguanaCut"
                style={{
                  height: '110px',
                  width: 'auto',
                  filter: 'drop-shadow(0 0 22px rgba(12, 182, 145, 0.45))',
                }}
              />
            </div>
            <motion.button
              whileTap={{ scale: 0.98 }}
              onClick={() => setShowEditor(true)}
              style={{
                width: '100%',
                background: colors.gradient,
                color: '#fff',
                padding: '16px 24px',
                borderRadius: '9999px',
                fontSize: '16px',
                fontWeight: '700',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '12px',
                boxShadow: '0 6px 25px rgba(12, 182, 145, 0.3)',
                marginBottom: '22px',
              }}
            >
              <IoMdCloudUpload size={24} />
              Upload Video
            </motion.button>

            {!HIDE_URL_DOWNLOAD && (
            <motion.button
              whileTap={{ scale: 0.98 }}
              onClick={() => {
                setFileManagerTab('download');
                setShowFileManager(true);
              }}
              style={{
                width: '100%',
                background: colors.accent,
                color: '#000',
                padding: '14px 24px',
                borderRadius: '9999px',
                fontSize: '15px',
                fontWeight: '700',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '12px',
                boxShadow: '0 6px 25px rgba(209, 245, 102, 0.3)',
                marginBottom: '22px',
              }}
            >
              <FiLink size={20} />
              Download from URL
            </motion.button>
            )}

            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '12px',
            }}>
              <h2 style={{ margin: 0, fontSize: '17px', fontWeight: '700', color: colors.text }}>
                <span style={{ color: colors.primary, marginRight: '8px' }}>◆</span>
                My Files
              </h2>
              <span style={{ color: colors.textMuted, fontSize: '13px' }}>
                {videos.length} {videos.length === 1 ? 'video' : 'videos'}
              </span>
            </div>
            {renderVideoList()}
          </div>
        )}

        {/* Keyboard Shortcuts: solo desktop (en movil no hay teclado fisico) */}
        {!isMobile && (
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
              { key: 'I', action: 'Set start', keyColor: colors.accent },
              { key: 'O', action: 'Set end', keyColor: colors.secondary },
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
        )}

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
          {isClearing ? 'Clearing...' : 'Clear all data'}
        </button>

        {/* Creditos del creador */}
        <div style={{
          marginTop: '40px',
          width: '100%',
          maxWidth: '420px',
          background: `linear-gradient(145deg, ${colors.card} 0%, ${colors.surface} 100%)`,
          border: `1px solid ${colors.border}`,
          borderRadius: '16px',
          padding: '18px 20px',
          textAlign: 'center',
        }}>
          <img
            src="/logo.svg"
            alt="IguanaCut"
            style={{ height: '32px', width: 'auto', marginBottom: '10px', filter: 'drop-shadow(0 0 10px rgba(12, 182, 145, 0.35))' }}
          />
          <div style={{ color: colors.text, fontSize: '14px', fontWeight: '600', marginBottom: '4px' }}>
            IguanaCut
          </div>
          <div style={{ color: colors.textMuted, fontSize: '12px', marginBottom: '14px' }}>
            Creado por <span style={{ color: colors.secondary, fontWeight: '600' }}>jhoniwana</span>
            {' '}· v1.0.0
          </div>
          <a
            href="https://github.com/jhoniwana/IguanaCut"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              background: colors.bg,
              border: `1px solid ${colors.border}`,
              color: colors.text,
              padding: isMobile ? '12px 20px' : '10px 18px',
              borderRadius: '9999px',
              textDecoration: 'none',
              fontSize: '13px',
              fontWeight: '600',
              transition: 'all 0.2s ease',
            }}
          >
            <FiGithub size={18} color={colors.primary} />
            github.com/jhoniwana/IguanaCut
          </a>
          <div style={{
            marginTop: '14px',
            color: colors.textMuted,
            fontSize: '11px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
          }}>
            <span>⚡ Powered by</span>
            <span style={{ color: colors.primary, fontWeight: '600' }}>FFmpeg</span>
            <span>·</span>
            <span>🦎 Iguana Edition</span>
          </div>
        </div>
      </main>

      {/* Footer: solo desktop (en movil ahorra espacio vertical) */}
      {!isMobile && <footer style={{
        borderTop: `1px solid ${colors.border}`,
        padding: '16px',
        textAlign: 'center',
        background: colors.surface,
        flexShrink: 0,
      }}>
        <p style={{
          color: colors.textMuted,
          fontSize: '12px',
          margin: 0,
        }}>
          Powered by <span style={{ color: colors.primary }}>FFmpeg</span>
        </p>
      </footer>}

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
              padding: isMobile ? '0' : '20px',
            }}
            // pointerdown (no click): en movil, al tocar un input el teclado
            // redimensiona la ventana y el click sintetico cae en el backdrop,
            // cerrando el modal justo cuando el usuario intenta escribir.
            onPointerDown={() => setShowFileManager(false)}
          >
            {/* Tarjeta sin animacion: framer-motion la colapsa a 1px en el WebView movil */}
            <div
              onClick={e => e.stopPropagation()}
              // Frenar tambien el pointerdown: sin esto, tocar cualquier
              // elemento interior (p.ej. el input de URL) burbujea al
              // backdrop y cierra el modal en movil.
              onPointerDown={e => e.stopPropagation()}
              style={{
                background: `linear-gradient(180deg, ${colors.card} 0%, ${colors.surface} 100%)`,
                borderRadius: isMobile ? '0' : '24px',
                padding: '0',
                maxWidth: isMobile ? '100%' : '700px',
                width: '100%',
                maxHeight: isMobile ? '100%' : '620px', // vh roto en el WebView (resuelve a 0)
                overflow: 'hidden',
                border: isMobile ? 'none' : `1px solid ${colors.border}`,
                boxShadow: isMobile ? 'none' : '0 20px 60px rgba(0, 0, 0, 0.5)',
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
                      {fileManagerTab === 'files' ? 'My Files' : 'Download Video'}
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
                    onClick={() => {
                      setFileManagerTab('files');
                      // Al volver a la lista, traer archivos y cortes nuevos.
                      loadVideos();
                      loadOutputs();
                    }}
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
                    Files ({videos.length})
                  </button>
                  {!HIDE_URL_DOWNLOAD && (
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
                    Download URL
                  </button>
                  )}
                </div>
              </div>

              {/* Tab Content */}
              <div style={{
                padding: '16px',
                maxHeight: '430px', // vh roto en el WebView
                overflowY: 'auto',
              }}>
                {/* Download Tab */}
                {!HIDE_URL_DOWNLOAD && fileManagerTab === 'download' && (
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
                          Paste the video URL
                        </span>
                      </div>
                      <input
                        type="text"
                        autoFocus
                        onFocus={(e) => e.target.select()}
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
                      <div style={{ display: 'flex', gap: '10px' }}>
                      <button
                        onClick={handlePlayUrl}
                        disabled={isDownloading || !downloadUrl.trim()}
                        title="Play the video without downloading (system player)"
                        style={{
                          flex: '0 0 auto',
                          background: colors.card,
                          color: colors.primary,
                          border: `1px solid ${colors.primary}`,
                          borderRadius: '9999px',
                          padding: '14px 18px',
                          fontSize: '15px',
                          fontWeight: '700',
                          cursor: (!isDownloading && downloadUrl.trim()) ? 'pointer' : 'not-allowed',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '8px',
                          opacity: (!isDownloading && downloadUrl.trim()) ? 1 : 0.5,
                        }}
                      >
                        <IoMdPlay size={18} />
                        Play
                      </button>
                      <button
                        onClick={startDownload}
                        disabled={isDownloading}
                        style={{
                          flex: 1,
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
                          boxShadow: isDownloading ? 'none' : '0 4px 20px rgba(12, 182, 145, 0.3)',
                        }}
                      >
                        {isDownloading ? (
                          <>
                            <IoMdRefresh size={20} style={{ animation: 'spin 1s linear infinite' }} />
                            Downloading...
                          </>
                        ) : (
                          <>
                            <FiDownload size={20} />
                            Download Video
                          </>
                        )}
                      </button>
                      </div>
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
                          {downloadProgress > 0 ? (
                            <span style={{
                              color: colors.primary,
                              fontSize: '14px',
                              fontWeight: '700',
                              fontFamily: 'monospace',
                            }}>
                              {downloadProgress.toFixed(1)}%
                            </span>
                          ) : (
                            <span style={{ color: colors.textMuted, fontSize: '12px', fontStyle: 'italic' }}>
                              Working...
                            </span>
                          )}
                        </div>
                        <div style={{
                          width: '100%',
                          height: '8px',
                          background: colors.border,
                          borderRadius: '4px',
                          overflow: 'hidden',
                        }}>
                          {downloadProgress > 0 ? (
                            <div style={{
                              width: `${downloadProgress}%`,
                              height: '100%',
                              background: colors.gradient,
                              borderRadius: '4px',
                              transition: 'width 0.3s ease',
                            }} />
                          ) : (
                            // Indeterminada mientras resuelve la URL o la
                            // descarga no reporta %: la barra no parece colgada.
                            <div style={{
                              width: '35%',
                              height: '100%',
                              background: colors.gradient,
                              borderRadius: '4px',
                              animation: 'indeterminate 1.1s infinite ease-in-out',
                            }} />
                          )}
                        </div>
                      </div>
                    )}

                    {/* Download complete: play or save to gallery */}
                    {downloadStatus === 'Download complete!' && completedDownloadName && (
                      <div style={{
                        background: `${colors.primary}18`,
                        border: `1px solid ${colors.primary}`,
                        borderRadius: '14px',
                        padding: '16px',
                        marginBottom: '16px',
                      }}>
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '10px',
                          marginBottom: '12px',
                          color: colors.text,
                          fontSize: '14px',
                          fontWeight: '600',
                        }}>
                          <IoMdCheckmarkCircle size={20} color={colors.primary} />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {completedDownloadName}
                          </span>
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button
                            onClick={() => playOutput(completedDownloadName, completedDownloadId || undefined)}
                            style={{
                              flex: 1,
                              background: colors.primary,
                              border: 'none',
                              color: '#000',
                              padding: '12px 16px',
                              borderRadius: '12px',
                              cursor: 'pointer',
                              fontSize: '14px',
                              fontWeight: '700',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '8px',
                            }}
                          >
                            <IoMdPlay size={18} /> Play
                          </button>
                          <button
                            onClick={() => saveToGallery(completedDownloadName)}
                            style={{
                              flex: 1,
                              background: colors.card,
                              border: `1px solid ${colors.border}`,
                              color: colors.text,
                              padding: '12px 16px',
                              borderRadius: '12px',
                              cursor: 'pointer',
                              fontSize: '14px',
                              fontWeight: '600',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '8px',
                            }}
                          >
                            <IoMdCloudDownload size={18} /> Save to gallery
                          </button>
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
                        {['YouTube', 'TikTok', 'Instagram', 'Twitter/X', 'Facebook', 'Vimeo', '+1000 more'].map((site) => (
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
                {fileManagerTab === 'files' && renderVideoList()}

              </div>
            </div>
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
              padding: isMobile ? '0' : '20px',
              overflowY: 'auto',
            }}
            onClick={() => setShowTutorial(false)}
          >
            {/* Tarjeta sin animacion (framer-motion la colapsa en movil) */}
            <div
              onClick={e => e.stopPropagation()}
              style={{
                background: `linear-gradient(180deg, ${colors.card} 0%, ${colors.surface} 100%)`,
                borderRadius: isMobile ? '0' : '24px',
                padding: isMobile ? '24px 18px' : '28px',
                maxWidth: isMobile ? '100%' : '600px',
                width: '100%',
                maxHeight: isMobile ? '100%' : '700px', // vh roto en el WebView
                overflowY: 'auto',
                border: isMobile ? 'none' : `1px solid ${colors.border}`,
                boxShadow: isMobile ? 'none' : '0 20px 60px rgba(0, 0, 0, 0.5)',
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
                    How to use?
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
                {tutorialSteps
                  // En Android la censura de rostros no esta disponible
                  .filter((s) => !(IS_ANDROID && s.title === 'Face blur'))
                  .map((s, idx) => ({ ...s, step: idx + 1 }))
                  .map((step) => (
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
                  boxShadow: '0 4px 20px rgba(12, 182, 145, 0.3)',
                }}
              >
                Got it!
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showEditor && (
          <VideoEditor
            onClose={() => {
              setShowEditor(false);
              setSelectedVideoId(null);
              // Refrescar la lista al volver: el usuario acaba de exportar.
              loadVideos();
              loadOutputs();
            }}
            onOpenFiles={() => {
              setFileManagerTab('files');
              loadVideos();
              loadOutputs();
              setShowFileManager(true);
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
              onClose={() => {
                setShowMultiSourceEditor(false);
                loadVideos();
                loadOutputs();
              }}
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
        @keyframes indeterminate {
          from { transform: translateX(-100%); }
          to { transform: translateX(350%); }
        }
      `}</style>
    </div>
  );
}

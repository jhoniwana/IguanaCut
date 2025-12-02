import { useState, useEffect, CSSProperties } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  IoMdClose, 
  IoMdDownload, 
  IoMdCheckmark, 
  IoMdWarning,
  IoMdLink,
  IoMdVideocam,
  IoMdMusicalNotes,
  IoMdImages,
  IoMdDocument,
  IoMdTime,
  IoMdFolder
} from 'react-icons/io';
import { 
  FaYoutube, 
  FaVimeo, 
  FaTwitter,
  FaFacebook,
  FaInstagram,
  FaTiktok,
  FaTwitch,
  FaSoundcloud,
  FaSpotify
} from 'react-icons/fa';
import { apiClient, Download } from '../api/client';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onDownloadComplete?: (download: Download) => void;
}

// Enhanced color palette with better contrast
const colors = {
  bg: '#0a0a0a',
  surface: '#141414',
  surfaceLight: '#1a1a1a',
  border: '#2a2a2a',
  accent1: '#00ff88', // Neon green
  accent2: '#ff6b35', // Orange
  accent3: '#a855f7', // Purple
  accent4: '#00d4ff', // Cyan
  accent5: '#ff006e', // Pink
  text: '#ffffff',
  textMuted: '#888888',
  textLight: '#cccccc',
  danger: '#ff3333',
  success: '#00c851',
  warning: '#ffaa00',
};

// Add CSS animations
const styleSheet = document.createElement('style');
styleSheet.textContent = `
  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    25% { transform: translateX(-5px); }
    75% { transform: translateX(5px); }
  }
`;
document.head.appendChild(styleSheet);

const styles: Record<string, CSSProperties> = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    backgroundColor: colors.surface,
    border: `3px solid ${colors.accent4}`,
    boxShadow: `12px 12px 0 ${colors.accent4}`,
    width: '90%',
    maxWidth: '700px',
    maxHeight: '80vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    background: colors.bg,
    borderBottom: `3px solid ${colors.accent4}`,
    color: colors.text,
    padding: '20px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    fontSize: '18px',
    fontWeight: '900',
    textTransform: 'uppercase' as const,
    letterSpacing: '1px',
  },
  closeButton: {
    background: 'transparent',
    border: `2px solid ${colors.text}`,
    color: colors.text,
    padding: '8px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    transition: 'all 0.15s',
  },
  inputSection: {
    padding: '20px',
    backgroundColor: colors.bg,
    borderBottom: `2px solid ${colors.border}`,
  },
  inputRow: {
    display: 'flex',
    gap: '12px',
  },
  input: {
    flex: 1,
    padding: '14px 16px',
    border: `2px solid ${colors.border}`,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: '14px',
    outline: 'none',
    fontFamily: 'inherit',
  },
  button: {
    padding: '14px 24px',
    backgroundColor: colors.accent4,
    color: colors.bg,
    border: 'none',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '12px',
    fontWeight: '900',
    textTransform: 'uppercase' as const,
    letterSpacing: '1px',
    transition: 'all 0.15s',
  },
  buttonDisabled: {
    backgroundColor: colors.border,
    color: colors.textMuted,
    cursor: 'not-allowed',
  },
  hint: {
    fontSize: '11px',
    color: colors.textMuted,
    marginTop: '12px',
    textTransform: 'uppercase' as const,
    letterSpacing: '1px',
  },
  content: {
    flex: 1,
    padding: '20px',
    overflowY: 'auto',
    backgroundColor: colors.surface,
  },
  emptyState: {
    textAlign: 'center',
    padding: '48px 0',
    color: colors.textMuted,
  },
  downloadItem: {
    padding: '16px',
    border: `2px solid ${colors.border}`,
    marginBottom: '12px',
    backgroundColor: colors.bg,
  },
  downloadRow: {
    display: 'flex',
    gap: '12px',
    alignItems: 'flex-start',
  },
  downloadInfo: {
    flex: 1,
    minWidth: 0,
  },
  downloadTitle: {
    fontWeight: '700',
    marginBottom: '4px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: colors.text,
  },
  downloadUrl: {
    fontSize: '11px',
    color: colors.textMuted,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontFamily: 'monospace',
  },
  progressBar: {
    width: '100%',
    height: '8px',
    backgroundColor: colors.border,
    overflow: 'hidden',
    marginTop: '12px',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.accent4,
    transition: 'width 0.3s',
  },
  progressText: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '10px',
    color: colors.textMuted,
    marginBottom: '4px',
    textTransform: 'uppercase' as const,
    letterSpacing: '1px',
  },
  successText: {
    marginTop: '12px',
    fontSize: '12px',
    color: colors.accent1,
    fontWeight: '700',
    textTransform: 'uppercase' as const,
  },
  errorText: {
    marginTop: '12px',
    fontSize: '12px',
    color: colors.danger,
    fontWeight: '700',
  },
};

export default function DownloadModal({ isOpen, onClose, onDownloadComplete }: Props) {
  const [url, setUrl] = useState('');
  const [downloads, setDownloads] = useState<Download[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [previousDownloads, setPreviousDownloads] = useState<Download[]>([]);

  useEffect(() => {
    if (isOpen) {
      loadDownloads();
      const interval = setInterval(loadDownloads, 2000);
      return () => clearInterval(interval);
    }
  }, [isOpen]);

  // Check for newly completed downloads
  useEffect(() => {
    if (!onDownloadComplete) return;

    downloads.forEach((download) => {
      const prevDownload = previousDownloads.find(d => d.id === download.id);

      // If download just completed (wasn't completed before, is completed now)
      if (download.status === 'completed' && prevDownload?.status !== 'completed' && download.video_id) {
        onDownloadComplete(download);
      }
    });

    setPreviousDownloads(downloads);
  }, [downloads, onDownloadComplete]);

  const loadDownloads = async () => {
    try {
      const { downloads: downloadList } = await apiClient.listDownloads();
      setDownloads(downloadList || []);
    } catch (error) {
      console.error('Failed to load downloads:', error);
    }
  };

  const handleStartDownload = async () => {
    if (!url.trim()) {
      // Show friendly validation
      const input = document.querySelector('input[type="text"]') as HTMLInputElement;
      if (input) {
        input.style.borderColor = colors.danger;
        input.style.animation = 'shake 0.5s';
        setTimeout(() => {
          input.style.borderColor = colors.border;
          input.style.animation = '';
        }, 500);
      }
      return;
    }
    
    setIsLoading(true);
    try {
      const download = await apiClient.startDownload(url);
      setDownloads((prev) => [download, ...prev]);
      setUrl('');
    } catch (error: any) {
      // Better error handling
      console.error('Download failed:', error);
      const errorMessage = error.message || 'Failed to start download';
      // Show error in UI instead of alert
      setDownloads((prev) => [{
        id: `error-${Date.now()}`,
        url,
        title: 'Download Failed',
        status: 'failed',
        error: errorMessage,
        progress: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, ...prev]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClearAll = async () => {
    if (!confirm('Delete all download history? Downloaded videos will be removed.')) return;

    try {
      await apiClient.clearAllDownloads();
      setDownloads([]);
      alert('All downloads cleared successfully');
    } catch (error: any) {
      alert(`Failed to clear downloads: ${error.message}`);
    }
  };

  const getStatusIcon = (status: Download['status']) => {
    const iconStyle = { fontSize: '20px' };
    switch (status) {
      case 'completed':
        return <IoMdCheckmark style={{ ...iconStyle, color: colors.success }} />;
      case 'failed':
        return <IoMdWarning style={{ ...iconStyle, color: colors.danger }} />;
      case 'downloading':
        return <IoMdDownload style={{ ...iconStyle, color: colors.accent4 }} />;
      default:
        return <IoMdDownload style={{ ...iconStyle, color: colors.textMuted }} />;
    }
  };

  const getPlatformIcon = (url: string) => {
    const domain = url.toLowerCase();
    if (domain.includes('youtube.com') || domain.includes('youtu.be')) {
      return <FaYoutube size={20} color={colors.accent1} />;
    } else if (domain.includes('vimeo.com')) {
      return <FaVimeo size={20} color={colors.accent4} />;
    } else if (domain.includes('twitter.com') || domain.includes('x.com')) {
      return <FaTwitter size={20} color={colors.accent5} />;
    } else if (domain.includes('facebook.com')) {
      return <FaFacebook size={20} color={colors.accent2} />;
    } else if (domain.includes('instagram.com')) {
      return <FaInstagram size={20} color={colors.accent3} />;
    } else if (domain.includes('tiktok.com')) {
      return <FaTiktok size={20} color={colors.danger} />;
    } else if (domain.includes('twitch.tv')) {
      return <FaTwitch size={20} color={colors.accent4} />;
    } else if (domain.includes('soundcloud.com')) {
      return <FaSoundcloud size={20} color={colors.accent1} />;
    } else {
      return <IoMdVideocam size={20} color={colors.textMuted} />;
    }
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return 'Unknown size';
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  };

  const formatTime = (seconds?: number) => {
    if (!seconds) return 'Unknown time';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          style={styles.overlay}
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: 'spring', damping: 20 }}
            style={styles.modal}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Enhanced Header */}
            <div style={{
              ...styles.header,
              background: `linear-gradient(135deg, ${colors.surface}, ${colors.surfaceLight})`,
            }}>
              <div style={styles.headerTitle}>
                <motion.div
                  initial={{ rotate: 0 }}
                  animate={{ rotate: 360 }}
                  transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
                  style={{
                    width: '48px',
                    height: '48px',
                    background: `linear-gradient(135deg, ${colors.accent4}, ${colors.accent1})`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: '12px',
                    boxShadow: `0 4px 20px rgba(0, 212, 255, 0.3)`,
                  }}
                >
                  <IoMdDownload size={24} color={colors.bg} />
                </motion.div>
                <div>
                  <span style={{ 
                    fontSize: '20px', 
                    fontWeight: '900', 
                    textTransform: 'uppercase',
                    letterSpacing: '1px',
                    display: 'block',
                    marginBottom: '4px',
                  }}>Smart Downloader</span>
                  <span style={{ 
                    fontSize: '11px', 
                    color: colors.textMuted,
                    textTransform: 'uppercase',
                    letterSpacing: '1px',
                  }}>Powered by yt-dlp</span>
                </div>
              </div>
              <motion.button
                whileHover={{ scale: 1.1, rotate: 90 }}
                whileTap={{ scale: 0.9 }}
                style={{
                  ...styles.closeButton,
                  width: '40px',
                  height: '40px',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                onClick={onClose}
              >
                <IoMdClose size={20} />
              </motion.button>
            </div>

            {/* Enhanced Input Section */}
            <div style={{
              ...styles.inputSection,
              background: colors.bg,
            }}>
              <div style={{ marginBottom: '16px' }}>
                <label style={{
                  display: 'block',
                  fontSize: '12px',
                  fontWeight: '700',
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                  color: colors.textMuted,
                  marginBottom: '8px',
                }}>Video URL</label>
                <div style={styles.inputRow}>
                  <div style={{ position: 'relative', flex: 1 }}>
                    <input
                      type="text"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="https://www.youtube.com/watch?v=..."
                      style={{
                        ...styles.input,
                        fontSize: '16px',
                        padding: '16px 20px 16px 50px',
                        borderRadius: '12px',
                        border: `2px solid ${colors.border}`,
                        transition: 'all 0.3s ease',
                      }}
                      onKeyPress={(e) => e.key === 'Enter' && handleStartDownload()}
                      onFocus={(e) => {
                        e.currentTarget.style.borderColor = colors.accent4;
                        e.currentTarget.style.boxShadow = `0 0 0 3px rgba(0, 212, 255, 0.2)`;
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.borderColor = colors.border;
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                    />
                    {url && (
                      <div style={{
                        position: 'absolute',
                        left: '16px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        fontSize: '20px',
                      }}>
                        {getPlatformIcon(url)}
                      </div>
                    )}
                  </div>
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={handleStartDownload}
                    disabled={isLoading || !url.trim()}
                    style={{
                      ...styles.button,
                      background: isLoading || !url.trim() 
                        ? colors.border 
                        : `linear-gradient(135deg, ${colors.accent4}, ${colors.accent1})`,
                      borderRadius: '12px',
                      padding: '16px 24px',
                      fontSize: '14px',
                      fontWeight: 'bold',
                      border: 'none',
                      minWidth: '120px',
                      boxShadow: isLoading || !url.trim() ? 'none' : `0 4px 20px rgba(0, 212, 255, 0.3)`,
                    }}
                  >
                    {isLoading ? (
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                        style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                      >
                        <IoMdDownload size={18} />
                        Starting...
                      </motion.div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <IoMdDownload size={18} />
                        Download
                      </div>
                    )}
                  </motion.button>
                </div>
              </div>
              
              {/* Supported Sites */}
              <div style={{
                background: colors.surfaceLight,
                borderRadius: '8px',
                padding: '16px',
                marginBottom: '16px',
              }}>
                <div style={{
                  fontSize: '11px',
                  fontWeight: '700',
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                  color: colors.textMuted,
                  marginBottom: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}>
                  <IoMdLink size={14} />
                  Supported Platforms
                </div>
                <div style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '12px',
                  justifyContent: 'center',
                }}>
                  {[
                    { icon: <FaYoutube size={20} />, name: 'YouTube' },
                    { icon: <FaVimeo size={20} />, name: 'Vimeo' },
                    { icon: <FaTwitter size={20} />, name: 'Twitter' },
                    { icon: <FaTiktok size={20} />, name: 'TikTok' },
                    { icon: <FaInstagram size={20} />, name: 'Instagram' },
                    { icon: <FaFacebook size={20} />, name: 'Facebook' },
                    { icon: <FaTwitch size={20} />, name: 'Twitch' },
                    { icon: <FaSoundcloud size={20} />, name: 'SoundCloud' },
                  ].map((platform, index) => (
                    <motion.div
                      key={platform.name}
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: index * 0.1 }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '8px 12px',
                        background: colors.bg,
                        border: `1px solid ${colors.border}`,
                        borderRadius: '6px',
                        fontSize: '11px',
                        color: colors.textLight,
                      }}
                    >
                      <div style={{ color: colors.accent4 }}>{platform.icon}</div>
                      <span>{platform.name}</span>
                    </motion.div>
                  ))}
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{
                  fontSize: '11px',
                  color: colors.textMuted,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}>
                  <IoMdFolder size={14} />
                  {downloads.length} download{downloads.length !== 1 ? 's' : ''} in queue
                </div>
                {downloads.length > 0 && (
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={handleClearAll}
                    style={{
                      background: 'transparent',
                      border: `1px solid ${colors.danger}`,
                      color: colors.danger,
                      cursor: 'pointer',
                      fontSize: '10px',
                      fontWeight: '700',
                      textTransform: 'uppercase',
                      letterSpacing: '1px',
                      padding: '8px 16px',
                      borderRadius: '6px',
                      transition: 'all 0.3s ease',
                    }}
                    onMouseOver={(e) => {
                      e.currentTarget.style.background = colors.danger;
                      e.currentTarget.style.color = colors.bg;
                    }}
                    onMouseOut={(e) => {
                      e.currentTarget.style.background = 'transparent';
                      e.currentTarget.style.color = colors.danger;
                    }}
                  >
                    Clear All
                  </motion.button>
                )}
              </div>
            </div>

            {/* Enhanced Downloads List */}
            <div style={{
              ...styles.content,
              background: colors.surface,
            }}>
              {downloads.length === 0 ? (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  style={styles.emptyState}
                >
                  <motion.div
                    animate={{ scale: [1, 1.1, 1] }}
                    transition={{ duration: 2, repeat: Infinity }}
                    style={{
                      width: '100px',
                      height: '100px',
                      border: `3px solid ${colors.border}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      margin: '0 auto 24px',
                      borderRadius: '20px',
                      background: colors.bg,
                    }}
                  >
                    <IoMdVideocam size={48} style={{ opacity: 0.5 }} />
                  </motion.div>
                  <h3 style={{ 
                    fontSize: '18px', 
                    fontWeight: '700', 
                    textTransform: 'uppercase', 
                    letterSpacing: '1px',
                    marginBottom: '8px',
                    color: colors.text,
                  }}>Ready to Download</h3>
                  <p style={{ 
                    fontSize: '13px', 
                    color: colors.textMuted, 
                    lineHeight: '1.5',
                    maxWidth: '300px',
                    margin: '0 auto',
                  }}>
                    Paste a video URL above to start downloading from 1000+ supported platforms
                  </p>
                </motion.div>
              ) : (
                <div>
                  <div style={{
                    fontSize: '11px',
                    fontWeight: '700',
                    textTransform: 'uppercase',
                    letterSpacing: '1px',
                    color: colors.textMuted,
                    marginBottom: '16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}>
                    <IoMdTime size={14} />
                    Download Queue
                  </div>
                  {downloads.map((download, index) => (
                    <motion.div
                      key={download.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.1 }}
                      style={{
                        ...styles.downloadItem,
                        background: colors.bg,
                        borderRadius: '12px',
                        border: `2px solid ${
                          download.status === 'downloading' ? colors.accent4 :
                          download.status === 'completed' ? colors.success :
                          download.status === 'failed' ? colors.danger : colors.border
                        }`,
                      }}
                    >
                      <div style={styles.downloadRow}>
                        <div style={{
                          width: '48px',
                          height: '48px',
                          border: `2px solid ${
                            download.status === 'completed' ? colors.success :
                            download.status === 'failed' ? colors.danger :
                            download.status === 'downloading' ? colors.accent4 : colors.border
                          }`,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderRadius: '8px',
                          flexShrink: 0,
                          background: colors.surface,
                        }}>
                          {getStatusIcon(download.status)}
                        </div>
                        <div style={styles.downloadInfo}>
                          <div style={{
                            ...styles.downloadTitle,
                            fontSize: '14px',
                            marginBottom: '4px',
                          }}>{download.title || 'Untitled Video'}</div>
                          <div style={{
                            ...styles.downloadUrl,
                            fontSize: '11px',
                            marginBottom: '8px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                          }}>
                            <span style={{ color: colors.textMuted }}>From:</span>
                            {getPlatformIcon(download.url)}
                            <span style={{ 
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              flex: 1,
                            }}>{download.url}</span>
                          </div>

                          {download.status === 'downloading' && (
                            <div>
                              <div style={styles.progressText}>
                                <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <IoMdDownload size={12} />
                                  Downloading...
                                  <span style={{ 
                                    background: colors.accent4,
                                    color: colors.bg,
                                    padding: '2px 6px',
                                    borderRadius: '4px',
                                    fontSize: '10px',
                                    fontWeight: 'bold',
                                  }}>{download.progress.toFixed(1)}%</span>
                                </span>
                              </div>
                              <div style={styles.progressBar}>
                                <motion.div
                                  style={{
                                    ...styles.progressFill,
                                    background: `linear-gradient(90deg, ${colors.accent4}, ${colors.accent1})`,
                                  }}
                                  initial={{ width: 0 }}
                                  animate={{ width: `${download.progress}%` }}
                                  transition={{ duration: 0.3 }}
                                />
                              </div>
                            </div>
                          )}

                          {download.status === 'completed' && (
                            <motion.div
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              style={{
                                ...styles.successText,
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                background: colors.success,
                                color: colors.bg,
                                padding: '6px 12px',
                                borderRadius: '6px',
                                fontSize: '11px',
                              }}
                            >
                              <IoMdCheckmark size={14} />
                              Ready to Edit
                            </motion.div>
                          )}

                          {download.status === 'failed' && (
                            <div style={{
                              ...styles.errorText,
                              display: 'flex',
                              alignItems: 'flex-start',
                              gap: '8px',
                              background: 'rgba(255, 51, 51, 0.1)',
                              padding: '8px 12px',
                              borderRadius: '6px',
                              border: `1px solid ${colors.danger}`,
                            }}>
                              <IoMdWarning size={14} style={{ color: colors.danger, flexShrink: 0 }} />
                              <div>
                                <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>Download Failed</div>
                                <div style={{ fontSize: '11px', opacity: 0.8 }}>
                                  {download.error || 'Unknown error occurred'}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

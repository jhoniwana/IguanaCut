import { useState, useRef, useCallback } from 'react';
import { FiUpload, FiLink, FiTrash2, FiPlay, FiCheck, FiPlus, FiLayers } from 'react-icons/fi';
import { IoMdAdd, IoMdClose } from 'react-icons/io';
import { MdPlaylistAdd } from 'react-icons/md';
import { apiClient, Video } from '../api/client';

// Colors matching VideoEditor.tsx
const colors = {
  bg: '#0a0a0f',
  surface: '#12121a',
  card: '#1a1a24',
  border: '#2a2a3a',
  primary: '#00E5FF',
  secondary: '#FF148A',
  accent: '#FFC800',
  danger: '#ff4466',
  text: '#ffffff',
  textSecondary: '#b0b0c0',
  textMuted: '#606070',
};

// Source colors for clips - each source gets a unique color
const sourceColors = [
  '#00E5FF', // Cyan
  '#FF148A', // Pink
  '#FFC800', // Yellow
  '#00FF88', // Green
  '#FF6B35', // Orange
  '#A855F7', // Purple
  '#38BDF8', // Light blue
  '#FB7185', // Light pink
];

export interface SourceVideo {
  video: Video;
  thumbnail?: string;
  color: string;
}

interface SourcePanelProps {
  sources: SourceVideo[];
  activeSourceId: string | null;
  onSourceSelect: (video: Video) => void;
  onSourceAdd: (videos: Video[]) => void;
  onSourceRemove: (videoId: string) => void;
  onUrlDownload?: (url: string) => void;
  onAddToTimeline?: (videoId: string, start: number, end: number) => void;
  onAddAllToTimeline?: () => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export default function SourcePanel({
  sources,
  activeSourceId,
  onSourceSelect,
  onSourceAdd,
  onSourceRemove,
  onUrlDownload,
  onAddToTimeline,
  onAddAllToTimeline,
  isCollapsed = false,
  onToggleCollapse,
}: SourcePanelProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlValue, setUrlValue] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    setIsUploading(true);
    setUploadProgress(0);

    try {
      const fileArray = Array.from(files);

      if (fileArray.length === 1) {
        const result = await apiClient.uploadVideo(fileArray[0], setUploadProgress);
        onSourceAdd([result.video]);
      } else {
        const result = await apiClient.batchUpload(fileArray, setUploadProgress);
        if (result.videos.length > 0) {
          onSourceAdd(result.videos);
        }
        if (result.errors.length > 0) {
          console.error('Upload errors:', result.errors);
        }
      }
    } catch (error) {
      console.error('Upload failed:', error);
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  }, [onSourceAdd]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFileSelect(e.dataTransfer.files);
  }, [handleFileSelect]);

  const handleUrlSubmit = useCallback(() => {
    if (urlValue.trim() && onUrlDownload) {
      onUrlDownload(urlValue.trim());
      setUrlValue('');
      setShowUrlInput(false);
    }
  }, [urlValue, onUrlDownload]);

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (isCollapsed) {
    return (
      <div
        style={{
          width: 48,
          backgroundColor: colors.surface,
          borderRight: `1px solid ${colors.border}`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '12px 0',
        }}
      >
        <button
          onClick={onToggleCollapse}
          style={{
            background: 'none',
            border: 'none',
            color: colors.textSecondary,
            cursor: 'pointer',
            padding: 8,
            borderRadius: 8,
          }}
          title="Expandir panel de fuentes"
        >
          <IoMdAdd size={24} />
        </button>
        <div style={{ marginTop: 16, color: colors.textMuted, fontSize: 10 }}>
          {sources.length}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        width: 280,
        backgroundColor: colors.surface,
        borderRight: `1px solid ${colors.border}`,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '16px',
          borderBottom: `1px solid ${colors.border}`,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: sources.length > 0 && onAddAllToTimeline ? 12 : 0,
          }}
        >
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: colors.text }}>
            Fuentes ({sources.length})
          </h3>
          {onToggleCollapse && (
            <button
              onClick={onToggleCollapse}
              style={{
                background: 'none',
                border: 'none',
                color: colors.textMuted,
                cursor: 'pointer',
                padding: 4,
              }}
            >
              <IoMdClose size={18} />
            </button>
          )}
        </div>

        {/* Add All to Timeline button */}
        {sources.length > 0 && onAddAllToTimeline && (
          <button
            onClick={onAddAllToTimeline}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: '10px 12px',
              background: `linear-gradient(135deg, ${colors.secondary} 0%, ${colors.accent} 100%)`,
              color: '#000',
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
              transition: 'transform 0.2s, box-shadow 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.02)';
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(255, 20, 138, 0.3)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            <FiLayers size={16} />
            Agregar Todos a Timeline ({sources.length})
          </button>
        )}
      </div>

      {/* Add buttons */}
      <div style={{ padding: '12px 16px', display: 'flex', gap: 8 }}>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            padding: '10px 12px',
            backgroundColor: colors.primary,
            color: colors.bg,
            border: 'none',
            borderRadius: 8,
            cursor: isUploading ? 'wait' : 'pointer',
            fontSize: 13,
            fontWeight: 500,
            transition: 'opacity 0.2s',
            opacity: isUploading ? 0.7 : 1,
          }}
        >
          <FiUpload size={16} />
          {isUploading ? 'Subiendo...' : 'Subir'}
        </button>

        {onUrlDownload && (
          <button
            onClick={() => setShowUrlInput(!showUrlInput)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '10px 12px',
              backgroundColor: colors.card,
              color: colors.text,
              border: `1px solid ${colors.border}`,
              borderRadius: 8,
              cursor: 'pointer',
            }}
          >
            <FiLink size={16} />
          </button>
        )}
      </div>

      {/* URL Input */}
      {showUrlInput && (
        <div style={{ padding: '0 16px 12px', display: 'flex', gap: 8 }}>
          <input
            type="text"
            value={urlValue}
            onChange={(e) => setUrlValue(e.target.value)}
            placeholder="Pegar URL de video..."
            onKeyDown={(e) => e.key === 'Enter' && handleUrlSubmit()}
            style={{
              flex: 1,
              padding: '8px 12px',
              backgroundColor: colors.card,
              color: colors.text,
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              fontSize: 13,
              outline: 'none',
            }}
          />
          <button
            onClick={handleUrlSubmit}
            disabled={!urlValue.trim()}
            style={{
              padding: '8px 12px',
              backgroundColor: colors.secondary,
              color: colors.text,
              border: 'none',
              borderRadius: 6,
              cursor: urlValue.trim() ? 'pointer' : 'not-allowed',
              opacity: urlValue.trim() ? 1 : 0.5,
            }}
          >
            <FiCheck size={16} />
          </button>
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="video/*,audio/*"
        onChange={(e) => handleFileSelect(e.target.files)}
        style={{ display: 'none' }}
      />

      {/* Drop zone / Sources list */}
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '0 16px 16px',
        }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        {sources.length === 0 ? (
          <div
            style={{
              padding: 24,
              border: `2px dashed ${dragOver ? colors.primary : colors.border}`,
              borderRadius: 12,
              textAlign: 'center',
              color: colors.textMuted,
              transition: 'border-color 0.2s',
              backgroundColor: dragOver ? `${colors.primary}10` : 'transparent',
            }}
          >
            <FiUpload size={32} style={{ marginBottom: 12, opacity: 0.5 }} />
            <p style={{ margin: 0, fontSize: 13 }}>
              Arrastra archivos aquí o haz clic en "Subir"
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {sources.map((source) => (
              <div
                key={source.video.id}
                onClick={() => onSourceSelect(source.video)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: 10,
                  backgroundColor: activeSourceId === source.video.id ? `${source.color}20` : colors.card,
                  border: `1px solid ${activeSourceId === source.video.id ? source.color : colors.border}`,
                  borderRadius: 8,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                {/* Color indicator */}
                <div
                  style={{
                    width: 4,
                    height: 40,
                    backgroundColor: source.color,
                    borderRadius: 2,
                    flexShrink: 0,
                  }}
                />

                {/* Thumbnail */}
                <div
                  style={{
                    width: 56,
                    height: 40,
                    backgroundColor: colors.bg,
                    borderRadius: 4,
                    overflow: 'hidden',
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {source.thumbnail ? (
                    <img
                      src={source.thumbnail}
                      alt=""
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    <FiPlay size={16} style={{ color: colors.textMuted }} />
                  )}
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      color: colors.text,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {source.video.file_name}
                  </div>
                  <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>
                    {formatDuration(source.video.duration)} • {formatFileSize(source.video.file_size)}
                  </div>
                </div>

                {/* Action buttons */}
                <div style={{ display: 'flex', gap: 4 }}>
                  {/* Add to timeline button */}
                  {onAddToTimeline && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onAddToTimeline(source.video.id, 0, source.video.duration);
                      }}
                      style={{
                        background: colors.primary,
                        border: 'none',
                        color: colors.bg,
                        cursor: 'pointer',
                        padding: 6,
                        borderRadius: 4,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'transform 0.2s',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.1)')}
                      onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
                      title="Agregar video completo a timeline"
                    >
                      <MdPlaylistAdd size={16} />
                    </button>
                  )}

                  {/* Delete button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onSourceRemove(source.video.id);
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: colors.textMuted,
                      cursor: 'pointer',
                      padding: 4,
                      borderRadius: 4,
                      opacity: 0.6,
                      transition: 'opacity 0.2s',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
                    onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.6')}
                  >
                    <FiTrash2 size={14} />
                  </button>
                </div>
              </div>
            ))}

            {/* Drop zone at bottom */}
            <div
              style={{
                padding: 16,
                border: `2px dashed ${dragOver ? colors.primary : colors.border}`,
                borderRadius: 8,
                textAlign: 'center',
                color: colors.textMuted,
                fontSize: 12,
                transition: 'all 0.2s',
                backgroundColor: dragOver ? `${colors.primary}10` : 'transparent',
              }}
            >
              + Agregar más videos
            </div>
          </div>
        )}
      </div>

      {/* Upload progress */}
      {isUploading && (
        <div style={{ padding: '0 16px 16px' }}>
          <div
            style={{
              height: 4,
              backgroundColor: colors.border,
              borderRadius: 2,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${uploadProgress}%`,
                height: '100%',
                backgroundColor: colors.primary,
                transition: 'width 0.3s',
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// Helper to get source color by index
export function getSourceColor(index: number): string {
  return sourceColors[index % sourceColors.length];
}

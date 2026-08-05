import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { FiTrash2, FiEdit2, FiPlay } from 'react-icons/fi';
import { IoMdReorder } from 'react-icons/io';
import { TimelineClip, Video } from '../api/client';
import { SourceVideo, getSourceColor } from './SourcePanel';

// Colors matching VideoEditor.tsx
const colors = {
  bg: '#0a0a0f',
  surface: '#12121a',
  card: '#1a1a24',
  border: '#2a2a3a',
  primary: '#8B5CF6',
  secondary: '#A78BFA',
  accent: '#C084FC',
  danger: '#ff4466',
  text: '#ffffff',
  textSecondary: '#b0b0c0',
  textMuted: '#606070',
};

interface MultiClipTimelineProps {
  clips: TimelineClip[];
  sources: SourceVideo[];
  totalDuration: number;
  currentTime: number;
  playbackMode: 'source' | 'timeline';
  onClipSelect: (clip: TimelineClip) => void;
  onClipDelete: (clipId: string) => void;
  onClipReorder: (clipIds: string[]) => void;
  onClipEdit?: (clip: TimelineClip) => void;
  onSeek: (time: number) => void;
  selectedClipId?: string | null;
  selectedClipIds?: Set<string>;
  waveformUrl?: string | null;
  zoom?: number;
  onZoomChange?: (zoom: number) => void;
  onMultiSelect?: (clipId: string, addToSelection: boolean) => void;
  getThumbnailUrl?: (videoId: string, time: number) => string;
}

export default function MultiClipTimeline({
  clips,
  sources,
  totalDuration,
  currentTime,
  playbackMode,
  onClipSelect,
  onClipDelete,
  onClipReorder,
  onClipEdit,
  onSeek,
  selectedClipId,
  selectedClipIds,
  waveformUrl,
  zoom = 1,
  onZoomChange,
  onMultiSelect,
  getThumbnailUrl,
}: MultiClipTimelineProps) {
  const timelineRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [draggedClipId, setDraggedClipId] = useState<string | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [hoveredClipId, setHoveredClipId] = useState<string | null>(null);

  // Scrubbing preview state
  const [scrubTime, setScrubTime] = useState<number | null>(null);
  const [scrubPosition, setScrubPosition] = useState({ x: 0, y: 0 });
  const [isScrubbing, setIsScrubbing] = useState(false);

  // Memoized maps for O(1) lookups instead of O(n) find operations
  const sourceColorMap = useMemo(() => {
    const map = new Map<string, string>();
    sources.forEach((source, index) => {
      map.set(source.video.id, source.color);
    });
    return map;
  }, [sources]);

  const sourceNameMap = useMemo(() => {
    const map = new Map<string, string>();
    sources.forEach(source => {
      map.set(source.video.id, source.video.file_name);
    });
    return map;
  }, [sources]);

  // Get source color for a clip - O(1) with memoized map
  const getClipColor = useCallback((clip: TimelineClip): string => {
    return sourceColorMap.get(clip.source_video_id) || getSourceColor(0);
  }, [sourceColorMap]);

  // Get source name for a clip - O(1) with memoized map
  const getSourceName = useCallback((clip: TimelineClip): string => {
    return sourceNameMap.get(clip.source_video_id) || 'Unknown';
  }, [sourceNameMap]);

  // Format time
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 10);
    return `${mins}:${secs.toString().padStart(2, '0')}.${ms}`;
  };

  // Handle timeline click for seeking
  const handleTimelineClick = useCallback((e: React.MouseEvent) => {
    if (!timelineRef.current || totalDuration === 0) return;

    const rect = timelineRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = x / rect.width;
    const time = percentage * totalDuration;

    onSeek(Math.max(0, Math.min(totalDuration, time)));
  }, [totalDuration, onSeek]);

  // Handle mouse wheel for zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!onZoomChange) return;

    // Only zoom if Ctrl/Cmd is held or if it's a trackpad pinch
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.8 : 1.25;
      const newZoom = Math.max(0.5, Math.min(10, zoom * delta));
      onZoomChange(newZoom);
    }
  }, [zoom, onZoomChange]);

  // Handle mouse move for scrubbing preview
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!timelineRef.current || totalDuration === 0) return;

    const rect = timelineRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, x / rect.width));
    const time = percentage * totalDuration;

    setScrubTime(time);
    setScrubPosition({ x: e.clientX, y: rect.top - 10 });
  }, [totalDuration]);

  const handleMouseLeave = useCallback(() => {
    setScrubTime(null);
    setIsScrubbing(false);
  }, []);

  const handleMouseDown = useCallback(() => {
    setIsScrubbing(true);
  }, []);

  const handleMouseUp = useCallback(() => {
    setIsScrubbing(false);
  }, []);

  // Get clip and local time at a given timeline position
  const getClipAtScrubTime = useCallback((time: number) => {
    let accumulatedTime = 0;
    for (const clip of clips) {
      if (time >= accumulatedTime && time < accumulatedTime + clip.duration) {
        const localTime = time - accumulatedTime + clip.source_start;
        return { clip, localTime };
      }
      accumulatedTime += clip.duration;
    }
    return null;
  }, [clips]);

  // Drag and drop handlers
  const handleDragStart = useCallback((e: React.DragEvent, clipId: string) => {
    setDraggedClipId(clipId);
    setIsDragging(true);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverIndex(index);
  }, []);

  const handleDragEnd = useCallback(() => {
    if (draggedClipId && dragOverIndex !== null) {
      const currentIndex = clips.findIndex(c => c.id === draggedClipId);
      if (currentIndex !== -1 && currentIndex !== dragOverIndex) {
        const newClips = [...clips];
        const [removed] = newClips.splice(currentIndex, 1);
        newClips.splice(dragOverIndex, 0, removed);
        onClipReorder(newClips.map(c => c.id));
      }
    }
    setDraggedClipId(null);
    setDragOverIndex(null);
    setIsDragging(false);
  }, [draggedClipId, dragOverIndex, clips, onClipReorder]);

  // Calculate playhead position
  const playheadPosition = totalDuration > 0 ? (currentTime / totalDuration) * 100 : 0;

  // Find current clip based on playback time
  const getCurrentClip = useCallback((): TimelineClip | null => {
    if (playbackMode !== 'timeline') return null;

    let accumulatedTime = 0;
    for (const clip of clips) {
      if (currentTime >= accumulatedTime && currentTime < accumulatedTime + clip.duration) {
        return clip;
      }
      accumulatedTime += clip.duration;
    }
    return null;
  }, [clips, currentTime, playbackMode]);

  const currentClip = getCurrentClip();

  return (
    <div
      style={{
        backgroundColor: colors.surface,
        borderTop: `1px solid ${colors.border}`,
        padding: '12px 16px',
      }}
    >
      {/* Timeline header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: colors.text }}>
            Timeline
          </span>
          <span style={{ fontSize: 12, color: colors.textMuted }}>
            {clips.length} clips • {formatTime(totalDuration)}
          </span>
        </div>

        {playbackMode === 'timeline' && currentClip && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                backgroundColor: getClipColor(currentClip),
              }}
            />
            <span style={{ fontSize: 12, color: colors.textSecondary }}>
              {currentClip.name}
            </span>
          </div>
        )}

        {/* Zoom indicator */}
        {zoom !== 1 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 8px',
              backgroundColor: colors.card,
              borderRadius: 4,
              fontSize: 11,
              color: colors.textSecondary,
            }}
          >
            <span>🔍 {zoom.toFixed(1)}x</span>
            {onZoomChange && (
              <button
                onClick={() => onZoomChange(1)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: colors.textMuted,
                  cursor: 'pointer',
                  padding: 0,
                  fontSize: 10,
                }}
                title="Reset zoom"
              >
                ✕
              </button>
            )}
          </div>
        )}
      </div>

      {/* Mini-map */}
      {clips.length > 0 && totalDuration > 0 && (
        <div
          style={{
            height: 20,
            backgroundColor: colors.bg,
            borderRadius: 4,
            marginBottom: 8,
            position: 'relative',
            overflow: 'hidden',
            cursor: 'pointer',
          }}
          onClick={handleTimelineClick}
        >
          {/* Mini clip indicators */}
          {clips.map((clip) => {
            const startPercent = (clip.timeline_position / totalDuration) * 100;
            const widthPercent = (clip.duration / totalDuration) * 100;
            return (
              <div
                key={clip.id}
                style={{
                  position: 'absolute',
                  left: `${startPercent}%`,
                  width: `${widthPercent}%`,
                  height: '100%',
                  backgroundColor: `${getClipColor(clip)}60`,
                  borderLeft: `1px solid ${getClipColor(clip)}`,
                }}
              />
            );
          })}
          {/* Playhead indicator */}
          <div
            style={{
              position: 'absolute',
              left: `${playheadPosition}%`,
              top: 0,
              bottom: 0,
              width: 2,
              backgroundColor: colors.primary,
              zIndex: 1,
            }}
          />
          {/* Zoom window indicator (when zoomed) */}
          {zoom > 1 && (
            <div
              style={{
                position: 'absolute',
                left: `${Math.max(0, playheadPosition - 50 / zoom)}%`,
                width: `${100 / zoom}%`,
                height: '100%',
                border: `1px solid ${colors.primary}`,
                backgroundColor: `${colors.primary}20`,
                borderRadius: 2,
              }}
            />
          )}
        </div>
      )}

      {/* Scrubbing preview tooltip */}
      {scrubTime !== null && (
        <div
          style={{
            position: 'fixed',
            left: scrubPosition.x,
            top: scrubPosition.y - 80,
            transform: 'translateX(-50%)',
            zIndex: 1000,
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              backgroundColor: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: 8,
              padding: 4,
              boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
            }}
          >
            {/* Thumbnail preview */}
            {getThumbnailUrl && getClipAtScrubTime(scrubTime) && getClipAtScrubTime(scrubTime)!.clip.source_video_id && (
              <img
                src={getThumbnailUrl(
                  getClipAtScrubTime(scrubTime)!.clip.source_video_id,
                  getClipAtScrubTime(scrubTime)!.localTime
                )}
                alt="Preview"
                style={{
                  width: 120,
                  height: 68,
                  objectFit: 'cover',
                  borderRadius: 4,
                  backgroundColor: colors.bg,
                }}
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
            )}
            {/* Time display */}
            <div
              style={{
                textAlign: 'center',
                padding: '4px 8px',
                fontSize: 12,
                fontWeight: 600,
                color: colors.primary,
                fontFamily: 'monospace',
              }}
            >
              {formatTime(scrubTime)}
            </div>
          </div>
        </div>
      )}

      {/* Timeline container */}
      <div
        ref={timelineRef}
        onClick={handleTimelineClick}
        onWheel={handleWheel}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        style={{
          position: 'relative',
          height: 80,
          backgroundColor: colors.card,
          borderRadius: 8,
          overflow: 'hidden',
          cursor: isScrubbing ? 'ew-resize' : 'pointer',
        }}
      >
        {/* Waveform image */}
        {waveformUrl && (
          <img
            src={waveformUrl}
            alt="Waveform"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              objectFit: 'fill',
              opacity: 0.3,
              pointerEvents: 'none',
            }}
          />
        )}

        {/* Clips */}
        {clips.length > 0 ? (
          <div
            style={{
              position: 'absolute',
              top: 8,
              left: 0,
              right: 0,
              bottom: 8,
              display: 'flex',
              gap: 2,
              padding: '0 4px',
            }}
          >
            {clips.map((clip, index) => {
              const clipWidth = (clip.duration / totalDuration) * 100;
              const isSelected = selectedClipId === clip.id;
              const isDraggedOver = dragOverIndex === index;
              const clipColor = getClipColor(clip);

              const isHovered = hoveredClipId === clip.id;

              return (
                <div
                  key={clip.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, clip.id)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDragEnd={handleDragEnd}
                  onMouseEnter={() => setHoveredClipId(clip.id)}
                  onMouseLeave={() => setHoveredClipId(null)}
                  onClick={(e) => {
                    e.stopPropagation();
                    onClipSelect(clip);
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    onClipEdit?.(clip);
                  }}
                  title="Double-click to edit"
                  style={{
                    width: `${clipWidth}%`,
                    minWidth: 50,
                    height: '100%',
                    backgroundColor: isHovered ? `${clipColor}50` : `${clipColor}30`,
                    border: `2px solid ${isSelected ? clipColor : isHovered ? `${clipColor}80` : 'transparent'}`,
                    borderRadius: 4,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    padding: 4,
                    cursor: 'grab',
                    transition: 'all 0.15s ease',
                    transform: isDraggedOver ? 'scale(1.02)' : isHovered ? 'scale(1.01)' : 'scale(1)',
                    opacity: draggedClipId === clip.id ? 0.5 : 1,
                    position: 'relative',
                  }}
                >
                  {/* Hover action buttons */}
                  {isHovered && (
                    <div
                      style={{
                        position: 'absolute',
                        top: -8,
                        right: -4,
                        display: 'flex',
                        gap: 2,
                        zIndex: 10,
                      }}
                    >
                      {onClipEdit && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onClipEdit(clip);
                          }}
                          style={{
                            width: 20,
                            height: 20,
                            borderRadius: 4,
                            backgroundColor: colors.primary,
                            color: colors.bg,
                            border: 'none',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 10,
                          }}
                          title="Editar clip"
                        >
                          <FiEdit2 size={10} />
                        </button>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onClipDelete(clip.id);
                        }}
                        style={{
                          width: 20,
                          height: 20,
                          borderRadius: 4,
                          backgroundColor: colors.danger,
                          color: colors.text,
                          border: 'none',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 10,
                        }}
                        title="Delete clip"
                      >
                        <FiTrash2 size={10} />
                      </button>
                    </div>
                  )}

                  {/* Clip top bar with color */}
                  <div
                    style={{
                      height: 3,
                      backgroundColor: clipColor,
                      borderRadius: 1,
                    }}
                  />

                  {/* Clip info */}
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {clipWidth > 8 && (
                      <span
                        style={{
                          fontSize: 10,
                          color: colors.text,
                          fontWeight: 500,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          padding: '0 4px',
                        }}
                      >
                        {clip.name}
                      </span>
                    )}
                  </div>

                  {/* Clip duration */}
                  <div
                    style={{
                      fontSize: 9,
                      color: colors.textMuted,
                      textAlign: 'center',
                    }}
                  >
                    {formatTime(clip.duration)}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: colors.textMuted,
              fontSize: 13,
            }}
          >
            Use I/O to create clips from the sources
          </div>
        )}

        {/* Playhead */}
        {totalDuration > 0 && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: `${playheadPosition}%`,
              width: 2,
              backgroundColor: colors.primary,
              transform: 'translateX(-50%)',
              pointerEvents: 'none',
              zIndex: 10,
            }}
          >
            {/* Playhead handle */}
            <div
              style={{
                position: 'absolute',
                top: -4,
                left: '50%',
                transform: 'translateX(-50%)',
                width: 10,
                height: 10,
                backgroundColor: colors.primary,
                borderRadius: '50%',
              }}
            />
          </div>
        )}
      </div>

      {/* Time markers */}
      {totalDuration > 0 && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: 4,
            padding: '0 4px',
          }}
        >
          <span style={{ fontSize: 10, color: colors.textMuted }}>0:00</span>
          <span style={{ fontSize: 10, color: colors.textMuted }}>
            {formatTime(totalDuration / 4)}
          </span>
          <span style={{ fontSize: 10, color: colors.textMuted }}>
            {formatTime(totalDuration / 2)}
          </span>
          <span style={{ fontSize: 10, color: colors.textMuted }}>
            {formatTime((totalDuration * 3) / 4)}
          </span>
          <span style={{ fontSize: 10, color: colors.textMuted }}>
            {formatTime(totalDuration)}
          </span>
        </div>
      )}

      {/* Clip list (below timeline) */}
      {clips.length > 0 && (
        <div
          style={{
            marginTop: 12,
            display: 'flex',
            gap: 8,
            overflowX: 'auto',
            padding: '4px 0',
          }}
        >
          {clips.map((clip, index) => {
            const clipColor = getClipColor(clip);
            const isSelected = selectedClipId === clip.id;

            return (
              <div
                key={clip.id}
                onClick={() => onClipSelect(clip)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 12px',
                  backgroundColor: isSelected ? `${clipColor}20` : colors.card,
                  border: `1px solid ${isSelected ? clipColor : colors.border}`,
                  borderRadius: 6,
                  cursor: 'pointer',
                  minWidth: 'max-content',
                  transition: 'all 0.2s',
                }}
              >
                {/* Index */}
                <span
                  style={{
                    width: 20,
                    height: 20,
                    backgroundColor: clipColor,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 11,
                    fontWeight: 600,
                    color: colors.bg,
                  }}
                >
                  {index + 1}
                </span>

                {/* Info */}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 500, color: colors.text }}>
                    {clip.name}
                  </div>
                  <div style={{ fontSize: 10, color: colors.textMuted }}>
                    {formatTime(clip.source_start)} - {formatTime(clip.source_end)}
                  </div>
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: 4, marginLeft: 8 }}>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onClipSelect(clip);
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: colors.textMuted,
                      cursor: 'pointer',
                      padding: 4,
                    }}
                    title="Editar clip"
                  >
                    <FiEdit2 size={12} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onClipDelete(clip.id);
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: colors.danger,
                      cursor: 'pointer',
                      padding: 4,
                    }}
                    title="Delete clip"
                  >
                    <FiTrash2 size={12} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Helper function to get the current clip at a given timeline position
export function getClipAtTime(clips: TimelineClip[], time: number): { clip: TimelineClip; localTime: number } | null {
  let accumulatedTime = 0;

  for (const clip of clips) {
    if (time >= accumulatedTime && time < accumulatedTime + clip.duration) {
      const localTime = clip.source_start + (time - accumulatedTime);
      return { clip, localTime };
    }
    accumulatedTime += clip.duration;
  }

  return null;
}

// Helper function to calculate timeline position from clip and local time
export function getTimelinePosition(clips: TimelineClip[], clipId: string, localTime: number): number {
  let accumulatedTime = 0;

  for (const clip of clips) {
    if (clip.id === clipId) {
      return accumulatedTime + (localTime - clip.source_start);
    }
    accumulatedTime += clip.duration;
  }

  return 0;
}

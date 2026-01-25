import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { IoMdPlay, IoMdPause, IoMdDownload, IoMdSkipForward, IoMdSkipBackward, IoMdHelpCircle, IoMdClose } from 'react-icons/io';
import { FiUpload, FiScissors, FiChevronRight, FiChevronLeft, FiImage } from 'react-icons/fi';
import { MdPlaylistPlay } from 'react-icons/md';
import { apiClient, Video, TimelineProject, TimelineClip, Operation, CodecCompatibility } from '../api/client';
import SourcePanel, { SourceVideo, getSourceColor } from './SourcePanel';
import MultiClipTimeline, { getClipAtTime } from './MultiClipTimeline';
import WatermarkSettings, { WatermarkConfig, getDefaultWatermarkConfig } from './WatermarkSettings';

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
  gradient: 'linear-gradient(135deg, #00E5FF 0%, #FF148A 100%)',
};

interface Props {
  onClose: () => void;
  initialVideoId?: string | null;
}

export default function MultiSourceEditor({ onClose, initialVideoId }: Props) {
  // Video refs and state
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Multi-source state
  const [sources, setSources] = useState<SourceVideo[]>([]);
  const [activeSource, setActiveSource] = useState<SourceVideo | null>(null);
  const [timelineProject, setTimelineProject] = useState<TimelineProject | null>(null);

  // Playback mode: 'source' for editing, 'timeline' for preview
  const [playbackMode, setPlaybackMode] = useState<'source' | 'timeline'>('source');
  const [pendingCutStart, setPendingCutStart] = useState<number | null>(null);

  // Timeline playback tracking
  const [timelineTime, setTimelineTime] = useState(0);
  const [currentClipIndex, setCurrentClipIndex] = useState(0);
  const timelineTimeRef = useRef(0);

  // Export state
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [currentOperation, setCurrentOperation] = useState<Operation | null>(null);
  const [codecCompatibility, setCodecCompatibility] = useState<CodecCompatibility | null>(null);
  const [exportedFile, setExportedFile] = useState<string | null>(null);

  // Download state
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);

  // UI state
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(true);
  const [showHelp, setShowHelp] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [selectedClipIds, setSelectedClipIds] = useState<Set<string>>(new Set());

  // Playback control state
  const [playbackRate, setPlaybackRate] = useState(1);

  // Timeline interaction state
  const [timelineZoom, setTimelineZoom] = useState(1);
  const [scrubPreviewTime, setScrubPreviewTime] = useState<number | null>(null);
  const [snapEnabled, setSnapEnabled] = useState(true);

  // Watermark state
  const [watermarkConfig, setWatermarkConfig] = useState<WatermarkConfig>(getDefaultWatermarkConfig());
  const [showWatermarkSettings, setShowWatermarkSettings] = useState(false);



  // Toast notifications
  interface Toast {
    id: string;
    message: string;
    type: 'success' | 'info' | 'warning' | 'error';
  }
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: Toast['type'] = 'info') => {
    const id = `toast-${Date.now()}`;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);

  // Refs for keyboard handlers and state access in callbacks
  const pendingCutStartRef = useRef<number | null>(null);
  const isPlayingRef = useRef(false);
  const playbackModeRef = useRef<'source' | 'timeline'>('source');
  const currentClipIndexRef = useRef(0);
  const selectedClipIdRef = useRef<string | null>(null);
  const activeSourceRef = useRef(activeSource);
  const durationRef = useRef(duration);

  // Ref for pending clip action after source load
  const pendingClipAction = useRef<{ clipIndex: number; seekTo: number; shouldPlay: boolean } | null>(null);

  // O(1) source lookup map - optimized from O(n) array.find()
  // MUST be declared before sourceMapRef
  const sourceMap = useMemo(() => new Map(sources.map(s => [s.video.id, s])), [sources]);

  // Refs to track sources and clips for event handlers
  const sourcesRef = useRef(sources);
  const sourceMapRef = useRef(sourceMap);
  const timelineProjectRef = useRef(timelineProject);

  // Refs for interval cleanup (prevent memory leaks)
  const downloadPollRef = useRef<NodeJS.Timeout | null>(null);
  const exportPollRef = useRef<NodeJS.Timeout | null>(null);

  // Consolidated ref sync - single effect for all refs (better performance)
  useEffect(() => {
    pendingCutStartRef.current = pendingCutStart;
    isPlayingRef.current = isPlaying;
    playbackModeRef.current = playbackMode;
    currentClipIndexRef.current = currentClipIndex;
    timelineTimeRef.current = timelineTime;
    selectedClipIdRef.current = selectedClipId;
    sourcesRef.current = sources;
    sourceMapRef.current = sourceMap;
    timelineProjectRef.current = timelineProject;
    activeSourceRef.current = activeSource;
    durationRef.current = duration;
  });

  // Cleanup intervals on unmount
  useEffect(() => {
    return () => {
      if (downloadPollRef.current) clearInterval(downloadPollRef.current);
      if (exportPollRef.current) clearInterval(exportPollRef.current);
    };
  }, []);

  // Handle source video selection
  const handleSourceSelect = useCallback((video: Video) => {
    const source = sourceMap.get(video.id);
    if (source) {
      setActiveSource(source);
      setPlaybackMode('source');
      setPendingCutStart(null);

      // Load video in player
      if (videoRef.current) {
        videoRef.current.src = apiClient.getVideoStreamUrl(video.id);
        videoRef.current.load();
      }
    }
  }, [sourceMap]);

  // Handle adding source videos
  const handleSourceAdd = useCallback(async (videos: Video[]) => {
    const newSources = videos.map((video, index) => ({
      video,
      thumbnail: apiClient.getThumbnailUrl(video.id, 1),
      color: getSourceColor(sources.length + index),
    }));

    setSources(prev => [...prev, ...newSources]);

    // Add to timeline project
    if (timelineProject) {
      let addedCount = 0;
      for (const video of videos) {
        try {
          await apiClient.addVideoSource(timelineProject.id, video.id);
          addedCount++;
        } catch (err) {
          console.error('Failed to add video source:', err);
          showToast(`Error al agregar ${video.file_name} al proyecto`, 'error');
        }
      }

      // Update project
      try {
        const updated = await apiClient.getTimelineProject(timelineProject.id);
        setTimelineProject(updated);
      } catch (err) {
        console.error('Failed to refresh project:', err);
      }
    }

    // Select first video if none selected
    if (!activeSource && newSources.length > 0) {
      handleSourceSelect(newSources[0].video);
    }

    showToast(`${videos.length} video(s) agregado(s)`, 'success');
  }, [sources, timelineProject, activeSource, handleSourceSelect, showToast]);

  // Initialize timeline project
  useEffect(() => {
    const initProject = async () => {
      try {
        const project = await apiClient.createTimelineProject('Multi-Source Project');
        setTimelineProject(project);
      } catch (err) {
        console.error('Failed to create timeline project:', err);
        showToast('Error al crear proyecto de timeline', 'error');
      }
    };
    initProject();
  }, [showToast]);

  // Load initial video if provided
  useEffect(() => {
    if (initialVideoId && timelineProject) {
      const loadInitialVideo = async () => {
        try {
          // Get video info (would need an endpoint to get single video)
          const streamUrl = apiClient.getVideoStreamUrl(initialVideoId);
          // For now, create a minimal video object
          const video: Video = {
            id: initialVideoId,
            file_name: 'Imported Video',
            file_path: '',
            file_size: 0,
            duration: 0,
            width: 1920,
            height: 1080,
            codec: 'h264',
            format: 'mp4',
            created_at: new Date().toISOString(),
          };
          handleSourceAdd([video]);
        } catch (err) {
          console.error('Failed to load initial video:', err);
          showToast('Error al cargar video inicial', 'error');
        }
      };
      loadInitialVideo();
    }
  }, [initialVideoId, timelineProject, handleSourceAdd, showToast]);

  // Handle removing source video
  const handleSourceRemove = useCallback(async (videoId: string) => {
    // Check if any clips use this video
    const hasClips = timelineProject?.timeline_clips.some(c => c.source_video_id === videoId);
    if (hasClips) {
      showToast('No se puede eliminar: hay clips de este video en la timeline', 'error');
      return;
    }

    setSources(prev => prev.filter(s => s.video.id !== videoId));

    if (timelineProject) {
      try {
        await apiClient.removeVideoSource(timelineProject.id, videoId);
        const updated = await apiClient.getTimelineProject(timelineProject.id);
        setTimelineProject(updated);
        showToast('Video eliminado del proyecto', 'info');
      } catch (err) {
        console.error('Failed to remove video source:', err);
        showToast('Error al eliminar video del proyecto', 'error');
      }
    }

    // Clear active source if it was removed
    if (activeSource?.video.id === videoId) {
      setActiveSource(null);
      if (videoRef.current) {
        videoRef.current.src = '';
      }
    }
  }, [timelineProject, activeSource, showToast]);

  // Add single source to timeline (full duration)
  const handleAddToTimeline = useCallback(async (videoId: string, start: number, end: number) => {
    if (!timelineProject) return;

    try {
      const source = sourceMap.get(videoId);
      const clipName = source ? source.video.file_name : `Clip ${(timelineProject.timeline_clips?.length || 0) + 1}`;

      await apiClient.addTimelineClip(timelineProject.id, {
        source_video_id: videoId,
        source_start: start,
        source_end: end,
        timeline_position: timelineProject.total_duration,
        track_index: 0,
        name: clipName,
      });

      const updated = await apiClient.getTimelineProject(timelineProject.id);
      setTimelineProject(updated);

      showToast(`"${clipName}" agregado a timeline`, 'success');
    } catch (err) {
      console.error('Failed to add clip:', err);
      showToast('Error al agregar clip', 'error');
    }
  }, [timelineProject, sourceMap, showToast]);

  // Add all sources to timeline (each as full duration clip)
  const handleAddAllToTimeline = useCallback(async () => {
    if (!timelineProject || sources.length === 0) return;

    try {
      showToast(`Agregando ${sources.length} clips...`, 'info');

      for (const source of sources) {
        await apiClient.addTimelineClip(timelineProject.id, {
          source_video_id: source.video.id,
          source_start: 0,
          source_end: source.video.duration,
          timeline_position: 0, // Will be recalculated by backend
          track_index: 0,
          name: source.video.file_name,
        });
      }

      const updated = await apiClient.getTimelineProject(timelineProject.id);
      setTimelineProject(updated);

      showToast(`${sources.length} clips agregados a timeline`, 'success');
    } catch (err) {
      console.error('Failed to add all clips:', err);
      showToast('Error al agregar clips', 'error');
    }
  }, [timelineProject, sources, showToast]);

  // Handle URL download (yt-dlp)
  const handleUrlDownload = useCallback(async (url: string) => {
    // Clear any existing poll interval
    if (downloadPollRef.current) {
      clearInterval(downloadPollRef.current);
      downloadPollRef.current = null;
    }

    setIsDownloading(true);
    setDownloadProgress(0);
    showToast('Iniciando descarga...', 'info');

    try {
      // Start download using yt-dlp
      const download = await apiClient.startDownload(url);
      const downloadId = download.id;

      // Poll for progress (stored in ref for cleanup)
      downloadPollRef.current = setInterval(async () => {
        try {
          const status = await apiClient.getDownload(downloadId);
          setDownloadProgress(status.progress || 0);

          if (status.status === 'completed' && status.video_id) {
            if (downloadPollRef.current) {
              clearInterval(downloadPollRef.current);
              downloadPollRef.current = null;
            }
            setIsDownloading(false);

            // Create video object and add to sources
            const video: Video = {
              id: status.video_id,
              file_name: status.title || 'Downloaded Video',
              file_path: status.file_path || '',
              file_size: 0,
              duration: status.duration || 0,
              width: 1920,
              height: 1080,
              codec: 'h264',
              format: 'mp4',
              created_at: new Date().toISOString(),
            };
            handleSourceAdd([video]);
            showToast('Descarga completada', 'success');
          } else if (status.status === 'failed') {
            if (downloadPollRef.current) {
              clearInterval(downloadPollRef.current);
              downloadPollRef.current = null;
            }
            setIsDownloading(false);
            showToast(`Error: ${status.error || 'Descarga fallida'}`, 'error');
          }
        } catch (err) {
          console.error('Failed to get download status:', err);
        }
      }, 1000);
    } catch (err: any) {
      setIsDownloading(false);
      console.error('Download failed:', err);
      showToast(`Error al descargar: ${err.message || 'Error desconocido'}`, 'error');
    }
  }, [handleSourceAdd, showToast]);

  // Keyboard shortcuts - uses refs to avoid recreating listener on state changes
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (!videoRef.current || !activeSourceRef.current) return;

      const time = videoRef.current.currentTime;
      const currentDuration = durationRef.current;
      const project = timelineProjectRef.current;

      switch (e.key.toLowerCase()) {
        // Play/Pause
        case ' ':
        case 'k':
          e.preventDefault();
          if (videoRef.current.paused) {
            videoRef.current.playbackRate = 1;
            setPlaybackRate(1);
            videoRef.current.play();
          } else {
            videoRef.current.pause();
          }
          break;

        // J - Rewind / Play backwards (slower)
        case 'j':
          e.preventDefault();
          setPlaybackRate(rate => {
            const newRate = Math.max(-4, rate - 1);
            if (newRate < 0) {
              videoRef.current?.pause();
              if (videoRef.current) videoRef.current.currentTime = Math.max(0, time - 0.1);
            } else if (videoRef.current) {
              if (videoRef.current.paused) videoRef.current.play();
              videoRef.current.playbackRate = Math.max(0.25, newRate);
            }
            return newRate;
          });
          break;

        // L - Fast forward
        case 'l':
          e.preventDefault();
          setPlaybackRate(rate => {
            const newRate = Math.min(4, rate + 1);
            if (videoRef.current) {
              if (videoRef.current.paused) videoRef.current.play();
              videoRef.current.playbackRate = newRate;
            }
            return newRate;
          });
          break;

        // Arrow keys for seeking
        case 'arrowleft':
          e.preventDefault();
          videoRef.current.currentTime = Math.max(0, time - (e.shiftKey ? 0.1 : 1));
          break;

        case 'arrowright':
          e.preventDefault();
          videoRef.current.currentTime = Math.min(currentDuration, time + (e.shiftKey ? 0.1 : 1));
          break;

        // Frame by frame with , and .
        case ',':
          e.preventDefault();
          videoRef.current.pause();
          videoRef.current.currentTime = Math.max(0, time - (1 / 30)); // ~1 frame at 30fps
          break;

        case '.':
          e.preventDefault();
          videoRef.current.pause();
          videoRef.current.currentTime = Math.min(currentDuration, time + (1 / 30));
          break;

        // I - Set start point
        case 'i':
          e.preventDefault();
          setPendingCutStart(time);
          break;

        // O - Set end point and create/update clip
        case 'o':
          e.preventDefault();
          if (pendingCutStartRef.current !== null && project && activeSourceRef.current) {
            const start = Math.min(pendingCutStartRef.current, time);
            const end = Math.max(pendingCutStartRef.current, time);

            if (end - start >= 0.1) {
              // Check if we're editing an existing clip
              if (selectedClipIdRef.current) {
                updateClip(selectedClipIdRef.current, start, end);
                setSelectedClipId(null);
              } else {
                createClip(activeSourceRef.current.video.id, start, end);
              }
            }
            setPendingCutStart(null);
          }
          break;

        // S - Split clip at current position
        case 's':
          e.preventDefault();
          if (playbackModeRef.current === 'timeline' && project) {
            splitClipAtPlayhead();
          }
          break;

        // Delete - Remove selected clips
        case 'delete':
        case 'backspace':
          e.preventDefault();
          if (selectedClipIdRef.current) {
            handleClipDelete(selectedClipIdRef.current);
            setSelectedClipId(null);
          }
          break;

        // ? - Show shortcuts
        case '?':
          e.preventDefault();
          setShowShortcuts(true);
          break;

        // + / = - Zoom in timeline
        case '+':
        case '=':
          e.preventDefault();
          setTimelineZoom(z => Math.min(10, z * 1.5));
          break;

        // - - Zoom out timeline
        case '-':
          e.preventDefault();
          setTimelineZoom(z => Math.max(0.5, z / 1.5));
          break;

        // 0 - Reset zoom
        case '0':
          e.preventDefault();
          setTimelineZoom(1);
          break;

        // Home - Go to start
        case 'home':
          e.preventDefault();
          videoRef.current.currentTime = 0;
          break;

        // End - Go to end
        case 'end':
          e.preventDefault();
          videoRef.current.currentTime = currentDuration;
          break;

        // [ - Go to previous clip
        case '[':
          e.preventDefault();
          navigateClip(-1);
          break;

        // ] - Go to next clip
        case ']':
          e.preventDefault();
          navigateClip(1);
          break;

        // A - Select all clips
        case 'a':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            if (project) {
              setSelectedClipIds(new Set(project.timeline_clips.map(c => c.id)));
            }
          }
          break;

        // Escape - Cancel / Deselect
        case 'escape':
          e.preventDefault();
          setPendingCutStart(null);
          setSelectedClipId(null);
          setSelectedClipIds(new Set());
          setShowShortcuts(false);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []); // Empty deps - uses refs for state access

  // Create a clip
  const createClip = useCallback(async (videoId: string, start: number, end: number) => {
    if (!timelineProject) return;

    try {
      const clipName = `Clip ${(timelineProject.timeline_clips?.length || 0) + 1}`;
      const clip = await apiClient.addTimelineClip(timelineProject.id, {
        source_video_id: videoId,
        source_start: start,
        source_end: end,
        timeline_position: timelineProject.total_duration,
        track_index: 0,
        name: clipName,
      });

      // Refresh project
      const updated = await apiClient.getTimelineProject(timelineProject.id);
      setTimelineProject(updated);

      showToast(`"${clipName}" creado`, 'success');
    } catch (err) {
      console.error('Failed to create clip:', err);
      showToast('Error al crear clip', 'error');
    }
  }, [timelineProject, showToast]);

  // Update an existing clip
  const updateClip = useCallback(async (clipId: string, newStart: number, newEnd: number) => {
    if (!timelineProject) return;

    try {
      const existingClip = timelineProject.timeline_clips.find(c => c.id === clipId);
      if (!existingClip) return;

      await apiClient.updateTimelineClip(timelineProject.id, clipId, {
        source_start: newStart,
        source_end: newEnd,
      });

      // Refresh project
      const updated = await apiClient.getTimelineProject(timelineProject.id);
      setTimelineProject(updated);

      showToast(`"${existingClip.name}" actualizado`, 'success');
    } catch (err) {
      console.error('Failed to update clip:', err);
      showToast('Error al actualizar clip', 'error');
    }
  }, [timelineProject, showToast]);

  // Delete a clip
  const handleClipDelete = useCallback(async (clipId: string) => {
    if (!timelineProject) return;

    try {
      await apiClient.deleteTimelineClip(timelineProject.id, clipId);
      const updated = await apiClient.getTimelineProject(timelineProject.id);
      setTimelineProject(updated);
      showToast('Clip eliminado', 'info');
    } catch (err) {
      console.error('Failed to delete clip:', err);
      showToast('Error al eliminar clip', 'error');
    }
  }, [timelineProject, showToast]);

  // Reorder clips
  const handleClipReorder = useCallback(async (clipIds: string[]) => {
    if (!timelineProject) return;

    try {
      const updated = await apiClient.reorderTimelineClips(timelineProject.id, clipIds);
      setTimelineProject(updated);
    } catch (err) {
      console.error('Failed to reorder clips:', err);
      showToast('Error al reordenar clips', 'error');
    }
  }, [timelineProject, showToast]);

  // Delete multiple selected clips
  const deleteSelectedClips = useCallback(async () => {
    if (!timelineProject || selectedClipIds.size === 0) return;

    try {
      for (const clipId of selectedClipIds) {
        await apiClient.deleteTimelineClip(timelineProject.id, clipId);
      }
      const updated = await apiClient.getTimelineProject(timelineProject.id);
      setTimelineProject(updated);
      setSelectedClipIds(new Set());
      showToast(`${selectedClipIds.size} clips eliminados`, 'info');
    } catch (err) {
      console.error('Failed to delete clips:', err);
      showToast('Error al eliminar clips', 'error');
    }
  }, [timelineProject, selectedClipIds, showToast]);

  // Split clip at current playhead position
  const splitClipAtPlayhead = useCallback(async () => {
    if (!timelineProject) return;

    const clips = timelineProject.timeline_clips;
    const result = getClipAtTime(clips, timelineTime);
    if (!result) {
      showToast('No hay clip en esta posición', 'warning');
      return;
    }

    const { clip, localTime } = result;
    const splitPoint = clip.source_start + localTime;

    // Don't split if too close to edges
    if (localTime < 0.5 || (clip.source_end - splitPoint) < 0.5) {
      showToast('Posición muy cerca del borde del clip', 'warning');
      return;
    }

    try {
      // Update original clip to end at split point
      await apiClient.updateTimelineClip(timelineProject.id, clip.id, {
        source_end: splitPoint,
      });

      // Create new clip from split point to original end
      await apiClient.addTimelineClip(timelineProject.id, {
        source_video_id: clip.source_video_id,
        source_start: splitPoint,
        source_end: clip.source_end,
        timeline_position: 0,
        track_index: 0,
        name: `${clip.name} (2)`,
      });

      const updated = await apiClient.getTimelineProject(timelineProject.id);
      setTimelineProject(updated);
      showToast('Clip dividido', 'success');
    } catch (err) {
      console.error('Failed to split clip:', err);
      showToast('Error al dividir clip', 'error');
    }
  }, [timelineProject, timelineTime, showToast]);

  // Timeline seek - defined before navigateClip which uses it
  const handleTimelineSeek = useCallback((time: number) => {
    if (playbackMode === 'timeline' && timelineProject) {
      const clips = timelineProject.timeline_clips;
      const result = getClipAtTime(clips, time);
      if (result) {
        // Find the clip index
        const clipIndex = clips.findIndex(c => c.id === result.clip.id);
        if (clipIndex >= 0) {
          setCurrentClipIndex(clipIndex);
        }

        const source = sourceMap.get(result.clip.source_video_id);
        if (source && videoRef.current) {
          const needsSourceChange = activeSource?.video.id !== source.video.id;
          if (needsSourceChange) {
            setActiveSource(source);
            videoRef.current.src = apiClient.getVideoStreamUrl(source.video.id);
            // Set handler BEFORE load() to avoid race condition
            videoRef.current.onloadedmetadata = () => {
              if (videoRef.current) {
                videoRef.current.currentTime = result.localTime;
              }
            };
            videoRef.current.load();
          } else {
            // Source already loaded, seek directly
            videoRef.current.currentTime = result.localTime;
          }
        }
      }
      setTimelineTime(time);
    }
    setCurrentTime(time);
  }, [playbackMode, timelineProject, sourceMap, activeSource]);

  // Navigate between clips
  const navigateClip = useCallback((direction: number) => {
    if (!timelineProject || timelineProject.timeline_clips.length === 0) return;

    const clips = timelineProject.timeline_clips;
    let targetIndex = 0;

    if (playbackMode === 'timeline') {
      // Find current clip index and navigate
      targetIndex = Math.max(0, Math.min(clips.length - 1, currentClipIndex + direction));
    } else {
      // In source mode, go to first/last clip
      targetIndex = direction > 0 ? 0 : clips.length - 1;
    }

    const targetClip = clips[targetIndex];
    if (targetClip) {
      // Calculate timeline position
      let pos = 0;
      for (let i = 0; i < targetIndex; i++) {
        pos += clips[i].duration;
      }
      handleTimelineSeek(pos);
      setCurrentClipIndex(targetIndex);
      showToast(`Clip ${targetIndex + 1}/${clips.length}`, 'info');
    }
  }, [timelineProject, playbackMode, currentClipIndex, handleTimelineSeek, showToast]);

  // Select a clip
  const handleClipSelect = useCallback((clip: TimelineClip) => {
    setSelectedClipId(clip.id);

    // Find and select the source
    const source = sourceMap.get(clip.source_video_id);
    if (source) {
      setActiveSource(source);
      setPlaybackMode('source');

      if (videoRef.current) {
        videoRef.current.src = apiClient.getVideoStreamUrl(source.video.id);
        // Set handler BEFORE load() to avoid race condition
        videoRef.current.onloadedmetadata = () => {
          if (videoRef.current) {
            videoRef.current.currentTime = clip.source_start;
          }
        };
        videoRef.current.load();
      }
    }
  }, [sourceMap]);

  // Handle clip edit - navigate to source and show edit controls
  const handleClipEdit = useCallback((clip: TimelineClip) => {
    // Switch to source editing mode
    setPlaybackMode('source');
    setSelectedClipId(clip.id);

    // Find the source video
    const source = sourceMap.get(clip.source_video_id);
    if (!source) {
      showToast('Fuente no encontrada', 'error');
      return;
    }

    // Load the source video and navigate to clip start
    setActiveSource(source);
    if (videoRef.current) {
      if (activeSource?.video.id !== source.video.id) {
        videoRef.current.src = apiClient.getVideoStreamUrl(source.video.id);
        // Set handler BEFORE load() to avoid race condition
        videoRef.current.onloadedmetadata = () => {
          if (videoRef.current) {
            videoRef.current.currentTime = clip.source_start;
            // Set pending cut to show the selection visually
            setPendingCutStart(clip.source_start);
          }
        };
        videoRef.current.load();
      } else {
        videoRef.current.currentTime = clip.source_start;
        setPendingCutStart(clip.source_start);
      }
    }

    showToast(`Editando "${clip.name}" - Presiona O para actualizar fin`, 'info');
  }, [sourceMap, activeSource, showToast]);

  // Play a specific clip in timeline mode - simplified version using refs
  const playClipAtIndex = useCallback((clipIndex: number, shouldPlay: boolean = false) => {
    const project = timelineProjectRef.current;
    const currentSourceMap = sourceMapRef.current;

    if (!project || !project.timeline_clips.length) return;

    const clips = project.timeline_clips;
    if (clipIndex < 0 || clipIndex >= clips.length) {
      // End of timeline
      if (videoRef.current) {
        videoRef.current.pause();
      }
      setIsPlaying(false);
      setPlaybackMode('source');
      showToast('Fin del timeline', 'info');
      return;
    }

    const clip = clips[clipIndex];
    const source = currentSourceMap.get(clip.source_video_id);
    if (!source) {
      console.error('Source not found for clip:', clip);
      return;
    }

    setCurrentClipIndex(clipIndex);

    // Calculate timeline position for this clip
    let timelinePos = 0;
    for (let i = 0; i < clipIndex; i++) {
      timelinePos += clips[i].duration;
    }
    setTimelineTime(timelinePos);

    // Check if we need to change video source
    const needsSourceChange = activeSource?.video.id !== source.video.id;

    if (needsSourceChange) {
      // Store pending action to execute after source loads
      pendingClipAction.current = { clipIndex, seekTo: clip.source_start, shouldPlay };
      setActiveSource(source);
      if (videoRef.current) {
        videoRef.current.src = apiClient.getVideoStreamUrl(source.video.id);
        videoRef.current.load();
      }
    } else if (videoRef.current) {
      // Same source, just seek and optionally play
      videoRef.current.currentTime = clip.source_start;
      if (shouldPlay) {
        videoRef.current.play().catch(e => console.log('Auto-play prevented:', e));
      }
    }
  }, [activeSource, showToast]);

  // Handle metadata loaded - update duration
  const handleLoadedMetadata = useCallback(() => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);

      // Update source video duration if we have active source
      if (activeSource) {
        setSources(prev => prev.map(s =>
          s.video.id === activeSource.video.id
            ? { ...s, video: { ...s.video, duration: videoRef.current!.duration } }
            : s
        ));
      }
    }
  }, [activeSource]);

  // Handle video can play - execute pending actions (more reliable than loadedmetadata)
  const handleCanPlay = useCallback(() => {
    if (videoRef.current && pendingClipAction.current) {
      const { seekTo, shouldPlay } = pendingClipAction.current;
      console.log('Video can play, executing pending action:', { seekTo, shouldPlay });

      // Clear the pending action first to prevent double execution
      pendingClipAction.current = null;

      videoRef.current.currentTime = seekTo;

      if (shouldPlay) {
        // Small delay to ensure seek is complete before playing
        setTimeout(() => {
          videoRef.current?.play().catch(e => console.log('Auto-play prevented:', e));
        }, 100);
      }
    }
  }, []);

  // Timeline playback: handle time updates using useEffect + addEventListener (like VideoEditor)
  useEffect(() => {
    if (playbackMode !== 'timeline' || !videoRef.current) return;

    const handleTimelineUpdate = () => {
      if (!videoRef.current || playbackModeRef.current !== 'timeline') return;

      const project = timelineProjectRef.current;
      if (!project || !project.timeline_clips.length) return;

      const clips = project.timeline_clips;
      const clipIndex = currentClipIndexRef.current;
      const currentVideoTime = videoRef.current.currentTime;

      // Update current time state
      setCurrentTime(currentVideoTime);

      if (clipIndex >= 0 && clipIndex < clips.length) {
        const currentClip = clips[clipIndex];

        // Calculate and update timeline time
        let timelinePos = 0;
        for (let i = 0; i < clipIndex; i++) {
          timelinePos += clips[i].duration;
        }
        timelinePos += Math.max(0, currentVideoTime - currentClip.source_start);
        setTimelineTime(timelinePos);

        // Check if we've reached the end of this clip
        if (currentVideoTime >= currentClip.source_end - 0.1) {
          const nextIndex = clipIndex + 1;
          if (nextIndex < clips.length) {
            // Play next clip
            playClipAtIndex(nextIndex, true);
          } else {
            // End of timeline
            videoRef.current.pause();
            setIsPlaying(false);
            showToast('Timeline completado', 'success');
          }
        }
      }
    };

    const video = videoRef.current;
    video.addEventListener('timeupdate', handleTimelineUpdate);

    return () => {
      video.removeEventListener('timeupdate', handleTimelineUpdate);
    };
  }, [playbackMode, playClipAtIndex, showToast]);

  // Toggle timeline preview mode
  const toggleTimelinePreview = useCallback(() => {
    if (playbackMode === 'source') {
      if (!timelineProject || timelineProject.timeline_clips.length === 0) {
        showToast('No hay clips en el timeline', 'warning');
        return;
      }
      setPlaybackMode('timeline');
      setCurrentClipIndex(0);
      setTimelineTime(0);
      // Start from beginning of timeline
      playClipAtIndex(0, false);
      showToast('Modo Preview Timeline - Presiona Play para reproducir', 'info');
    } else {
      setPlaybackMode('source');
      showToast('Modo edición', 'info');
    }
  }, [playbackMode, timelineProject, playClipAtIndex, showToast]);

  // Export timeline
  const handleExport = useCallback(async () => {
    if (!timelineProject || timelineProject.timeline_clips.length === 0) {
      showToast('No hay clips para exportar', 'warning');
      return;
    }

    setIsExporting(true);
    setExportProgress(0);

    try {
      // Check codec compatibility
      if (sources.length > 1) {
        const compat = await apiClient.checkCodecCompatibility(
          sources.map(s => s.video.id)
        );
        setCodecCompatibility(compat);

        if (!compat.compatible) {
          showToast(`Re-encoding necesario: ${compat.reason}`, 'info');
        }
      }

      // Start export with watermark options
      const exportOptions: any = {
        project_id: timelineProject.id,
        output_name: timelineProject.name,
        format: 'mp4',
      };

      // Add watermark if enabled
      if (watermarkConfig.enabled && watermarkConfig.filename) {
        exportOptions.watermark = {
          enabled: true,
          filename: watermarkConfig.filename,
          position: watermarkConfig.position,
          opacity: watermarkConfig.opacity,
          scale: watermarkConfig.scale,
          margin_x: watermarkConfig.marginX,
          margin_y: watermarkConfig.marginY,
        };
      }

      const operation = await apiClient.exportTimeline(timelineProject.id, exportOptions);

      setCurrentOperation(operation);

      // Clear any existing poll interval
      if (exportPollRef.current) {
        clearInterval(exportPollRef.current);
        exportPollRef.current = null;
      }

      // Poll for progress (stored in ref for cleanup)
      exportPollRef.current = setInterval(async () => {
        try {
          const opId = (operation as any).operation_id || operation.id;
          const status = await apiClient.getOperation(opId);
          setExportProgress(status.progress);

            if (status.status === 'completed') {
            if (exportPollRef.current) {
              clearInterval(exportPollRef.current);
              exportPollRef.current = null;
            }
            setIsExporting(false);
            showToast('Exportación completada', 'success');

            // Save filename for manual download
            if (status.output_files && status.output_files.length > 0) {
              const filename = status.output_files[0].split('/').pop();
              setExportedFile(filename);
            }
          } else if (status.status === 'failed') {
            if (exportPollRef.current) {
              clearInterval(exportPollRef.current);
              exportPollRef.current = null;
            }
            setIsExporting(false);
            showToast(`Error: ${status.error}`, 'error');
          }
        } catch (err) {
          console.error('Failed to get operation status:', err);
        }
      }, 1000);
    } catch (err) {
      console.error('Export failed:', err);
      setIsExporting(false);
      showToast('Error al exportar', 'error');
    }
  }, [timelineProject, sources, showToast]);

  // Format time
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Video event handlers - simple time update for source mode
  // (timeline mode uses useEffect with addEventListener above)
  const handleSourceTimeUpdate = useCallback(() => {
    if (!videoRef.current) return;
    // Only update in source mode - timeline mode handled by useEffect
    if (playbackModeRef.current === 'source') {
      setCurrentTime(videoRef.current.currentTime);
    }
  }, []);

  const handlePlay = useCallback(() => setIsPlaying(true), []);
  const handlePause = useCallback(() => setIsPlaying(false), []);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        backgroundColor: colors.bg,
        color: colors.text,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 20px',
          backgroundColor: colors.surface,
          borderBottom: `1px solid ${colors.border}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: colors.textSecondary,
              cursor: 'pointer',
              padding: 8,
            }}
          >
            <IoMdClose size={24} />
          </button>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
            Multi-Source Editor
          </h2>
          {timelineProject && (
            <span style={{ fontSize: 12, color: colors.textMuted }}>
              {timelineProject.timeline_clips?.length || 0} clips
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Download progress indicator */}
          {isDownloading && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 12px',
                backgroundColor: colors.card,
                border: `1px solid ${colors.border}`,
                borderRadius: 6,
                fontSize: 12,
              }}
            >
              <div
                style={{
                  width: 60,
                  height: 4,
                  backgroundColor: colors.border,
                  borderRadius: 2,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${downloadProgress}%`,
                    height: '100%',
                    backgroundColor: colors.accent,
                    transition: 'width 0.3s',
                  }}
                />
              </div>
              <span style={{ color: colors.textSecondary }}>
                {Math.round(downloadProgress)}%
              </span>
            </div>
          )}

          {/* Timeline preview toggle */}
          <button
            onClick={toggleTimelinePreview}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 16px',
              backgroundColor: playbackMode === 'timeline' ? colors.secondary : colors.card,
              color: colors.text,
              border: `1px solid ${playbackMode === 'timeline' ? colors.secondary : colors.border}`,
              borderRadius: 8,
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            <MdPlaylistPlay size={18} />
            {playbackMode === 'timeline' ? 'Editando' : 'Preview Timeline'}
          </button>

          {/* Watermark button */}
          <button
            onClick={() => setShowWatermarkSettings(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 12px',
              backgroundColor: watermarkConfig.enabled ? colors.accent : colors.card,
              color: watermarkConfig.enabled ? colors.bg : colors.text,
              border: `1px solid ${watermarkConfig.enabled ? colors.accent : colors.border}`,
              borderRadius: 8,
              cursor: 'pointer',
              fontSize: 13,
            }}
            title="Configurar marca de agua"
          >
            <FiImage size={16} />
            {watermarkConfig.enabled && 'ON'}
          </button>



          {/* Export button */}
          <button
            onClick={handleExport}
            disabled={isExporting || !timelineProject?.timeline_clips?.length || exportedFile !== null}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 20px',
              background: exportedFile ? colors.surface : colors.gradient,
              color: colors.bg,
              border: `1px solid ${colors.border}`,
              borderRadius: 8,
              cursor: isExporting ? 'wait' : 'pointer',
              fontSize: 13,
              fontWeight: 600,
              opacity: isExporting || !timelineProject?.timeline_clips?.length || exportedFile !== null ? 0.6 : 1,
            }}
          >
            <IoMdDownload size={18} />
            {isExporting ? `${Math.round(exportProgress)}%` : (exportedFile ? 'Exportado' : 'Exportar')}
          </button>

          {/* Download button - shown when export is ready */}
          {exportedFile && (
            <button
              onClick={() => window.open(`/api/outputs/${exportedFile}`, '_blank')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 20px',
                background: colors.gradient,
                color: colors.bg,
                border: 'none',
                borderRadius: 8,
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              <IoMdDownload size={18} />
              Descargar
            </button>
          )}

          {/* Clear exported file */}
          {exportedFile && (
            <button
              onClick={() => setExportedFile(null)}
              style={{
                background: 'none',
                border: `1px solid ${colors.border}`,
                color: colors.textSecondary,
                cursor: 'pointer',
                padding: '8px 12px',
                borderRadius: 8,
                fontSize: 12,
              }}
            >
              Limpiar
            </button>
          )}

          {/* Help */}
          <button
            onClick={() => setShowHelp(!showHelp)}
            style={{
              background: 'none',
              border: 'none',
              color: colors.textSecondary,
              cursor: 'pointer',
              padding: 8,
            }}
          >
            <IoMdHelpCircle size={22} />
          </button>
        </div>
      </div>

      {/* Main content */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Source panel */}
        <SourcePanel
          sources={sources}
          activeSourceId={activeSource?.video.id || null}
          onSourceSelect={handleSourceSelect}
          onSourceAdd={handleSourceAdd}
          onSourceRemove={handleSourceRemove}
          onUrlDownload={handleUrlDownload}
          onAddToTimeline={handleAddToTimeline}
          onAddAllToTimeline={handleAddAllToTimeline}
          isCollapsed={!leftSidebarOpen}
          onToggleCollapse={() => setLeftSidebarOpen(!leftSidebarOpen)}
        />

        {/* Video player area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {/* Video */}
          <div
            style={{
              flex: '1 1 0',
              minHeight: 200,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.bg,
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            {activeSource ? (
              <>
                <video
                  ref={videoRef}
                  style={{
                    maxWidth: '100%',
                    maxHeight: '100%',
                  }}
                  playsInline
                  preload="auto"
                  onTimeUpdate={handleSourceTimeUpdate}
                  onLoadedMetadata={handleLoadedMetadata}
                  onCanPlay={handleCanPlay}
                  onPlay={handlePlay}
                  onPause={handlePause}
                />
                {/* Watermark preview overlay */}
                {watermarkConfig.enabled && watermarkConfig.imageUrl && (
                  <img
                    src={watermarkConfig.imageUrl}
                    alt="Watermark preview"
                    style={{
                      position: 'absolute',
                      opacity: watermarkConfig.opacity,
                      width: `${watermarkConfig.scale * 15}%`,
                      height: 'auto',
                      pointerEvents: 'none',
                      ...(watermarkConfig.position === 'top-left' && {
                        top: watermarkConfig.marginY,
                        left: watermarkConfig.marginX,
                      }),
                      ...(watermarkConfig.position === 'top-right' && {
                        top: watermarkConfig.marginY,
                        right: watermarkConfig.marginX,
                      }),
                      ...(watermarkConfig.position === 'bottom-left' && {
                        bottom: watermarkConfig.marginY,
                        left: watermarkConfig.marginX,
                      }),
                      ...(watermarkConfig.position === 'bottom-right' && {
                        bottom: watermarkConfig.marginY,
                        right: watermarkConfig.marginX,
                      }),
                      ...(watermarkConfig.position === 'center' && {
                        top: '50%',
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                      }),
                    }}
                  />
                )}
              </>
            ) : (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 16,
                  color: colors.textMuted,
                }}
              >
                <FiUpload size={48} style={{ opacity: 0.5 }} />
                <p style={{ margin: 0, fontSize: 14 }}>
                  Agrega videos para comenzar
                </p>
              </div>
            )}

            {/* Pending cut indicator */}
            {pendingCutStart !== null && (
              <div
                style={{
                  position: 'absolute',
                  top: 16,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  padding: '8px 16px',
                  backgroundColor: `${colors.primary}20`,
                  border: `1px solid ${colors.primary}`,
                  borderRadius: 8,
                  fontSize: 13,
                  color: colors.primary,
                }}
              >
                Inicio: {formatTime(pendingCutStart)} → Presiona O para terminar
              </div>
            )}

            {/* Playback mode indicator */}
            {playbackMode === 'timeline' && timelineProject && (
              <div
                style={{
                  position: 'absolute',
                  top: 16,
                  right: 16,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <div
                  style={{
                    padding: '6px 12px',
                    backgroundColor: colors.card,
                    border: `1px solid ${colors.border}`,
                    borderRadius: 6,
                    fontSize: 12,
                    color: colors.textSecondary,
                  }}
                >
                  Clip {currentClipIndex + 1}/{timelineProject.timeline_clips.length}
                </div>
                <div
                  style={{
                    padding: '6px 12px',
                    backgroundColor: colors.secondary,
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 500,
                  }}
                >
                  PREVIEW
                </div>
              </div>
            )}
          </div>

          {/* Controls */}
          {activeSource && (
            <div
              style={{
                padding: '12px 20px',
                backgroundColor: colors.surface,
                borderTop: `1px solid ${colors.border}`,
                display: 'flex',
                alignItems: 'center',
                gap: 16,
              }}
            >
              {/* Play/Pause */}
              <button
                onClick={() => videoRef.current?.paused ? videoRef.current?.play() : videoRef.current?.pause()}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: '50%',
                  backgroundColor: colors.primary,
                  color: colors.bg,
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {isPlaying ? <IoMdPause size={24} /> : <IoMdPlay size={24} />}
              </button>

              {/* Time display */}
              <div style={{ fontSize: 13, color: colors.textSecondary, minWidth: 120 }}>
                {playbackMode === 'timeline'
                  ? `${formatTime(timelineTime)} / ${formatTime(timelineProject?.total_duration || 0)}`
                  : `${formatTime(currentTime)} / ${formatTime(duration)}`
                }
              </div>

              {/* Progress bar */}
              <div
                style={{
                  flex: 1,
                  height: 6,
                  backgroundColor: colors.border,
                  borderRadius: 3,
                  cursor: 'pointer',
                }}
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const x = e.clientX - rect.left;
                  const percentage = x / rect.width;

                  if (playbackMode === 'timeline' && timelineProject) {
                    const seekTime = percentage * (timelineProject.total_duration || 0);
                    handleTimelineSeek(seekTime);
                  } else if (videoRef.current) {
                    videoRef.current.currentTime = percentage * duration;
                  }
                }}
              >
                <div
                  style={{
                    width: playbackMode === 'timeline'
                      ? `${(timelineProject?.total_duration || 0) > 0 ? (timelineTime / (timelineProject?.total_duration || 1)) * 100 : 0}%`
                      : `${duration > 0 ? (currentTime / duration) * 100 : 0}%`,
                    height: '100%',
                    backgroundColor: colors.primary,
                    borderRadius: 3,
                  }}
                />
              </div>

              {/* I/O buttons */}
              <button
                onClick={() => {
                  if (videoRef.current) {
                    setPendingCutStart(videoRef.current.currentTime);
                    showToast(`Inicio: ${formatTime(videoRef.current.currentTime)}`, 'info');
                  }
                }}
                style={{
                  padding: '8px 16px',
                  backgroundColor: pendingCutStart !== null ? colors.primary : colors.card,
                  color: pendingCutStart !== null ? colors.bg : colors.text,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: 500,
                }}
              >
                I
              </button>

              <button
                onClick={() => {
                  if (videoRef.current && pendingCutStart !== null && activeSource) {
                    const time = videoRef.current.currentTime;
                    const start = Math.min(pendingCutStart, time);
                    const end = Math.max(pendingCutStart, time);
                    if (end - start >= 0.1) {
                      createClip(activeSource.video.id, start, end);
                    }
                    setPendingCutStart(null);
                  }
                }}
                disabled={pendingCutStart === null}
                style={{
                  padding: '8px 16px',
                  backgroundColor: colors.card,
                  color: pendingCutStart !== null ? colors.secondary : colors.textMuted,
                  border: `1px solid ${pendingCutStart !== null ? colors.secondary : colors.border}`,
                  borderRadius: 6,
                  cursor: pendingCutStart !== null ? 'pointer' : 'not-allowed',
                  fontSize: 13,
                  fontWeight: 500,
                }}
              >
                O
              </button>
            </div>
          )}

          {/* Multi-clip timeline */}
          <MultiClipTimeline
            clips={timelineProject?.timeline_clips || []}
            sources={sources}
            totalDuration={timelineProject?.total_duration || 0}
            currentTime={playbackMode === 'timeline' ? timelineTime : 0}
            playbackMode={playbackMode}
            onClipSelect={handleClipSelect}
            onClipDelete={handleClipDelete}
            onClipReorder={handleClipReorder}
            onClipEdit={handleClipEdit}
            onSeek={handleTimelineSeek}
            selectedClipId={selectedClipId}
            selectedClipIds={selectedClipIds}
            zoom={timelineZoom}
            onZoomChange={setTimelineZoom}
            getThumbnailUrl={(videoId, time) => apiClient.getThumbnailUrl(videoId, time)}
          />
        </div>
      </div>

      {/* Shortcuts modal */}
      {(showHelp || showShortcuts) && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.85)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => { setShowHelp(false); setShowShortcuts(false); }}
        >
          <div
            style={{
              backgroundColor: colors.surface,
              borderRadius: 16,
              padding: 28,
              maxWidth: 700,
              width: '95%',
              maxHeight: '85vh',
              overflow: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>⌨️ Atajos de Teclado</h3>
              <span style={{ fontSize: 12, color: colors.textMuted }}>Presiona ? para ver esta ayuda</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 24 }}>
              {/* Playback */}
              <div>
                <h4 style={{ margin: '0 0 12px', fontSize: 14, color: colors.primary, fontWeight: 600 }}>▶️ Reproducción</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[
                    ['Space / K', 'Play / Pause'],
                    ['J', 'Rebobinar / Más lento'],
                    ['L', 'Avance rápido'],
                    ['← →', 'Saltar ±1s (Shift: ±0.1s)'],
                    [', .', 'Frame anterior / siguiente'],
                    ['Home', 'Ir al inicio'],
                    ['End', 'Ir al final'],
                  ].map(([key, desc]) => (
                    <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ padding: '3px 8px', backgroundColor: colors.card, borderRadius: 4, fontSize: 11, fontWeight: 600, minWidth: 70, textAlign: 'center', border: `1px solid ${colors.border}` }}>{key}</span>
                      <span style={{ color: colors.textSecondary, fontSize: 13 }}>{desc}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Editing */}
              <div>
                <h4 style={{ margin: '0 0 12px', fontSize: 14, color: colors.secondary, fontWeight: 600 }}>✂️ Edición</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[
                    ['I', 'Marcar inicio de clip'],
                    ['O', 'Marcar fin y crear clip'],
                    ['S', 'Dividir clip en playhead'],
                    ['Del / ⌫', 'Eliminar clip(s)'],
                    ['Ctrl+A', 'Seleccionar todos los clips'],
                    ['Esc', 'Cancelar / Deseleccionar'],
                  ].map(([key, desc]) => (
                    <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ padding: '3px 8px', backgroundColor: colors.card, borderRadius: 4, fontSize: 11, fontWeight: 600, minWidth: 70, textAlign: 'center', border: `1px solid ${colors.border}` }}>{key}</span>
                      <span style={{ color: colors.textSecondary, fontSize: 13 }}>{desc}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Navigation */}
              <div>
                <h4 style={{ margin: '0 0 12px', fontSize: 14, color: colors.accent, fontWeight: 600 }}>🧭 Navegación</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[
                    ['[ ]', 'Clip anterior / siguiente'],
                    ['+ / -', 'Zoom in / out timeline'],
                    ['0', 'Reset zoom'],
                    ['?', 'Mostrar esta ayuda'],
                  ].map(([key, desc]) => (
                    <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ padding: '3px 8px', backgroundColor: colors.card, borderRadius: 4, fontSize: 11, fontWeight: 600, minWidth: 70, textAlign: 'center', border: `1px solid ${colors.border}` }}>{key}</span>
                      <span style={{ color: colors.textSecondary, fontSize: 13 }}>{desc}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Tips */}
              <div>
                <h4 style={{ margin: '0 0 12px', fontSize: 14, color: '#22c55e', fontWeight: 600 }}>💡 Tips</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13, color: colors.textSecondary }}>
                  <p style={{ margin: 0 }}>• <strong>Doble-clic</strong> en un clip para editarlo</p>
                  <p style={{ margin: 0 }}>• <strong>Arrastra</strong> clips para reordenar</p>
                  <p style={{ margin: 0 }}>• <strong>Hover</strong> en clips muestra botones</p>
                  <p style={{ margin: 0 }}>• <strong>J/K/L</strong> es el estándar de edición profesional</p>
                </div>
              </div>
            </div>

            <button
              onClick={() => { setShowHelp(false); setShowShortcuts(false); }}
              style={{
                marginTop: 24,
                width: '100%',
                padding: '12px',
                backgroundColor: colors.primary,
                color: colors.bg,
                border: 'none',
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Entendido
            </button>
          </div>
        </div>
      )}

      {/* Watermark settings modal */}
      {showWatermarkSettings && (
        <WatermarkSettings
          config={watermarkConfig}
          onChange={setWatermarkConfig}
          onClose={() => setShowWatermarkSettings(false)}
        />
      )}

      {/* Toasts */}
      <div
        style={{
          position: 'fixed',
          bottom: 20,
          right: 20,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          zIndex: 1000,
        }}
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            style={{
              padding: '12px 20px',
              backgroundColor: toast.type === 'error' ? colors.danger :
                toast.type === 'success' ? '#22c55e' :
                toast.type === 'warning' ? colors.accent : colors.primary,
              color: toast.type === 'warning' || toast.type === 'info' ? colors.bg : colors.text,
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 500,
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            }}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </div>
  );
}

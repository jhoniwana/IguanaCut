import { useState, useRef, useEffect, useCallback } from 'react';
import { IoMdPlay, IoMdPause, IoMdTrash, IoMdDownload, IoMdSkipForward, IoMdSkipBackward, IoMdCheckmark, IoMdClose, IoMdHelpCircle, IoMdCamera, IoMdImages, IoMdList, IoMdArrowForward, IoMdArrowBack, IoMdCreate, IoMdReorder } from 'react-icons/io';
import { FiUpload, FiScissors, FiChevronRight, FiChevronLeft, FiEdit2, FiCrop, FiMove, FiImage, FiFolder } from 'react-icons/fi';
import { MdContentCut, MdPlaylistPlay, MdEdit, MdBlurOn } from 'react-icons/md';
import { apiClient, Project, Segment, Operation } from '../api/client';
import IntroOutroSelector from './IntroOutroSelector';
import CropSelector, { CropConfig } from './CropSelector';
import BlurRegionSelector, { BlurConfig, ClipBlurZone } from './BlurRegionSelector';
import WatermarkSettings, { WatermarkConfig, getDefaultWatermarkConfig } from './WatermarkSettings';

// Tema Iguana: verde marca #0CB691 del logo oficial + neutros oscuros
const colors = {
  bg: '#0d1110',
  surface: '#151b19',
  card: '#1c2421',
  border: '#2e3d37',
  primary: '#0CB691',
  secondary: '#4FD6B8',
  accent: '#D1F566',
  danger: '#f55353',
  text: '#ffffff',
  textSecondary: '#c3cfc9',
  textMuted: '#7d8f88',
  gradient: 'linear-gradient(135deg, #089477 0%, #4FD6B8 100%)',
  gradientAccent: 'linear-gradient(135deg, #0CB691 0%, #D1F566 100%)',
  shadow: '0 4px 20px rgba(12, 182, 145, 0.18)',
  shadowDeep: '0 8px 40px rgba(12, 182, 145, 0.22)',
};

// Deteccion de Android (WebView de la app): la censura de rostros requiere
// Python+OpenCV del backend de escritorio, no disponible en el APK.
const IS_ANDROID =
  typeof window !== 'undefined' &&
  (/Android/i.test(navigator.userAgent) ||
    (window as any).AndroidBridge?.platform?.() === 'android');

interface Props {
  onClose: () => void;
  onOpenFiles?: () => void;
  initialVideoId?: string | null;
}

export default function VideoEditor({ onClose, onOpenFiles, initialVideoId }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [currentOperation, setCurrentOperation] = useState<Operation | null>(null);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportStartTime, setExportStartTime] = useState<number | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isSeeking, setIsSeeking] = useState(false);
  const [pendingCutStart, setPendingCutStart] = useState<number | null>(null);
  const [waveformUrl, setWaveformUrl] = useState<string | null>(null);
  const [isLoadingWaveform, setIsLoadingWaveform] = useState(false);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isCapturingScreenshot, setIsCapturingScreenshot] = useState(false);
  const [isDraggingTimeline, setIsDraggingTimeline] = useState(false);
  const [dragStartX, setDragStartX] = useState(0);
  const [showIntroOutro, setShowIntroOutro] = useState(false);
  const [introOutroConfig, setIntroOutroConfig] = useState({
    introImagePath: '',
    introDuration: 5,
    outroImagePath: '',
    outroDuration: 5,
  });
  const [dragStartTime, setDragStartTime] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(true);

  // Crop configuration
  const [cropConfig, setCropConfig] = useState<CropConfig>({
    enabled: false,
    preset: null,
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
  });
  const [videoWidth, setVideoWidth] = useState(1920);
  const [videoHeight, setVideoHeight] = useState(1080);

  // Blur configuration (global settings)
  const [blurConfig, setBlurConfig] = useState<BlurConfig>({
    mode: 'off',
    autoIntensity: 25,
  });

  // Per-clip blur zones (key: segment id)
  const [clipBlurZones, setClipBlurZones] = useState<Record<string, ClipBlurZone>>({});

  // Export options
  const [exportSeparate, setExportSeparate] = useState(false); // false = merged, true = separate files

  // Watermark configuration
  const [watermarkConfig, setWatermarkConfig] = useState<WatermarkConfig>(getDefaultWatermarkConfig());
  const [showWatermarkSettings, setShowWatermarkSettings] = useState(false);

  // Preview segments mode
  const [isPreviewMode, setIsPreviewMode] = useState(false);
  const [currentPreviewSegmentIndex, setCurrentPreviewSegmentIndex] = useState(0);

  // Effects preview (with crop/blur)
  const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);
  const [previewProgress, setPreviewProgress] = useState(0);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(null);

  // Edit mode - when editing an existing clip
  const [editingClipId, setEditingClipId] = useState<string | null>(null);

  // Drag and drop reordering
  const [draggedClipId, setDraggedClipId] = useState<string | null>(null);
  const [dragOverClipId, setDragOverClipId] = useState<string | null>(null);
  const [justDropped, setJustDropped] = useState(false);

  // Toast notifications for user feedback
  interface Toast {
    id: string;
    message: string;
    type: 'success' | 'info' | 'warning' | 'error';
    action?: { label: string; onClick: () => void };
  }
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: Toast['type'] = 'info', action?: Toast['action']) => {
    const id = `toast-${Date.now()}`;
    setToasts(prev => [...prev, { id, message, type, action }]);
    setTimeout(() => {
      if (mountedRef.current) setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // First time user hint
  const [showFirstTimeHint, setShowFirstTimeHint] = useState(() => {
    return !localStorage.getItem('losslesscut_seen_hint');
  });

  // Crop drag state
  const [isDraggingCrop, setIsDraggingCrop] = useState(false);
  const [cropDragStart, setCropDragStart] = useState({ x: 0, y: 0, cropX: 0, cropY: 0 });
  const videoContainerRef = useRef<HTMLDivElement>(null);

  // Rendered video dimensions (actual size on screen)
  const [renderedVideo, setRenderedVideo] = useState({ x: 0, y: 0, width: 0, height: 0 });

  // Refs
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);
  const isPlayingRef = useRef(false);
  const isSeekingRef = useRef(false);
  const pendingCutStartRef = useRef<number | null>(null);
  const segmentsRef = useRef<Segment[]>([]);
  const durationRef = useRef<number>(0);
  const projectRef = useRef<Project | null>(null);
  const editingClipIdRef = useRef<string | null>(null);

  // Keep refs in sync
  useEffect(() => { pendingCutStartRef.current = pendingCutStart; }, [pendingCutStart]);
  useEffect(() => { segmentsRef.current = segments; }, [segments]);
  useEffect(() => { durationRef.current = duration; }, [duration]);
  useEffect(() => { projectRef.current = project; }, [project]);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { editingClipIdRef.current = editingClipId; }, [editingClipId]);

  // Check mobile
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Load initial video
  useEffect(() => {
    if (initialVideoId) {
      const load = async () => {
        try {
          setVideoUrl(apiClient.getVideoStreamUrl(initialVideoId));
          setVideoId(initialVideoId);
          // ponytail: try restoring saved project first
          let proj;
          const savedProjectId = localStorage.getItem('losslesscut_last_project');
          if (savedProjectId) {
            try { 
              proj = await apiClient.getProject(savedProjectId);
              if (proj.video_id !== initialVideoId) proj = null;
            } catch { proj = null; }
          }
          if (!proj) {
            proj = await apiClient.createProject('Video Descargado', initialVideoId);
          }
          setProject(proj);
          localStorage.setItem('losslesscut_last_project', proj.id);
          setSegments(proj.segments || []);
        } catch (e) { console.error(e); }
      };
      load();
    }
  }, [initialVideoId]);

  // Load waveform
  useEffect(() => {
    if (videoId && duration > 0 && !waveformUrl && !isLoadingWaveform) {
      setIsLoadingWaveform(true);
      fetch(`/api/videos/${videoId}/waveform`)
        .then(r => r.ok ? r.blob() : null)
        .then(b => b && setWaveformUrl(URL.createObjectURL(b)))
        .finally(() => setIsLoadingWaveform(false));
    }
  }, [videoId, duration]);

  // Keyboard shortcuts
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (!videoRef.current) return;

      // Don't capture time during seeking - wait for it to complete
      if (isSeekingRef.current) return;

      // Use the actual video time for accuracy
      const time = videoRef.current.currentTime;
      switch (e.key.toLowerCase()) {
        case ' ':
          e.preventDefault();
          videoRef.current.paused ? videoRef.current.play() : videoRef.current.pause();
          break;
        case 'arrowleft':
          e.preventDefault();
          seekVideo(Math.max(0, time - (e.shiftKey ? 0.1 : 1)));
          break;
        case 'arrowright':
          e.preventDefault();
          seekVideo(Math.min(durationRef.current, time + (e.shiftKey ? 0.1 : 1)));
          break;
        case 'i':
          e.preventDefault();
          // If editing a clip, update its start time
          if (editingClipIdRef.current) {
            const updated = segmentsRef.current.map(s =>
              s.id === editingClipIdRef.current ? { ...s, start: time } : s
            );
            setSegments(updated);
            if (projectRef.current) {
              apiClient.updateProject(projectRef.current.id, { ...projectRef.current, segments: updated }).catch(console.error);
            }
          } else {
            // Set start point directly using video's current time
            setPendingCutStart(time);
          }
          setCurrentTime(time);
          break;
        case 'o':
          e.preventDefault();
          // If editing a clip, update its end time
          if (editingClipIdRef.current) {
            const clipName = segmentsRef.current.find(s => s.id === editingClipIdRef.current)?.name || 'Clip';
            const updated = segmentsRef.current.map(s =>
              s.id === editingClipIdRef.current ? { ...s, end: time } : s
            );
            setSegments(updated);
            setEditingClipId(null); // Exit edit mode after setting end
            if (projectRef.current) {
              apiClient.updateProject(projectRef.current.id, { ...projectRef.current, segments: updated }).catch(console.error);
            }
            // Toast for edit completion
            setToasts(prev => [...prev, { id: `t-${Date.now()}`, message: `"${clipName}" actualizado`, type: 'success' }]);
            setTimeout(() => { if (mountedRef.current) setToasts(prev => prev.slice(1)); }, 3000);
          } else {
            // Create clip using video's current time and ref for pending start
            const end = time;
            const start = pendingCutStartRef.current ?? 0;
            if (Math.abs(end - start) >= 0.1) {
              const clipName = `Clip ${segmentsRef.current.length + 1}`;
              const seg: Segment = {
                id: `seg-${Date.now()}`,
                name: clipName,
                start: Math.min(start, end),
                end: Math.max(start, end),
                selected: true,
              };
              const updated = [...segmentsRef.current.map(s => ({ ...s, selected: false })), seg];
              setSegments(updated);
              if (projectRef.current) {
                apiClient.updateProject(projectRef.current.id, { ...projectRef.current, segments: updated }).catch(console.error);
              }
              // Toast for clip creation
              setToasts(prev => [...prev, { id: `t-${Date.now()}`, message: `"${clipName}" creado`, type: 'success' }]);
              setTimeout(() => { if (mountedRef.current) setToasts(prev => prev.slice(1)); }, 3000);
            }
            setPendingCutStart(null);
          }
          setCurrentTime(time);
          break;
        case 'escape':
          e.preventDefault();
          // Cancel edit mode
          setEditingClipId(null);
          setPendingCutStart(null);
          break;
      }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, []);

  // Time update - optimized with throttling
  const animFrameRef = useRef<number | null>(null);
  const lastUpdateTime = useRef<number>(0);
  
  // Optimized seek function - waits for actual seek completion
  const seekVideo = useCallback((newTime: number) => {
    if (!videoRef.current) return;

    // Set seeking flag to prevent time update conflicts
    isSeekingRef.current = true;

    const handleSeeked = () => {
      // Update state with the ACTUAL time after seek completes
      if (videoRef.current) {
        setCurrentTime(videoRef.current.currentTime);
      }
      isSeekingRef.current = false;
      videoRef.current?.removeEventListener('seeked', handleSeeked);
    };

    videoRef.current.addEventListener('seeked', handleSeeked);
    videoRef.current.currentTime = newTime;

    // Fallback timeout in case seeked event doesn't fire
    setTimeout(() => {
      if (isSeekingRef.current) {
        handleSeeked();
      }
    }, 200);
  }, []);
  
  useEffect(() => {
    const update = () => {
      if (videoRef.current && !isSeekingRef.current && isPlayingRef.current) {
        const currentTime = videoRef.current.currentTime;
        // Throttle updates to reduce re-renders (update max 30 times per second)
        const now = performance.now();
        if (now - lastUpdateTime.current > 33) { // ~30fps
          setCurrentTime(currentTime);
          lastUpdateTime.current = now;
        }
      }
      if (isPlayingRef.current) animFrameRef.current = requestAnimationFrame(update);
    };
    if (isPlayingRef.current) animFrameRef.current = requestAnimationFrame(update);
    return () => { if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current); };
  }, [isPlaying]);

  // Poll export with faster interval for smoother progress
  useEffect(() => {
    if (!currentOperation || ['completed', 'failed'].includes(currentOperation.status)) return;

    let lastProgress = 0;
    const poll = setInterval(async () => {
      try {
        const op = await apiClient.getOperation(currentOperation.id);
        setCurrentOperation(op);

        // Smoothly animate progress (never go backwards)
        const newProgress = Math.max(lastProgress, op.progress);
        lastProgress = newProgress;
        setExportProgress(newProgress);

        if (['completed', 'failed'].includes(op.status)) {
          setExportProgress(100);
          clearInterval(poll);
          setIsExporting(false);
          setExportStartTime(null);
          if (op.status === 'completed') {
            showToast('¡Exportación completada!', 'success');
          } else {
            showToast('Error en la exportación', 'error');
          }
        }
      } catch { clearInterval(poll); setIsExporting(false); setExportStartTime(null); }
    }, 200); // Faster polling for smoother updates

    return () => clearInterval(poll);
  }, [currentOperation?.id, currentOperation?.status]);

  // Timeline handlers
  useEffect(() => {
    const move = (e: MouseEvent | TouchEvent) => {
      if (!isSeekingRef.current || !timelineRef.current || !duration) return;
      if ('touches' in e) e.preventDefault();
      const rect = timelineRef.current.getBoundingClientRect();
      const x = ('touches' in e ? e.touches[0].clientX : e.clientX) - rect.left;
      const time = Math.max(0, Math.min(1, x / rect.width)) * duration;
      if (videoRef.current) videoRef.current.currentTime = time;
      setCurrentTime(time);
    };
    const up = () => { isSeekingRef.current = false; setIsSeeking(false); };

    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', up);
    };
  }, [duration]);

  // Calculate rendered video dimensions within container
  useEffect(() => {
    const updateRenderedDimensions = () => {
      if (!videoRef.current || !videoContainerRef.current) return;

      const container = videoContainerRef.current.getBoundingClientRect();
      if (container.width === 0 || container.height === 0) return;

      const videoAspect = videoWidth / videoHeight;
      const containerAspect = container.width / container.height;

      let renderedWidth, renderedHeight, offsetX, offsetY;

      if (videoAspect > containerAspect) {
        // Video is wider than container - letterbox top/bottom
        renderedWidth = container.width;
        renderedHeight = container.width / videoAspect;
        offsetX = 0;
        offsetY = (container.height - renderedHeight) / 2;
      } else {
        // Video is taller than container - letterbox left/right
        renderedHeight = container.height;
        renderedWidth = container.height * videoAspect;
        offsetX = (container.width - renderedWidth) / 2;
        offsetY = 0;
      }

      setRenderedVideo({
        x: offsetX,
        y: offsetY,
        width: renderedWidth,
        height: renderedHeight,
      });
    };

    // Initial calculation
    updateRenderedDimensions();

    // Recalculate after sidebar animation (300ms transition)
    const timeoutId = setTimeout(updateRenderedDimensions, 350);

    window.addEventListener('resize', updateRenderedDimensions);
    return () => {
      window.removeEventListener('resize', updateRenderedDimensions);
      clearTimeout(timeoutId);
    };
  }, [videoWidth, videoHeight, videoUrl, leftSidebarOpen, sidebarOpen, cropConfig.enabled]);

  // Crop drag handlers
  useEffect(() => {
    if (!isDraggingCrop) return;

    const handleCropDrag = (e: MouseEvent | TouchEvent) => {
      if (!videoContainerRef.current || !cropConfig.enabled || renderedVideo.width === 0) return;

      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

      const deltaX = clientX - cropDragStart.x;
      const deltaY = clientY - cropDragStart.y;

      // Convert pixel delta to video coordinates using rendered video dimensions
      const scaleX = videoWidth / renderedVideo.width;
      const scaleY = videoHeight / renderedVideo.height;

      const newX = Math.max(0, Math.min(videoWidth - cropConfig.width, cropDragStart.cropX + deltaX * scaleX));
      const newY = Math.max(0, Math.min(videoHeight - cropConfig.height, cropDragStart.cropY + deltaY * scaleY));

      setCropConfig(prev => ({
        ...prev,
        x: Math.round(newX),
        y: Math.round(newY),
      }));
    };

    const handleCropDragEnd = () => {
      setIsDraggingCrop(false);
    };

    window.addEventListener('mousemove', handleCropDrag);
    window.addEventListener('mouseup', handleCropDragEnd);
    window.addEventListener('touchmove', handleCropDrag, { passive: false });
    window.addEventListener('touchend', handleCropDragEnd);

    return () => {
      window.removeEventListener('mousemove', handleCropDrag);
      window.removeEventListener('mouseup', handleCropDragEnd);
      window.removeEventListener('touchmove', handleCropDrag);
      window.removeEventListener('touchend', handleCropDragEnd);
    };
  }, [isDraggingCrop, cropDragStart, cropConfig.enabled, cropConfig.width, cropConfig.height, videoWidth, videoHeight, renderedVideo.width, renderedVideo.height]);

  // Crop drag start handler
  const handleCropDragStart = (e: React.MouseEvent | React.TouchEvent) => {
    if (!cropConfig.enabled) return;
    e.preventDefault();
    e.stopPropagation();

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    setIsDraggingCrop(true);
    setCropDragStart({
      x: clientX,
      y: clientY,
      cropX: cropConfig.x,
      cropY: cropConfig.y,
    });
  };

  // TikTok-style drag handlers
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingTimeline || !timelineRef.current || !duration) return;

      const rect = timelineRef.current.getBoundingClientRect();
      const deltaX = e.clientX - dragStartX;
      const deltaPercent = deltaX / rect.width;
      const deltaTime = deltaPercent * duration;

      const newTime = Math.max(0, Math.min(duration, dragStartTime + deltaTime));
      if (videoRef.current) videoRef.current.currentTime = newTime;
      setCurrentTime(newTime);
    };

    const handleMouseUp = () => {
      setIsDraggingTimeline(false);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isDraggingTimeline || !timelineRef.current || !duration) return;
      
      const touch = e.touches[0];
      const rect = timelineRef.current.getBoundingClientRect();
      const deltaX = touch.clientX - dragStartX;
      const deltaPercent = deltaX / rect.width;
      const deltaTime = deltaPercent * duration;
      
      const newTime = Math.max(0, Math.min(duration, dragStartTime + deltaTime));
      if (videoRef.current) videoRef.current.currentTime = newTime;
      setCurrentTime(newTime);
    };

    const handleTouchEnd = () => {
      setIsDraggingTimeline(false);
    };

    if (isDraggingTimeline) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('touchmove', handleTouchMove, { passive: false });
      window.addEventListener('touchend', handleTouchEnd);
      
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
        window.removeEventListener('touchmove', handleTouchMove);
        window.removeEventListener('touchend', handleTouchEnd);
      };
    }
  }, [isDraggingTimeline, dragStartX, dragStartTime, duration]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setVideoFile(file);
      const result = await apiClient.uploadVideo(file);
      setVideoUrl(apiClient.getVideoStreamUrl(result.video_id));
      setVideoId(result.video_id);
      const proj = await apiClient.createProject(file.name, result.video_id);
      setProject(proj);
      setSegments(proj.segments || []);
    } catch (e) { console.error(e); }
  };

  const handleMarkStart = () => {
    // Don't mark during seeking
    if (isSeekingRef.current) return;
    const time = videoRef.current?.currentTime ?? currentTime;
    // If editing a clip, update its start time
    if (editingClipId) {
      const updated = segments.map(s =>
        s.id === editingClipId ? { ...s, start: time } : s
      );
      setSegments(updated);
      if (project) apiClient.updateProject(project.id, { ...project, segments: updated }).catch(console.error);
    } else {
      setPendingCutStart(time);
    }
    setCurrentTime(time);
  };

  const handleMarkEnd = () => {
    // Don't mark during seeking
    if (isSeekingRef.current) return;
    const end = videoRef.current?.currentTime ?? currentTime;
    setCurrentTime(end);

    // If editing a clip, update its end time
    if (editingClipId) {
      const updated = segments.map(s =>
        s.id === editingClipId ? { ...s, end } : s
      );
      setSegments(updated);
      setEditingClipId(null); // Exit edit mode
      if (project) apiClient.updateProject(project.id, { ...project, segments: updated }).catch(console.error);
      return;
    }

    const start = pendingCutStart ?? 0;
    if (Math.abs(end - start) < 0.1) {
      setPendingCutStart(null);
      return;
    }
    const seg: Segment = {
      id: `seg-${Date.now()}`,
      name: `Clip ${segments.length + 1}`,
      start: Math.min(start, end),
      end: Math.max(start, end),
      selected: true,
    };
    const updated = [...segments.map(s => ({ ...s, selected: false })), seg];
    setSegments(updated);
    setPendingCutStart(null);
    if (project) apiClient.updateProject(project.id, { ...project, segments: updated }).catch(console.error);
  };

  // Start editing a clip
  const startEditingClip = (clipId: string) => {
    const clip = segments.find(s => s.id === clipId);
    if (clip && videoRef.current) {
      setEditingClipId(clipId);
      setPendingCutStart(null); // Clear any pending cut
      videoRef.current.currentTime = clip.start;
      setCurrentTime(clip.start);
    }
  };

  // Cancel editing
  const cancelEditing = () => {
    setEditingClipId(null);
  };

  // Drag and drop handlers for reordering clips
  const handleDragStart = (e: React.DragEvent, clipId: string) => {
    e.stopPropagation();
    setDraggedClipId(clipId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', clipId);
    // Set drag image
    if (e.currentTarget instanceof HTMLElement) {
      e.dataTransfer.setDragImage(e.currentTarget, 50, 25);
    }
  };

  const handleDragOver = (e: React.DragEvent, clipId: string) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    if (clipId !== draggedClipId) {
      setDragOverClipId(clipId);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverClipId(null);
  };

  const handleDrop = (e: React.DragEvent, targetClipId: string) => {
    e.preventDefault();
    e.stopPropagation();

    const sourceClipId = draggedClipId || e.dataTransfer.getData('text/plain');

    if (!sourceClipId || sourceClipId === targetClipId) {
      setDraggedClipId(null);
      setDragOverClipId(null);
      return;
    }

    // Find indices
    const fromIndex = segments.findIndex(s => s.id === sourceClipId);
    const toIndex = segments.findIndex(s => s.id === targetClipId);

    if (fromIndex === -1 || toIndex === -1) {
      setDraggedClipId(null);
      setDragOverClipId(null);
      return;
    }

    // Reorder segments
    const newSegments = [...segments];
    const [removed] = newSegments.splice(fromIndex, 1);
    newSegments.splice(toIndex, 0, removed);

    // Rename clips to reflect new order
    const renamed = newSegments.map((seg, i) => ({
      ...seg,
      name: `Clip ${i + 1}`,
    }));

    setSegments(renamed);
    if (project) {
      apiClient.updateProject(project.id, { ...project, segments: renamed }).catch(console.error);
    }

    setDraggedClipId(null);
    setDragOverClipId(null);
    setJustDropped(true);
    setTimeout(() => { if (mountedRef.current) setJustDropped(false); }, 100);
  };

  const handleDragEnd = (e: React.DragEvent) => {
    e.preventDefault();
    setDraggedClipId(null);
    setDragOverClipId(null);
  };

  const handleClipClick = (seg: Segment) => {
    // Ignore click if we just dropped
    if (justDropped) return;
    if (videoRef.current) seekVideo(seg.start);
  };

  const handleQuickClip = () => {
    // Create clip from start to current time
    if (currentTime < 0.5) return;
    const seg: Segment = {
      id: `seg-${Date.now()}`,
      name: `Clip ${segments.length + 1}`,
      start: 0,
      end: currentTime,
      selected: true,
    };
    const updated = [...segments.map(s => ({ ...s, selected: false })), seg];
    setSegments(updated);
    if (project) apiClient.updateProject(project.id, { ...project, segments: updated }).catch(console.error);
  };

  const handleExport = async () => {
    if (!project || segments.length === 0) return;
    setIsExporting(true);
    setExportProgress(0);
    setExportStartTime(Date.now());
    try {
      const selectedSegs = segments.filter(s => s.selected);

      // Build per-clip blur settings - only include clips with blur enabled
      const clipBlurSettings: Record<string, boolean> = {};
      selectedSegs.forEach(seg => {
        // Default to true (blur enabled) unless explicitly disabled
        clipBlurSettings[seg.id] = clipBlurZones[seg.id]?.enabled !== false;
      });

      // Get confirmed face signatures for matching during blur
      // IMPORTANT: Only include faces explicitly confirmed by user (confirmed === true)
      const confirmedSignatures = (blurConfig.confirmedFaces || [])
        .filter(f => f.confirmed === true)
        .map(f => f.signature);

      const op = await apiClient.exportProject(project.id, {
        segment_ids: selectedSegs.map(s => s.id),
        merge_segments: !exportSeparate,
        export_separate: exportSeparate,
        format: 'mp4',
        output_name: `${videoFile?.name.split('.')[0] || 'video'}_cut`,
        // Crop settings
        crop_enabled: cropConfig.enabled,
        crop_preset: cropConfig.preset || undefined,
        crop_x: cropConfig.x,
        crop_y: cropConfig.y,
        crop_width: cropConfig.width,
        crop_height: cropConfig.height,
        // Blur settings
        blur_mode: blurConfig.mode,
        blur_auto_intensity: blurConfig.autoIntensity,
        blur_confirmed_signatures: confirmedSignatures,
        blur_per_clip: clipBlurSettings,
        blur_style: blurConfig.blurStyle ? {
          style: blurConfig.blurStyle.style,
          intensity: blurConfig.blurStyle.intensity || blurConfig.autoIntensity,
          color: blurConfig.blurStyle.color,
          emoji: blurConfig.blurStyle.emoji,
          imageData: blurConfig.blurStyle.imageData,
        } : undefined,
        // Watermark settings
        watermark: watermarkConfig.enabled && watermarkConfig.filename ? {
          enabled: true,
          filename: watermarkConfig.filename,
          position: watermarkConfig.position,
          opacity: watermarkConfig.opacity,
          scale: watermarkConfig.scale,
          margin_x: watermarkConfig.marginX,
          margin_y: watermarkConfig.marginY,
        } : undefined,
      });
      setCurrentOperation(op);
    } catch { setIsExporting(false); setExportStartTime(null); }
  };

  // Generate effects preview (crop/blur applied to a short clip)
  const handleGeneratePreview = async () => {
    if (!videoId) return;

    // Need either crop or blur enabled
    const hasEffects = cropConfig.enabled || blurConfig.mode === 'auto';
    if (!hasEffects) {
      showToast('Activa recorte o censura para generar preview', 'warning');
      return;
    }

    setIsGeneratingPreview(true);
    setPreviewProgress(0);
    setPreviewVideoUrl(null);

    try {
      // Use current time or first selected segment
      const selectedSegs = segments.filter(s => s.selected);
      let previewStartTime = currentTime;
      if (selectedSegs.length > 0) {
        previewStartTime = selectedSegs[0].start;
      }

      const response = await fetch('/api/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          video_id: videoId,
          start_time: previewStartTime,
          duration: 5,
          crop_enabled: cropConfig.enabled,
          crop_x: cropConfig.x,
          crop_y: cropConfig.y,
          crop_width: cropConfig.width,
          crop_height: cropConfig.height,
          blur_mode: blurConfig.mode,
          blur_intensity: blurConfig.autoIntensity,
        }),
      });

      if (!response.ok) throw new Error('Failed to start preview');

      const operation = await response.json();

      // Poll for progress
      const pollProgress = async () => {
        try {
          const statusRes = await fetch(`/api/operations/${operation.id}`);
          const status = await statusRes.json();

          setPreviewProgress(status.progress || 0);

          if (status.status === 'completed' && status.output_files?.length > 0) {
            const filename = status.output_files[0].split('/').pop();
            setPreviewVideoUrl(`/api/outputs/${filename}`);
            setShowPreviewModal(true);
            setIsGeneratingPreview(false);
            showToast('Preview generado correctamente', 'success');
          } else if (status.status === 'failed') {
            setIsGeneratingPreview(false);
            showToast(`Error: ${status.error}`, 'error');
          } else {
            setTimeout(pollProgress, 500);
          }
        } catch {
          setIsGeneratingPreview(false);
        }
      };

      pollProgress();
    } catch (e) {
      setIsGeneratingPreview(false);
      showToast('Error al generar preview', 'error');
    }
  };

  // Calculate ETA for export
  const getExportETA = useCallback(() => {
    if (!exportStartTime || exportProgress <= 0) return null;
    const elapsed = Date.now() - exportStartTime;
    const estimatedTotal = elapsed / (exportProgress / 100);
    const remaining = estimatedTotal - elapsed;
    if (remaining < 1000) return 'menos de 1s';
    if (remaining < 60000) return `${Math.ceil(remaining / 1000)}s`;
    return `${Math.ceil(remaining / 60000)}min`;
  }, [exportStartTime, exportProgress]);

  // Preview selected segments sequentially
  const startPreview = () => {
    const selectedSegs = segments.filter(s => s.selected);
    if (selectedSegs.length === 0 || !videoRef.current) return;

    setIsPreviewMode(true);
    setCurrentPreviewSegmentIndex(0);

    // Jump to first segment
    videoRef.current.currentTime = selectedSegs[0].start;
    videoRef.current.play();
  };

  const stopPreview = () => {
    setIsPreviewMode(false);
    setCurrentPreviewSegmentIndex(0);
    if (videoRef.current) {
      videoRef.current.pause();
    }
  };

  // Handle preview mode time updates
  useEffect(() => {
    if (!isPreviewMode || !videoRef.current) return;

    const selectedSegs = segments.filter(s => s.selected);
    if (selectedSegs.length === 0) {
      setIsPreviewMode(false);
      return;
    }

    const handlePreviewUpdate = () => {
      if (!videoRef.current || !isPreviewMode) return;

      const currentSeg = selectedSegs[currentPreviewSegmentIndex];
      if (!currentSeg) {
        stopPreview();
        return;
      }

      const segEnd = currentSeg.end ?? duration;

      // Check if we've passed the end of current segment
      if (videoRef.current.currentTime >= segEnd - 0.05) {
        // Move to next segment
        const nextIndex = currentPreviewSegmentIndex + 1;
        if (nextIndex < selectedSegs.length) {
          setCurrentPreviewSegmentIndex(nextIndex);
          videoRef.current.currentTime = selectedSegs[nextIndex].start;
        } else {
          // End of all segments
          stopPreview();
        }
      }
    };

    videoRef.current.addEventListener('timeupdate', handlePreviewUpdate);
    return () => {
      videoRef.current?.removeEventListener('timeupdate', handlePreviewUpdate);
    };
  }, [isPreviewMode, currentPreviewSegmentIndex, segments, duration]);

  const handleDownload = () => {
    currentOperation?.output_files?.forEach((file: string) => {
      const a = document.createElement('a');
      a.href = `/api/outputs/${file.split('/').pop()}`;
      a.download = file.split('/').pop() || 'video.mp4';
      a.click();
    });
  };

  const handleScreenshot = async () => {
    if (!videoId || isCapturingScreenshot) return;
    setIsCapturingScreenshot(true);
    try {
      const result = await apiClient.captureScreenshot(videoId, currentTime);
      // Trigger download
      const a = document.createElement('a');
      a.href = result.url;
      a.download = result.filename;
      a.click();
      showToast(`Captura guardada: ${result.filename}`, 'success');
    } catch (e) {
      console.error('Screenshot failed:', e);
      showToast('Error al capturar imagen', 'error');
    } finally {
      setIsCapturingScreenshot(false);
    }
  };

  const deleteSegment = (id: string) => {
    const segmentToDelete = segments.find(s => s.id === id);
    const segmentIndex = segments.findIndex(s => s.id === id);
    const updated = segments.filter(s => s.id !== id);
    setSegments(updated);
    if (project) apiClient.updateProject(project.id, { ...project, segments: updated }).catch(console.error);

    // Show toast with undo option
    if (segmentToDelete) {
      showToast(`"${segmentToDelete.name}" eliminado`, 'success', {
        label: 'Deshacer',
        onClick: () => {
          // Restore the segment at its original position
          const restored = [...updated];
          restored.splice(segmentIndex, 0, segmentToDelete);
          setSegments(restored);
          if (project) apiClient.updateProject(project.id, { ...project, segments: restored }).catch(console.error);
          showToast('Clip restaurado', 'success');
        }
      });
    }
  };

  const toggleSegment = (id: string) => {
    setSegments(segments.map(s => s.id === id ? { ...s, selected: !s.selected } : s));
  };

  // Toggle blur for a clip
  const toggleClipBlur = (id: string) => {
    setClipBlurZones(prev => {
      const current = prev[id];
      if (current?.enabled) {
        // Disable blur
        const { [id]: _, ...rest } = prev;
        return rest;
      } else {
        // Enable blur with default zone
        return {
          ...prev,
          [id]: {
            enabled: true,
            x: 50,
            y: 30,
            radius: 20,
          }
        };
      }
    });
  };

  // Update blur zone position for a clip
  const updateClipBlurZone = (id: string, updates: Partial<ClipBlurZone>) => {
    setClipBlurZones(prev => ({
      ...prev,
      [id]: { ...prev[id], ...updates }
    }));
  };

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const fmtFull = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    const ms = Math.floor((s % 1) * 100);
    return `${m}:${sec.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  };

  const startTimeline = (e: React.MouseEvent | React.TouchEvent) => {
    if (!timelineRef.current || !duration) return;
    e.preventDefault();
    
    const rect = timelineRef.current.getBoundingClientRect();
    const x = ('touches' in e ? e.touches[0].clientX : e.clientX) - rect.left;
    const time = Math.max(0, Math.min(1, x / rect.width)) * duration;
    
    // Start TikTok-style drag
    setIsDraggingTimeline(true);
    setDragStartX('touches' in e ? e.touches[0].clientX : e.clientX);
    setDragStartTime(currentTime);
    
    // Also seek to initial position
    if (videoRef.current) videoRef.current.currentTime = time;
    setCurrentTime(time);
  };

  // Segment colors
  const segColors = ['#0CB691', '#4FD6B8', '#D1F566', '#089477', '#2FBF9F', '#5CE1C2'];
  const selectedCount = segments.filter(s => s.selected).length;

  // Styles
  const btn = (bg: string, color: string = '#fff'): React.CSSProperties => ({
    background: bg,
    color,
    border: 'none',
    borderRadius: '9999px', // Pill shape
    padding: isMobile ? '12px 20px' : '14px 28px',
    fontSize: isMobile ? '14px' : '15px',
    fontWeight: '600',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    transition: 'all 0.2s ease',
    width: '100%',
    boxShadow: `0 4px 15px ${bg}40`,
    textShadow: '0 1px 2px rgba(0,0,0,0.2)',
  });

  // Gradient button style
  const btnGradient = (gradient: string, color: string = '#fff'): React.CSSProperties => ({
    background: gradient,
    color,
    border: 'none',
    borderRadius: '9999px',
    padding: isMobile ? '12px 20px' : '14px 28px',
    fontSize: isMobile ? '14px' : '15px',
    fontWeight: '600',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    transition: 'all 0.2s ease',
    width: '100%',
    boxShadow: '0 4px 20px rgba(12, 182, 145, 0.3)',
    textShadow: '0 1px 2px rgba(0,0,0,0.2)',
  });

  const iconBtn: React.CSSProperties = {
    background: `linear-gradient(145deg, ${colors.card} 0%, ${colors.surface} 100%)`,
    color: colors.text,
    border: `1px solid ${colors.border}`,
    borderRadius: '14px',
    width: isMobile ? '38px' : '48px',
    height: isMobile ? '38px' : '48px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s ease',
    boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: colors.bg,
      zIndex: 100,
      display: 'flex',
      flexDirection: 'column',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    }}>
      {/* Header */}
      <header style={{
        background: `linear-gradient(180deg, ${colors.surface} 0%, ${colors.bg} 100%)`,
        padding: isMobile ? '8px 12px' : '16px 24px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottom: `1px solid ${colors.border}`,
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <img
            src="/logo.svg"
            alt="IguanaCut"
            style={{
              height: isMobile ? '26px' : '44px',
              width: 'auto',
              flexShrink: 0,
              filter: 'drop-shadow(0 0 10px rgba(12, 182, 145, 0.35))',
            }}
          />
          <div>
            <h1 style={{
              margin: 0,
              fontSize: isMobile ? '13px' : '16px',
              fontWeight: '600',
              color: colors.textSecondary,
              letterSpacing: '0.5px',
            }}>
              IguanaCut
            </h1>
            {videoFile && (
              <p style={{ margin: 0, fontSize: '12px', color: colors.textMuted, maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {videoFile.name}
              </p>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {onOpenFiles && (
            <button onClick={onOpenFiles} style={{
              ...iconBtn,
              background: colors.card,
              border: `1px solid ${colors.border}`,
              borderRadius: '50%',
              transition: 'all 0.2s ease',
            }} title="Archivos">
              <FiFolder size={20} />
            </button>
          )}
          <button onClick={() => setShowHelp(true)} style={{
            ...iconBtn,
            background: colors.card,
            border: `1px solid ${colors.border}`,
            borderRadius: '50%',
            transition: 'all 0.2s ease',
          }} title="Ayuda">
            <IoMdHelpCircle size={20} />
          </button>
          <button onClick={onClose} style={{
            ...iconBtn,
            background: colors.card,
            border: `1px solid ${colors.border}`,
            borderRadius: '50%',
            transition: 'all 0.2s ease',
          }}>
            <IoMdClose size={20} />
          </button>
        </div>
      </header>

      {/* Help Modal */}
      {showHelp && (
        <div style={{
          position: 'absolute', inset: 0,
          background: 'rgba(10, 10, 15, 0.92)',
          backdropFilter: 'blur(8px)',
          zIndex: 200,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
        }} onClick={() => setShowHelp(false)}>
          <div style={{
            background: `linear-gradient(145deg, ${colors.card} 0%, ${colors.surface} 100%)`,
            borderRadius: '24px',
            padding: '28px',
            maxWidth: '420px',
            width: '100%',
            border: `1px solid ${colors.border}`,
            boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5), 0 0 40px rgba(12, 182, 145, 0.12)',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
              <div style={{
                width: '36px', height: '36px',
                background: colors.gradient,
                borderRadius: '10px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <span style={{ fontSize: '18px' }}>◆</span>
              </div>
              <h2 style={{
                margin: 0,
                fontSize: '22px',
                fontWeight: '700',
                background: colors.gradient,
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}>Cómo usar</h2>
            </div>
            <div style={{ color: colors.textSecondary, fontSize: '14px', lineHeight: '2' }}>
              <p><span style={{ color: colors.primary, fontWeight: '700' }}>1.</span> Sube un video</p>
              <p><span style={{ color: colors.primary, fontWeight: '700' }}>2.</span> Navega al punto de inicio</p>
              <p><span style={{ color: colors.primary, fontWeight: '700' }}>3.</span> Presiona <span style={{
                background: colors.accent, color: '#000', padding: '2px 8px', borderRadius: '6px', fontWeight: '700'
              }}>I</span> (Marcar inicio)</p>
              <p><span style={{ color: colors.primary, fontWeight: '700' }}>4.</span> Navega al punto final</p>
              <p><span style={{ color: colors.primary, fontWeight: '700' }}>5.</span> Presiona <span style={{
                background: colors.secondary, color: '#fff', padding: '2px 8px', borderRadius: '6px', fontWeight: '700'
              }}>O</span> (Marcar fin)</p>
              <p><span style={{ color: colors.primary, fontWeight: '700' }}>6.</span> Toca <strong>Exportar</strong> para guardar</p>
            </div>
            <div style={{
              background: colors.surface,
              borderRadius: '12px',
              padding: '12px 16px',
              marginTop: '16px',
              border: `1px solid ${colors.border}`,
            }}>
              <p style={{ fontSize: '13px', color: colors.textMuted, margin: 0 }}>
                <strong style={{ color: colors.primary }}>Atajos:</strong> Espacio=Play, I/O=Cortar, ←→=1s, Shift+←→=0.1s
              </p>
            </div>
            <button onClick={() => setShowHelp(false)} style={{
              ...btnGradient(colors.gradient),
              marginTop: '20px',
            }}>
              ¡Entendido!
            </button>
          </div>
        </div>
      )}

      {/* Main */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {!videoUrl ? (
          // Upload area
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            padding: '32px', gap: '28px',
            background: `radial-gradient(circle at 50% 30%, ${colors.surface} 0%, ${colors.bg} 70%)`,
          }}>
            {/* Logo */}
            <div style={{
              padding: '20px',
              borderRadius: '24px',
              background: `linear-gradient(145deg, rgba(26, 26, 36, 0.8) 0%, rgba(18, 18, 26, 0.9) 100%)`,
              boxShadow: `0 8px 40px rgba(12, 182, 145, 0.22), 0 0 60px rgba(209, 245, 102, 0.12)`,
              border: `1px solid ${colors.border}`,
            }}>
              <div style={{
                width: '80px',
                height: '80px',
                borderRadius: '18px',
                background: colors.gradient,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '36px',
                fontWeight: '700',
                color: '#fff',
              }}>
                LC
              </div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <h2 style={{
                margin: '0 0 8px',
                fontSize: '24px',
                fontWeight: '600',
                color: colors.text,
              }}>IguanaCut</h2>
              <p style={{ color: colors.textSecondary, margin: 0, fontSize: '15px' }}>
                Edita, recorta y censura videos fácilmente
              </p>
            </div>
            <label style={{
              ...btnGradient(colors.gradient),
              maxWidth: '300px',
              cursor: 'pointer',
              padding: '16px 32px',
              fontSize: '16px',
            }}>
              <FiUpload size={22} /> Subir Video
              <input type="file" accept="video/*,audio/*" onChange={handleUpload} style={{ display: 'none' }} />
            </label>
            <p style={{ color: colors.textMuted, fontSize: '13px', marginTop: '-8px' }}>
              MP4, MOV, MKV, WebM y más formatos
            </p>
          </div>
        ) : (
          <>
            {/* Video Container with Both Sidebars */}
            <div style={{
              flex: 1, display: 'flex', position: 'relative', minHeight: '200px',
            }}>
              {/* Backdrop: en movil los sidebars flotan sobre el video como
                  drawer; tocar afuera los cierra (en desktop no hay backdrop) */}
              {isMobile && (leftSidebarOpen || sidebarOpen) && (
                <div
                  onClick={() => { setLeftSidebarOpen(false); setSidebarOpen(false); }}
                  style={{
                    position: 'absolute', inset: 0,
                    background: 'rgba(0, 0, 0, 0.55)',
                    zIndex: 15,
                    transition: 'opacity 0.3s ease',
                  }}
                />
              )}
              {/* LEFT SIDEBAR - Tools */}
              <div style={{
                position: 'absolute', top: 0, left: 0, bottom: 0,
                // En movil: drawer flotante sobre el video (nunca mas ancho
                // que la pantalla) y oculto por completo al cerrar.
                width: leftSidebarOpen ? (isMobile ? 'min(86vw, 300px)' : '320px') : (isMobile ? '0px' : '50px'),
                background: leftSidebarOpen
                  ? `linear-gradient(180deg, rgba(18, 18, 26, 0.98) 0%, rgba(10, 10, 15, 0.98) 100%)`
                  : 'rgba(18, 18, 26, 0.9)',
                backdropFilter: 'blur(16px)',
                borderRight: `1px solid ${colors.border}`,
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                display: 'flex', flexDirection: 'column',
                zIndex: 20,
                boxShadow: leftSidebarOpen ? '8px 0 30px rgba(0, 0, 0, 0.3)' : 'none',
              }}>
                {/* Left Sidebar Toggle */}
                <button
                  onClick={() => {
                    setLeftSidebarOpen(!leftSidebarOpen);
                    // En movil los sidebars se excluyen entre si (evita que
                    // se superpongan y tapen el video).
                    if (isMobile && !leftSidebarOpen) setSidebarOpen(false);
                  }}
                  style={{
                    background: colors.gradientAccent,
                    border: 'none',
                    color: '#fff',
                    padding: '12px 16px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: leftSidebarOpen ? 'space-between' : 'center',
                    gap: '8px',
                    borderBottom: `1px solid rgba(255,255,255,0.1)`,
                    boxShadow: '0 4px 15px rgba(209, 245, 102, 0.2)',
                    flexShrink: 0,
                  }}
                >
                  {leftSidebarOpen ? (
                    <>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '10px', fontWeight: '700', fontSize: '14px' }}>
                        <span style={{ fontSize: '16px' }}>🎬</span>
                        Herramientas
                      </span>
                      <FiChevronLeft size={20} />
                    </>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                      <span style={{ fontSize: '18px' }}>🎬</span>
                    </div>
                  )}
                </button>

                {/* Left Sidebar Content */}
                {leftSidebarOpen && (
                  <div style={{
                    flex: 1,
                    overflowY: 'auto',
                    padding: '12px',
                  }}>
                    {/* Crop Section */}
                    <div style={{ marginBottom: '16px' }}>
                      <CropSelector
                        config={cropConfig}
                        onChange={setCropConfig}
                        videoWidth={videoWidth}
                        videoHeight={videoHeight}
                        onClose={() => setCropConfig({ ...cropConfig, enabled: false })}
                      />
                    </div>

                    {/* Blur Section: solo escritorio (la censura de rostros
                        requiere Python/OpenCV, ausente en el APK Android) */}
                    {!IS_ANDROID && (
                    <div style={{ marginBottom: '16px' }}>
                      <BlurRegionSelector
                        config={blurConfig}
                        onChange={setBlurConfig}
                        onClose={() => setBlurConfig({ ...blurConfig, mode: 'off', confirmedFaces: [] })}
                        videoId={videoId}
                        activeClipsWithBlur={Object.values(clipBlurZones).filter(z => z.enabled).length}
                        totalClips={segments.length}
                        segments={segments
                          .filter(s => s.end !== undefined)
                          .map(s => ({ start: s.start, end: s.end! }))}
                      />
                    </div>
                    )}

                    {/* Watermark Section */}
                    <div style={{ marginBottom: '16px' }}>
                      <button
                        onClick={() => setShowWatermarkSettings(true)}
                        style={{
                          width: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '12px 14px',
                          background: watermarkConfig.enabled ? `${colors.accent}20` : colors.card,
                          border: `1px solid ${watermarkConfig.enabled ? colors.accent : colors.border}`,
                          borderRadius: '10px',
                          cursor: 'pointer',
                          color: colors.text,
                          fontSize: '13px',
                          fontWeight: '500',
                          transition: 'all 0.2s',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <FiImage size={18} color={watermarkConfig.enabled ? colors.accent : colors.textSecondary} />
                          <span>Marca de Agua</span>
                        </div>
                        {watermarkConfig.enabled && (
                          <span style={{
                            background: colors.accent,
                            color: '#000',
                            padding: '2px 8px',
                            borderRadius: '4px',
                            fontSize: '10px',
                            fontWeight: '700',
                          }}>
                            ON
                          </span>
                        )}
                      </button>
                    </div>

                    {/* Quick stats */}
                    {(cropConfig.enabled || blurConfig.mode === 'auto' || watermarkConfig.enabled) && (
                      <div style={{
                        background: colors.card,
                        borderRadius: '10px',
                        padding: '12px',
                        border: `1px solid ${colors.border}`,
                      }}>
                        <div style={{ fontSize: '11px', color: colors.textMuted, marginBottom: '8px', textTransform: 'uppercase' }}>
                          Efectos activos
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                          {cropConfig.enabled && (
                            <span style={{
                              background: colors.primary,
                              color: '#000',
                              padding: '4px 10px',
                              borderRadius: '6px',
                              fontSize: '11px',
                              fontWeight: '600',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                            }}>
                              <FiCrop size={12} /> {cropConfig.preset?.toUpperCase() || 'CROP'}
                            </span>
                          )}
                          {blurConfig.mode === 'auto' && (
                            <span style={{
                              background: colors.secondary,
                              color: '#fff',
                              padding: '4px 10px',
                              borderRadius: '6px',
                              fontSize: '11px',
                              fontWeight: '600',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                            }}>
                              <MdBlurOn size={12} /> CENSURA
                            </span>
                          )}
                          {watermarkConfig.enabled && (
                            <span style={{
                              background: colors.accent,
                              color: '#000',
                              padding: '4px 10px',
                              borderRadius: '6px',
                              fontSize: '11px',
                              fontWeight: '600',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                            }}>
                              <FiImage size={12} /> MARCA
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Video Area */}
              <div
                ref={videoContainerRef}
                style={{
                flex: 1,
                background: '#000',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
                overflow: 'hidden',
                // En movil el video usa todo el ancho; los sidebars flotan
                // encima (overlay). En desktop los margenes empujan el video.
                marginLeft: isMobile ? 0 : (leftSidebarOpen ? '320px' : '50px'),
                marginRight: isMobile ? 0 : (sidebarOpen ? '360px' : '50px'),
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              }}>
                <video
                  ref={videoRef}
                  src={videoUrl}
                  playsInline
                  style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                  onLoadedMetadata={() => {
                    if (videoRef.current) {
                      setDuration(videoRef.current.duration);
                      setVideoWidth(videoRef.current.videoWidth || 1920);
                      setVideoHeight(videoRef.current.videoHeight || 1080);
                      // Initialize crop config with video dimensions
                      setCropConfig(prev => ({
                        ...prev,
                        width: videoRef.current?.videoWidth || 1920,
                        height: videoRef.current?.videoHeight || 1080,
                      }));
                    }
                  }}
                  onTimeUpdate={() => !isSeekingRef.current && !isPlayingRef.current && videoRef.current && setCurrentTime(videoRef.current.currentTime)}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onClick={() => videoRef.current && (videoRef.current.paused ? videoRef.current.play() : videoRef.current.pause())}
                  preload="auto"
                  crossOrigin="anonymous"
                />

                {/* Time badge */}
                <div style={{
                  position: 'absolute', top: '12px', left: '12px',
                  background: 'rgba(0,0,0,0.8)', borderRadius: '8px', padding: '8px 12px',
                  color: colors.primary, fontFamily: 'monospace', fontSize: isMobile ? '16px' : '20px', fontWeight: '600',
                }}>
                  {fmtFull(currentTime)}
                </div>

                {/* Preview Mode Indicator */}
                {isPreviewMode && (
                  <div style={{
                    position: 'absolute', bottom: '12px', left: '12px',
                    background: 'rgba(239, 68, 68, 0.95)',
                    borderRadius: '6px', padding: '8px 14px',
                    color: '#fff', fontSize: '12px', fontWeight: '600',
                    display: 'flex', alignItems: 'center', gap: '8px',
                    animation: 'pulse 1.5s infinite',
                  }}>
                    <span style={{ width: '8px', height: '8px', background: '#fff', borderRadius: '50%' }} />
                    VISTA PREVIA ({currentPreviewSegmentIndex + 1}/{segments.filter(s => s.selected).length})
                  </div>
                )}

                {/* Edit mode indicator */}
                {editingClipId && (
                  <div style={{
                    position: 'absolute', top: '12px', right: isMobile ? '12px' : (sidebarOpen ? '320px' : '60px'),
                    background: colors.accent, borderRadius: '8px', padding: '8px 12px',
                    color: '#000', fontSize: '13px', fontWeight: '600',
                    transition: 'right 0.3s ease',
                    display: 'flex', alignItems: 'center', gap: '8px',
                  }}>
                    <FiEdit2 size={16} />
                    Editando {segments.find(s => s.id === editingClipId)?.name} — I=Inicio, O=Fin, Esc=Cancelar
                  </div>
                )}

                {/* Cut indicator with duration counter */}
                {pendingCutStart !== null && !editingClipId && (() => {
                  const clipDuration = Math.abs(currentTime - pendingCutStart);
                  const mins = Math.floor(clipDuration / 60);
                  const secs = Math.floor(clipDuration % 60);
                  const ms = Math.floor((clipDuration % 1) * 10);
                  return (
                    <div style={{
                      position: 'absolute', top: '12px', right: isMobile ? '12px' : (sidebarOpen ? '320px' : '60px'),
                      background: colors.accent, borderRadius: '8px', padding: '10px 14px',
                      color: '#000', fontSize: '13px', fontWeight: '600',
                      transition: 'right 0.3s ease',
                      display: 'flex', flexDirection: 'column', gap: '4px',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span>✂️ IN: {fmt(pendingCutStart)}</span>
                        <span style={{ opacity: 0.6 }}>→</span>
                        <span>OUT: {fmt(currentTime)}</span>
                      </div>
                      <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        background: 'rgba(0,0,0,0.15)', borderRadius: '4px', padding: '4px 8px',
                        marginTop: '2px',
                      }}>
                        <span style={{ fontSize: '11px', opacity: 0.8 }}>Duración:</span>
                        <span style={{
                          fontSize: '16px', fontWeight: '700', fontFamily: 'monospace',
                          color: clipDuration >= 0.1 ? '#000' : '#666',
                        }}>
                          {mins}:{secs.toString().padStart(2, '0')}.{ms}
                        </span>
                      </div>
                      <div style={{ fontSize: '10px', opacity: 0.7, textAlign: 'center' }}>
                        Presiona O para crear clip
                      </div>
                    </div>
                  );
                })()}

                {/* Play overlay */}
                {!isPlaying && (
                  <div style={{
                    position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    pointerEvents: 'none',
                  }}>
                    <div style={{
                      width: '72px', height: '72px', background: 'rgba(255,255,255,0.2)',
                      borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <IoMdPlay size={36} color="#fff" style={{ marginLeft: '4px' }} />
                    </div>
                  </div>
                )}

                {/* Crop Overlay */}
                {cropConfig.enabled && videoRef.current && renderedVideo.width > 0 && (
                  <div style={{
                    position: 'absolute',
                    left: `${renderedVideo.x}px`,
                    top: `${renderedVideo.y}px`,
                    width: `${renderedVideo.width}px`,
                    height: `${renderedVideo.height}px`,
                    pointerEvents: 'none',
                    overflow: 'hidden',
                  }}>
                    {/* Dark overlay outside crop area */}
                    <div style={{
                      position: 'absolute',
                      inset: 0,
                      background: 'rgba(0, 0, 0, 0.6)',
                      clipPath: `polygon(
                        0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%,
                        ${(cropConfig.x / videoWidth) * 100}% ${(cropConfig.y / videoHeight) * 100}%,
                        ${(cropConfig.x / videoWidth) * 100}% ${((cropConfig.y + cropConfig.height) / videoHeight) * 100}%,
                        ${((cropConfig.x + cropConfig.width) / videoWidth) * 100}% ${((cropConfig.y + cropConfig.height) / videoHeight) * 100}%,
                        ${((cropConfig.x + cropConfig.width) / videoWidth) * 100}% ${(cropConfig.y / videoHeight) * 100}%,
                        ${(cropConfig.x / videoWidth) * 100}% ${(cropConfig.y / videoHeight) * 100}%
                      )`,
                    }} />
                    {/* Crop border - draggable */}
                    <div
                      onMouseDown={handleCropDragStart}
                      onTouchStart={handleCropDragStart}
                      style={{
                        position: 'absolute',
                        left: `${(cropConfig.x / videoWidth) * 100}%`,
                        top: `${(cropConfig.y / videoHeight) * 100}%`,
                        width: `${(cropConfig.width / videoWidth) * 100}%`,
                        height: `${(cropConfig.height / videoHeight) * 100}%`,
                        border: `3px ${isDraggingCrop ? 'solid' : 'dashed'} #10b981`,
                        boxSizing: 'border-box',
                        cursor: isDraggingCrop ? 'grabbing' : 'grab',
                        pointerEvents: 'auto',
                        transition: isDraggingCrop ? 'none' : 'border 0.2s ease',
                      }}
                    >
                      {/* Corner indicators */}
                      {[['0', '0'], ['100%', '0'], ['0', '100%'], ['100%', '100%']].map(([x, y], i) => (
                        <div key={i} style={{
                          position: 'absolute',
                          left: x,
                          top: y,
                          transform: 'translate(-50%, -50%)',
                          width: '14px',
                          height: '14px',
                          background: '#10b981',
                          borderRadius: '50%',
                          border: '2px solid #fff',
                          pointerEvents: 'none',
                        }} />
                      ))}
                      {/* Center move indicator */}
                      <div style={{
                        position: 'absolute',
                        top: '50%',
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                        background: 'rgba(16, 185, 129, 0.8)',
                        borderRadius: '8px',
                        padding: '8px 12px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        pointerEvents: 'none',
                      }}>
                        <FiMove size={16} color="#fff" />
                        <span style={{ color: '#fff', fontSize: '11px', fontWeight: '600' }}>ARRASTRAR</span>
                      </div>
                      {/* Aspect ratio label */}
                      <div style={{
                        position: 'absolute',
                        top: '8px',
                        left: '8px',
                        background: 'rgba(16, 185, 129, 0.95)',
                        color: '#fff',
                        padding: '4px 10px',
                        borderRadius: '4px',
                        fontSize: '12px',
                        fontWeight: '700',
                        pointerEvents: 'none',
                      }}>
                        {cropConfig.preset?.toUpperCase() || 'CROP'}
                      </div>
                      {/* Size label */}
                      <div style={{
                        position: 'absolute',
                        bottom: '8px',
                        right: '8px',
                        background: 'rgba(0, 0, 0, 0.7)',
                        color: '#fff',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        fontSize: '10px',
                        fontFamily: 'monospace',
                        pointerEvents: 'none',
                      }}>
                        {cropConfig.width} × {cropConfig.height}
                      </div>
                    </div>
                  </div>
                )}

                {/* Auto blur indicator - just show badge when enabled */}
                {blurConfig.mode === 'auto' && (
                  <div style={{
                    position: 'absolute',
                    top: '10px',
                    left: '10px',
                    background: 'rgba(12, 182, 145, 0.9)',
                    color: '#fff',
                    padding: '6px 12px',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontWeight: '600',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    zIndex: 25,
                  }}>
                    <MdBlurOn size={16} />
                    Censura Auto Activa
                  </div>
                )}

                {/* Watermark preview overlay */}
                {watermarkConfig.enabled && watermarkConfig.imageUrl && (
                  <img
                    src={watermarkConfig.imageUrl}
                    alt="Watermark preview"
                    style={{
                      position: 'absolute',
                      pointerEvents: 'none',
                      opacity: watermarkConfig.opacity,
                      width: `${watermarkConfig.scale * 15}%`,
                      maxWidth: '30%',
                      zIndex: 20,
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
              </div>

               {/* Clips Sidebar */}
              <div style={{
                position: 'absolute', top: 0, right: 0, bottom: 0,
                width: sidebarOpen ? (isMobile ? 'min(86vw, 300px)' : '360px') : (isMobile ? '0px' : '50px'),
                background: sidebarOpen
                  ? `linear-gradient(180deg, rgba(18, 18, 26, 0.98) 0%, rgba(10, 10, 15, 0.98) 100%)`
                  : 'rgba(18, 18, 26, 0.9)',
                backdropFilter: 'blur(16px)',
                borderLeft: `1px solid ${colors.border}`,
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                display: 'flex', flexDirection: 'column',
                zIndex: 20,
                boxShadow: sidebarOpen ? '-8px 0 30px rgba(0, 0, 0, 0.3)' : 'none',
              }}>
                {/* Sidebar Toggle - Gradient Header */}
                <button
                  onClick={() => {
                    setSidebarOpen(!sidebarOpen);
                    if (isMobile && !sidebarOpen) setLeftSidebarOpen(false);
                  }}
                  style={{
                    background: colors.gradient,
                    border: 'none',
                    color: '#fff',
                    padding: '12px 16px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: sidebarOpen ? 'space-between' : 'center',
                    gap: '8px',
                    borderBottom: `1px solid rgba(255,255,255,0.1)`,
                    boxShadow: '0 4px 15px rgba(12, 182, 145, 0.2)',
                    flexShrink: 0,
                  }}
                >
                  {sidebarOpen ? (
                    <>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '10px', fontWeight: '700', fontSize: '14px' }}>
                        <span style={{ fontSize: '16px' }}>◆</span>
                        Tus Clips ({segments.length})
                      </span>
                      <FiChevronRight size={20} />
                    </>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                      <span style={{ fontSize: '18px' }}>◆</span>
                      <span style={{ fontSize: '11px', fontWeight: '700' }}>{segments.length}</span>
                    </div>
                  )}
                </button>

                {/* Clips List - Fixed height with scroll */}
                {sidebarOpen && (
                  <div style={{
                    flex: 1,
                    overflowY: 'auto',
                    padding: '10px',
                    minHeight: '150px',
                  }}>
                    {segments.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '20px', color: colors.textMuted }}>
                        <div style={{
                          width: '60px',
                          height: '60px',
                          borderRadius: '16px',
                          background: colors.card,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          margin: '0 auto 16px',
                        }}>
                          <FiScissors size={28} style={{ opacity: 0.5 }} />
                        </div>
                        <p style={{ margin: '0 0 12px', fontSize: '14px', color: colors.text }}>Aún no hay clips</p>
                        <div style={{
                          background: colors.card,
                          borderRadius: '10px',
                          padding: '14px',
                          textAlign: 'left',
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                            <span style={{
                              background: colors.accent,
                              color: '#000',
                              width: '24px',
                              height: '24px',
                              borderRadius: '6px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontWeight: '700',
                              fontSize: '12px',
                            }}>I</span>
                            <span style={{ color: colors.textSecondary, fontSize: '12px' }}>
                              Marca el <strong style={{ color: colors.accent }}>inicio</strong>
                            </span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <span style={{
                              background: colors.secondary,
                              color: '#fff',
                              width: '24px',
                              height: '24px',
                              borderRadius: '6px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontWeight: '700',
                              fontSize: '12px',
                            }}>O</span>
                            <span style={{ color: colors.textSecondary, fontSize: '12px' }}>
                              Marca el <strong style={{ color: colors.secondary }}>fin</strong> y crea el clip
                            </span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {segments.map((seg, i) => {
                          const isEditing = editingClipId === seg.id;
                          const isDragging = draggedClipId === seg.id;
                          const isDragOver = dragOverClipId === seg.id;
                          return (
                            <div
                              key={seg.id}
                              draggable={!isEditing}
                              onDragStart={(e) => handleDragStart(e, seg.id)}
                              onDragOver={(e) => handleDragOver(e, seg.id)}
                              onDragLeave={(e) => handleDragLeave(e)}
                              onDrop={(e) => handleDrop(e, seg.id)}
                              onDragEnd={(e) => handleDragEnd(e)}
                              onClick={() => handleClipClick(seg)}
                              style={{
                                background: isDragOver
                                  ? 'rgba(59, 130, 246, 0.3)'
                                  : isEditing
                                    ? 'rgba(245, 158, 11, 0.25)'
                                    : seg.selected ? 'rgba(16, 185, 129, 0.15)' : colors.surface,
                                borderRadius: '10px',
                                padding: '12px',
                                border: `2px solid ${isDragOver ? colors.secondary : isEditing ? colors.accent : seg.selected ? colors.primary : colors.border}`,
                                cursor: isDragging ? 'grabbing' : 'grab',
                                transition: 'all 0.2s ease',
                                position: 'relative',
                                opacity: isDragging ? 0.5 : 1,
                                transform: isDragOver ? 'scale(1.02)' : 'none',
                              }}
                            >
                              {/* Edit mode indicator */}
                              {isEditing && (
                                <div style={{
                                  position: 'absolute', top: '-8px', right: '8px',
                                  background: colors.accent, color: '#000',
                                  padding: '2px 8px', borderRadius: '4px',
                                  fontSize: '10px', fontWeight: '700',
                                }}>
                                  ✏️ EDITANDO
                                </div>
                              )}
                              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                                {/* Drag handle */}
                                <div
                                  style={{
                                    color: isDragging ? colors.secondary : colors.textMuted,
                                    cursor: 'grab',
                                    display: 'flex',
                                    alignItems: 'center',
                                    opacity: 0.6,
                                  }}
                                  title="Arrastra para reordenar"
                                >
                                  <IoMdReorder size={16} />
                                </div>
                                <div
                                  onClick={(e) => { e.stopPropagation(); toggleSegment(seg.id); }}
                                  style={{
                                    width: '28px', height: '28px', borderRadius: '8px',
                                    background: seg.selected ? colors.primary : colors.card,
                                    border: `2px solid ${seg.selected ? colors.primary : colors.border}`,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    cursor: 'pointer', flexShrink: 0,
                                    transition: 'all 0.15s ease',
                                    boxShadow: seg.selected ? '0 0 0 3px rgba(16, 185, 129, 0.2)' : 'none',
                                  }}
                                  title={seg.selected ? 'Deseleccionar' : 'Seleccionar para exportar'}
                                >
                                  {seg.selected && <IoMdCheckmark size={16} color="#fff" />}
                                </div>
                                <div style={{
                                  width: '4px', height: '20px',
                                  background: segColors[i % segColors.length],
                                  borderRadius: '2px', flexShrink: 0,
                                }} />
                                <span style={{ color: colors.text, fontSize: '14px', fontWeight: '600', flex: 1 }}>
                                  {seg.name}
                                </span>
                                {/* Blur toggle per clip */}
                                {blurConfig.mode === 'auto' && (blurConfig.confirmedFaces?.length || 0) > 0 && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const currentZone = clipBlurZones[seg.id] || { enabled: true, x: 0, y: 0, radius: 0 };
                                      setClipBlurZones({
                                        ...clipBlurZones,
                                        [seg.id]: { ...currentZone, enabled: !currentZone.enabled }
                                      });
                                    }}
                                    style={{
                                      background: (clipBlurZones[seg.id]?.enabled !== false) ? 'rgba(255, 200, 0, 0.2)' : 'transparent',
                                      border: `1px solid ${(clipBlurZones[seg.id]?.enabled !== false) ? colors.accent : colors.border}`,
                                      color: (clipBlurZones[seg.id]?.enabled !== false) ? colors.accent : colors.textMuted,
                                      cursor: 'pointer',
                                      padding: '4px',
                                      borderRadius: '4px',
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '2px',
                                    }}
                                    title={(clipBlurZones[seg.id]?.enabled !== false) ? "Censura activa en este clip" : "Censura desactivada en este clip"}
                                  >
                                    <MdBlurOn size={14} />
                                  </button>
                                )}
                                {/* Edit button */}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    isEditing ? cancelEditing() : startEditingClip(seg.id);
                                  }}
                                  style={{
                                    background: isEditing ? colors.accent : 'transparent',
                                    border: 'none',
                                    color: isEditing ? '#000' : colors.textMuted,
                                    cursor: 'pointer',
                                    padding: '4px',
                                    borderRadius: '4px',
                                  }}
                                  title={isEditing ? "Cancelar edición" : "Editar clip"}
                                >
                                  <FiEdit2 size={14} />
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); deleteSegment(seg.id); }}
                                  style={{
                                    background: 'transparent', border: 'none',
                                    color: colors.textMuted, cursor: 'pointer', padding: '4px',
                                  }}
                                >
                                  <IoMdTrash size={16} />
                                </button>
                              </div>
                              <div style={{
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                color: colors.textSecondary, fontSize: '12px', fontFamily: 'monospace',
                              }}>
                                <span>{fmt(seg.start)} → {fmt(seg.end || duration)}</span>
                                <span style={{
                                  background: colors.card, padding: '2px 8px',
                                  borderRadius: '4px', color: colors.primary, fontWeight: '600',
                                }}>
                                  {fmt((seg.end || duration) - seg.start)}
                                </span>
                              </div>
                              {/* Edit instructions */}
                              {isEditing && (
                                <div style={{
                                  marginTop: '8px', padding: '8px',
                                  background: 'rgba(0,0,0,0.3)', borderRadius: '6px',
                                  fontSize: '11px', color: colors.textSecondary,
                                  textAlign: 'center',
                                }}>
                                  Navega → <strong style={{ color: colors.accent }}>I</strong> nuevo inicio,
                                  <strong style={{ color: colors.secondary }}> O</strong> nuevo fin
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Export Section */}
                {sidebarOpen && segments.length > 0 && (
                  <div style={{
                    borderTop: `1px solid ${colors.border}`,
                    padding: '10px',
                    background: `linear-gradient(180deg, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.4) 100%)`,
                  }}>
                    {/* Compact header with duration and clip count */}
                    {(() => {
                      const selectedSegs = segments.filter(s => s.selected);
                      const totalSeconds = selectedSegs.reduce((acc, seg) => {
                        const segDuration = (seg.end || duration) - seg.start;
                        return acc + segDuration;
                      }, 0);
                      const mins = Math.floor(totalSeconds / 60);
                      const secs = Math.floor(totalSeconds % 60);
                      return (
                        <div style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          marginBottom: '10px',
                          padding: '8px 12px',
                          background: colors.card,
                          borderRadius: '10px',
                          border: `1px solid ${colors.border}`,
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ color: colors.textMuted, fontSize: '11px' }}>{selectedCount}/{segments.length}</span>
                            <span style={{ color: colors.textMuted }}>·</span>
                            <span style={{
                              color: colors.primary,
                              fontSize: '14px',
                              fontWeight: '700',
                              fontFamily: 'monospace',
                            }}>
                              {mins}:{secs.toString().padStart(2, '0')}
                            </span>
                          </div>
                          {/* Format toggle - compact */}
                          <div style={{ display: 'flex', gap: '4px' }}>
                            <button
                              onClick={() => setExportSeparate(false)}
                              style={{
                                background: !exportSeparate ? colors.primary : 'transparent',
                                color: !exportSeparate ? '#000' : colors.textMuted,
                                border: !exportSeparate ? 'none' : `1px solid ${colors.border}`,
                                borderRadius: '6px',
                                padding: '4px 10px',
                                cursor: 'pointer',
                                fontSize: '10px',
                                fontWeight: '600',
                              }}
                              title="Un archivo"
                            >
                              ◆ 1
                            </button>
                            <button
                              onClick={() => setExportSeparate(true)}
                              style={{
                                background: exportSeparate ? colors.secondary : 'transparent',
                                color: exportSeparate ? '#fff' : colors.textMuted,
                                border: exportSeparate ? 'none' : `1px solid ${colors.border}`,
                                borderRadius: '6px',
                                padding: '4px 10px',
                                cursor: 'pointer',
                                fontSize: '10px',
                                fontWeight: '600',
                              }}
                              title="Archivos separados"
                            >
                              ◇ {selectedCount}
                            </button>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Active effects indicator */}
                    {(cropConfig.enabled || blurConfig.mode === 'auto') && (
                      <div style={{
                        display: 'flex',
                        gap: '6px',
                        marginBottom: '10px',
                        flexWrap: 'wrap',
                      }}>
                        {cropConfig.enabled && (
                          <span style={{
                            background: colors.primary,
                            color: '#000',
                            padding: '4px 10px',
                            borderRadius: '6px',
                            fontSize: '10px',
                            fontWeight: '600',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}>
                            <FiCrop size={11} /> {cropConfig.preset?.toUpperCase() || 'CROP'}
                          </span>
                        )}
                        {blurConfig.mode === 'auto' && (
                          <span style={{
                            background: colors.secondary,
                            color: '#fff',
                            padding: '4px 10px',
                            borderRadius: '6px',
                            fontSize: '10px',
                            fontWeight: '600',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}>
                            <MdBlurOn size={11} /> AUTO
                          </span>
                        )}
                      </div>
                    )}

                    {/* Preview clips button */}
                    <button
                      onClick={isPreviewMode ? stopPreview : startPreview}
                      disabled={selectedCount === 0}
                      style={{
                        width: '100%',
                        marginBottom: '10px',
                        background: isPreviewMode ? colors.danger : colors.accent,
                        color: isPreviewMode ? '#fff' : '#000',
                        border: 'none',
                        borderRadius: '8px',
                        padding: '10px 14px',
                        fontSize: '13px',
                        fontWeight: '700',
                        cursor: selectedCount === 0 ? 'not-allowed' : 'pointer',
                        opacity: selectedCount === 0 ? 0.5 : 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                      }}
                    >
                      {isPreviewMode ? <><IoMdPause size={16} /> Detener Preview</> : <><IoMdPlay size={16} /> Ver Clips</>}
                    </button>

                    {/* Export format selector */}
                    <div style={{
                      display: 'flex',
                      gap: '6px',
                      marginBottom: '10px',
                    }}>
                      <button
                        onClick={() => setExportSeparate(false)}
                        style={{
                          flex: 1,
                          background: !exportSeparate ? colors.primary : colors.card,
                          color: !exportSeparate ? '#000' : colors.text,
                          border: !exportSeparate ? 'none' : `1px solid ${colors.border}`,
                          borderRadius: '8px',
                          padding: '10px',
                          cursor: 'pointer',
                          fontSize: '12px',
                          fontWeight: '600',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: '2px',
                        }}
                      >
                        <span style={{ fontSize: '16px' }}>◆</span>
                        <span>Combinado</span>
                      </button>
                      <button
                        onClick={() => setExportSeparate(true)}
                        style={{
                          flex: 1,
                          background: exportSeparate ? colors.secondary : colors.card,
                          color: exportSeparate ? '#fff' : colors.text,
                          border: exportSeparate ? 'none' : `1px solid ${colors.border}`,
                          borderRadius: '8px',
                          padding: '10px',
                          cursor: 'pointer',
                          fontSize: '12px',
                          fontWeight: '600',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: '2px',
                        }}
                      >
                        <span style={{ fontSize: '16px' }}>◇◇</span>
                        <span>{selectedCount} Archivos</span>
                      </button>
                    </div>

                    {/* Export Button with Progress */}
                    {isExporting ? (
                      <div style={{
                        background: colors.card,
                        borderRadius: '10px',
                        padding: '12px',
                        marginBottom: '8px',
                      }}>
                        <div style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          marginBottom: '8px',
                        }}>
                          <span style={{ color: colors.text, fontSize: '13px', fontWeight: '600' }}>
                            Exportando...
                          </span>
                          <span style={{
                            color: colors.primary,
                            fontSize: '14px',
                            fontWeight: '700',
                            fontFamily: 'monospace',
                          }}>
                            {exportProgress.toFixed(1)}%
                          </span>
                        </div>
                        {/* Progress bar */}
                        <div style={{
                          width: '100%',
                          height: '8px',
                          background: colors.border,
                          borderRadius: '4px',
                          overflow: 'hidden',
                        }}>
                          <div style={{
                            width: `${exportProgress}%`,
                            height: '100%',
                            background: `linear-gradient(90deg, ${colors.primary}, ${colors.secondary})`,
                            borderRadius: '4px',
                            transition: 'width 0.3s ease',
                          }} />
                        </div>
                        <div style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          marginTop: '6px',
                          fontSize: '10px',
                          color: colors.textMuted,
                        }}>
                          <span>Procesando video...</span>
                          <span>
                            {Math.round(exportProgress)}% completado
                            {getExportETA() && ` • ~${getExportETA()} restante`}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <>
                        {/* Preview with Effects Button - compact */}
                        {(cropConfig.enabled || blurConfig.mode === 'auto') && (
                          <button
                            onClick={handleGeneratePreview}
                            disabled={isGeneratingPreview}
                            style={{
                              width: '100%',
                              marginBottom: '6px',
                              background: isGeneratingPreview ? colors.card : 'rgba(12, 182, 145, 0.2)',
                              color: isGeneratingPreview ? colors.textMuted : '#0CB691',
                              border: `1px solid ${isGeneratingPreview ? colors.border : '#0CB691'}`,
                              borderRadius: '6px',
                              padding: '6px 10px',
                              fontSize: '11px',
                              fontWeight: '600',
                              cursor: isGeneratingPreview ? 'wait' : 'pointer',
                              opacity: isGeneratingPreview ? 0.8 : 1,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '4px',
                            }}
                          >
                            {isGeneratingPreview ? (
                              <>⏳ {previewProgress.toFixed(0)}%</>
                            ) : (
                              <><IoMdPlay size={12} /> Preview Efectos</>
                            )}
                          </button>
                        )}

                         {/* Export Button */}
                        <button
                          onClick={handleExport}
                          disabled={selectedCount === 0}
                          style={{
                            width: '100%',
                            background: colors.gradient,
                            color: '#fff',
                            border: 'none',
                            borderRadius: '12px',
                            padding: '14px 18px',
                            fontSize: '15px',
                            fontWeight: '700',
                            cursor: selectedCount === 0 ? 'not-allowed' : 'pointer',
                            opacity: selectedCount === 0 ? 0.5 : 1,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '10px',
                            boxShadow: '0 6px 20px rgba(12, 182, 145, 0.35), 0 0 30px rgba(209, 245, 102, 0.15)',
                            transition: 'all 0.2s ease',
                            textShadow: '0 1px 3px rgba(0,0,0,0.3)',
                          }}
                        >
                          <span style={{ fontSize: '18px' }}>{exportSeparate ? '◇' : '◆'}</span>
                          Exportar {exportSeparate ? `${selectedCount} Videos` : 'Combinado'}
                        </button>
                      </>
                    )}
                    {currentOperation?.status === 'completed' && (
                      <button
                        onClick={handleDownload}
                        style={{
                          width: '100%',
                          marginTop: '8px',
                          background: colors.gradientAccent,
                          color: '#fff',
                          border: 'none',
                          borderRadius: '10px',
                          padding: '12px 16px',
                          fontSize: '13px',
                          fontWeight: '700',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '6px',
                          boxShadow: '0 4px 15px rgba(209, 245, 102, 0.25)',
                          animation: 'pulse 2s infinite',
                        }}
                      >
                        <IoMdDownload size={16} />
                        Descargar
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Timeline */}
            <div style={{ background: colors.surface, padding: isMobile ? '8px 10px' : '16px' }}>
              <div
                ref={timelineRef}
                onMouseDown={startTimeline}
                onTouchStart={startTimeline}
                style={{
                  position: 'relative', height: isMobile ? '40px' : '56px',
                  background: colors.card, borderRadius: '12px', 
                  cursor: isDraggingTimeline ? 'grabbing' : 'grab',
                  overflow: 'hidden', touchAction: 'none',
                  userSelect: 'none',
                }}
              >
                {waveformUrl && (
                  <img src={waveformUrl} alt="" style={{
                    position: 'absolute', inset: 0, width: '100%', height: '100%',
                    objectFit: 'fill', opacity: 0.3, filter: 'hue-rotate(140deg)',
                  }} />
                )}

                {/* Segments */}
                {segments.map((seg, i) => (
                  <div key={seg.id} style={{
                    position: 'absolute',
                    left: `${(seg.start / duration) * 100}%`,
                    width: `${((seg.end || duration) - seg.start) / duration * 100}%`,
                    height: '100%',
                    background: segColors[i % segColors.length],
                    opacity: seg.selected ? 0.6 : 0.3,
                    borderRadius: '4px',
                  }} />
                ))}

                {/* Pending region */}
                {pendingCutStart !== null && (
                  <div style={{
                    position: 'absolute',
                    left: `${(Math.min(pendingCutStart, currentTime) / duration) * 100}%`,
                    width: `${(Math.abs(currentTime - pendingCutStart) / duration) * 100}%`,
                    height: '100%',
                    background: colors.accent,
                    opacity: 0.4,
                  }} />
                )}

                {/* Playhead */}
                <div style={{
                  position: 'absolute', left: `${(currentTime / duration) * 100}%`,
                  top: 0, bottom: 0, width: isDraggingTimeline ? '4px' : '3px',
                  background: isDraggingTimeline ? colors.primary : colors.danger, 
                  borderRadius: '2px', zIndex: 10,
                  boxShadow: `0 0 ${isDraggingTimeline ? '12px' : '8px'} ${isDraggingTimeline ? colors.primary : colors.danger}`,
                  transition: isDraggingTimeline ? 'none' : 'all 0.1s ease',
                  cursor: isDraggingTimeline ? 'grabbing' : 'grab',
                }}>
                  <div style={{
                    position: 'absolute', top: '-4px', left: isDraggingTimeline ? '-6px' : '-5px',
                    width: isDraggingTimeline ? '16px' : '13px', 
                    height: isDraggingTimeline ? '16px' : '13px', 
                    background: isDraggingTimeline ? colors.primary : colors.danger, 
                    borderRadius: '50%',
                    border: isDraggingTimeline ? '2px solid white' : 'none',
                    transition: isDraggingTimeline ? 'none' : 'all 0.1s ease',
                  }} />
                </div>

                <span style={{ position: 'absolute', bottom: '4px', left: '8px', color: colors.textMuted, fontSize: '10px', fontFamily: 'monospace' }}>0:00</span>
                <span style={{ position: 'absolute', bottom: '4px', right: '8px', color: colors.textMuted, fontSize: '10px', fontFamily: 'monospace' }}>{fmt(duration)}</span>
              </div>
            </div>

            {/* Controls */}
            <div style={{ background: colors.surface, padding: isMobile ? '8px 10px' : '16px', borderTop: `1px solid ${colors.border}` }}>
              {/* Playback + Cut controls in one row */}
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '4px', marginBottom: '8px', flexWrap: 'wrap' }}>
                {/* Back 10s */}
                <button onClick={() => {
                  if (videoRef.current) {
                    seekVideo(Math.max(0, videoRef.current.currentTime - 10));
                  }
                }} style={iconBtn} title="-10s">
                  <IoMdSkipBackward size={20} />
                </button>

                {/* Play/Pause */}
                <button
                  onClick={() => videoRef.current && (videoRef.current.paused ? videoRef.current.play() : videoRef.current.pause())}
                  style={{ ...iconBtn, background: colors.primary, border: 'none', width: isMobile ? '46px' : '56px', height: isMobile ? '46px' : '56px' }}
                  title="Play/Pause"
                >
                  {isPlaying ? <IoMdPause size={26} /> : <IoMdPlay size={26} style={{ marginLeft: '2px' }} />}
                </button>

                {/* Forward 10s */}
                <button onClick={() => {
                  if (videoRef.current) {
                    seekVideo(Math.min(duration, videoRef.current.currentTime + 10));
                  }
                }} style={iconBtn} title="+10s">
                  <IoMdSkipForward size={20} />
                </button>

                {/* Divider */}
                <div style={{ width: '1px', height: '32px', background: colors.border, margin: '0 8px' }} />

                {/* I - Set In Point */}
                <button
                  onClick={handleMarkStart}
                  style={{
                    ...iconBtn,
                    width: 'auto',
                    minWidth: isMobile ? '68px' : '115px',
                    height: isMobile ? '42px' : '56px',
                    padding: isMobile ? '0 10px' : '0 18px',
                    borderRadius: '16px',
                    background: pendingCutStart !== null
                      ? `linear-gradient(135deg, ${colors.accent} 0%, #FF9500 100%)`
                      : `linear-gradient(145deg, ${colors.card} 0%, ${colors.surface} 100%)`,
                    color: pendingCutStart !== null ? '#000' : colors.text,
                    fontSize: '14px',
                    fontWeight: '700',
                    gap: '8px',
                    boxShadow: pendingCutStart !== null
                      ? '0 6px 20px rgba(255, 200, 0, 0.5), inset 0 1px 0 rgba(255,255,255,0.3)'
                      : '0 2px 10px rgba(0,0,0,0.2)',
                    transition: 'all 0.2s ease',
                    border: pendingCutStart !== null ? 'none' : `1px solid ${colors.border}`,
                  }}
                  title="Marcar punto de inicio (tecla I)"
                >
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '3px',
                  }}>
                    <span style={{
                      fontWeight: '800',
                      fontSize: isMobile ? '15px' : '20px',
                      background: pendingCutStart !== null ? 'rgba(0,0,0,0.15)' : colors.gradient,
                      width: isMobile ? '22px' : '30px',
                      height: isMobile ? '22px' : '30px',
                      borderRadius: '8px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: pendingCutStart !== null ? '#000' : '#fff',
                    }}>I</span>
                    <span style={{ fontSize: isMobile ? '9px' : '10px', fontWeight: '600' }}>
                      {pendingCutStart !== null ? '✓ Listo' : 'Marcar IN'}
                    </span>
                  </div>
                </button>

                {/* O - Set Out Point */}
                <button
                  onClick={handleMarkEnd}
                  disabled={pendingCutStart === null && !editingClipId}
                  style={{
                    ...iconBtn,
                    width: 'auto',
                    minWidth: isMobile ? '68px' : '115px',
                    height: isMobile ? '42px' : '56px',
                    padding: isMobile ? '0 10px' : '0 18px',
                    borderRadius: '16px',
                    background: pendingCutStart !== null
                      ? colors.gradientAccent
                      : `linear-gradient(145deg, ${colors.card} 0%, ${colors.surface} 100%)`,
                    border: pendingCutStart !== null ? 'none' : `1px solid ${colors.border}`,
                    color: pendingCutStart !== null ? '#fff' : colors.textMuted,
                    fontSize: '14px',
                    fontWeight: '700',
                    gap: '8px',
                    boxShadow: pendingCutStart !== null
                      ? '0 6px 20px rgba(209, 245, 102, 0.5), inset 0 1px 0 rgba(255,255,255,0.2)'
                      : '0 2px 10px rgba(0,0,0,0.2)',
                    opacity: pendingCutStart === null && !editingClipId ? 0.5 : 1,
                    cursor: pendingCutStart === null && !editingClipId ? 'not-allowed' : 'pointer',
                    transition: 'all 0.2s ease',
                  }}
                  title="Marcar fin y crear clip (tecla O)"
                >
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '3px',
                  }}>
                    <span style={{
                      fontWeight: '800',
                      fontSize: isMobile ? '15px' : '20px',
                      background: pendingCutStart !== null ? 'rgba(255,255,255,0.2)' : colors.border,
                      width: isMobile ? '22px' : '30px',
                      height: isMobile ? '22px' : '30px',
                      borderRadius: '8px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}>O</span>
                    <span style={{ fontSize: isMobile ? '9px' : '10px', fontWeight: '600' }}>
                      {pendingCutStart !== null ? '+ Crear' : 'Marcar OUT'}
                    </span>
                  </div>
                </button>

                {/* Divider */}
                <div style={{ width: '1px', height: '32px', background: colors.border, margin: '0 8px' }} />

                {/* Screenshot button */}
                <button
                  onClick={handleScreenshot}
                  disabled={isCapturingScreenshot}
                  style={{
                    ...iconBtn,
                    opacity: isCapturingScreenshot ? 0.7 : 1,
                  }}
                  title="Take Screenshot"
                >
                  <IoMdCamera size={22} />
                </button>
              </div>

              {/* Quick Actions - Sidebar toggles */}
              <div style={{
                display: 'flex',
                gap: isMobile ? '8px' : '10px',
                flexWrap: 'wrap',
                justifyContent: 'center',
              }}>
                {/* Toggle tools sidebar */}
                <button
                  onClick={() => setLeftSidebarOpen(!leftSidebarOpen)}
                  style={{
                    background: leftSidebarOpen ? colors.gradientAccent : colors.card,
                    color: leftSidebarOpen ? '#fff' : colors.text,
                    border: leftSidebarOpen ? 'none' : `1px solid ${colors.border}`,
                    borderRadius: '10px',
                    padding: isMobile ? '8px 12px' : '12px 18px',
                    fontSize: isMobile ? '12px' : '13px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    transition: 'all 0.2s ease',
                  }}
                >
                  <span style={{ fontSize: '14px' }}>🎬</span>
                  Herramientas
                  {(cropConfig.enabled || blurConfig.mode === 'auto') && (
                    <span style={{
                      background: 'rgba(255,255,255,0.2)',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      fontSize: '10px',
                    }}>
                      {(cropConfig.enabled ? 1 : 0) + (blurConfig.mode === 'auto' ? 1 : 0)}
                    </span>
                  )}
                </button>
                {/* Toggle clips sidebar */}
                <button
                  onClick={() => setSidebarOpen(!sidebarOpen)}
                  style={{
                    background: sidebarOpen ? colors.primary : colors.card,
                    color: sidebarOpen ? '#000' : colors.text,
                    border: sidebarOpen ? 'none' : `1px solid ${colors.border}`,
                    borderRadius: '10px',
                    padding: isMobile ? '8px 12px' : '12px 18px',
                    fontSize: isMobile ? '12px' : '13px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    transition: 'all 0.2s ease',
                  }}
                >
                  <MdPlaylistPlay size={16} />
                  Clips
                  {segments.length > 0 && (
                    <span style={{
                      background: sidebarOpen ? 'rgba(0,0,0,0.2)' : colors.primary,
                      color: sidebarOpen ? '#000' : '#fff',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      fontSize: '11px',
                      fontWeight: '700',
                    }}>
                      {segments.length}
                    </span>
                  )}
                </button>
              </div>
            </div>

            {/* Keyboard shortcuts hint: solo desktop (en movil no hay
                teclado fisico y el hint ocupa espacio util) */}
            {!isMobile && segments.length === 0 && !sidebarOpen && (
              <div style={{
                background: colors.bg, borderTop: `1px solid ${colors.border}`,
                padding: '16px', textAlign: 'center',
              }}>
                <p style={{ color: colors.textMuted, margin: 0, fontSize: '13px' }}>
                  💡 Use <strong style={{ color: colors.accent }}>I</strong> to mark start, <strong style={{ color: colors.secondary }}>O</strong> to create clip • <strong>Space</strong> to play/pause • <strong>←→</strong> to seek
                </p>
              </div>
            )}
          </>
        )}
      </div>

      {/* Toast Notifications */}
      <div style={{
        position: 'fixed',
        bottom: '24px',
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        zIndex: 1000,
        pointerEvents: 'none',
      }}>
        {toasts.map((toast) => (
          <div
            key={toast.id}
            style={{
              background: toast.type === 'success' ? colors.primary
                : toast.type === 'error' ? colors.danger
                : toast.type === 'warning' ? colors.accent
                : colors.secondary,
              color: toast.type === 'warning' ? '#000' : '#fff',
              padding: '12px 20px',
              borderRadius: '10px',
              fontSize: '14px',
              fontWeight: '500',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
              pointerEvents: 'auto',
              animation: 'slideUp 0.3s ease',
            }}
          >
            <span>{toast.type === 'success' ? '✓' : toast.type === 'error' ? '✕' : 'ℹ'}</span>
            <span>{toast.message}</span>
            {toast.action && (
              <button
                onClick={toast.action.onClick}
                style={{
                  background: 'rgba(255,255,255,0.2)',
                  border: 'none',
                  color: 'inherit',
                  padding: '4px 12px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: '600',
                  fontSize: '13px',
                }}
              >
                {toast.action.label}
              </button>
            )}
            <button
              onClick={() => dismissToast(toast.id)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'inherit',
                opacity: 0.7,
                cursor: 'pointer',
                padding: '4px',
                marginLeft: '4px',
              }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {/* First time user hint overlay */}
      {showFirstTimeHint && videoUrl && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1001,
        }}>
          <div style={{
            background: colors.surface,
            borderRadius: '16px',
            padding: '32px',
            maxWidth: '400px',
            textAlign: 'center',
            border: `1px solid ${colors.border}`,
          }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>✂️</div>
            <h2 style={{ color: colors.text, margin: '0 0 12px', fontSize: '22px' }}>
              ¡Bienvenido a LosslessCut!
            </h2>
            <p style={{ color: colors.textSecondary, margin: '0 0 24px', lineHeight: '1.6' }}>
              Crear clips es muy fácil:
            </p>
            <div style={{
              background: colors.card,
              borderRadius: '12px',
              padding: '20px',
              marginBottom: '24px',
              textAlign: 'left',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                <span style={{
                  background: colors.accent,
                  color: '#000',
                  width: '32px',
                  height: '32px',
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: '700',
                  fontSize: '16px',
                }}>I</span>
                <span style={{ color: colors.text }}>Marca el <strong>inicio</strong> del clip</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                <span style={{
                  background: colors.secondary,
                  color: '#fff',
                  width: '32px',
                  height: '32px',
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: '700',
                  fontSize: '16px',
                }}>O</span>
                <span style={{ color: colors.text }}>Marca el <strong>fin</strong> y crea el clip</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{
                  background: colors.border,
                  color: colors.text,
                  width: '32px',
                  height: '32px',
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: '700',
                  fontSize: '10px',
                }}>←→</span>
                <span style={{ color: colors.text }}>Navega por el video</span>
              </div>
            </div>
            <button
              onClick={() => {
                setShowFirstTimeHint(false);
                localStorage.setItem('losslesscut_seen_hint', 'true');
              }}
              style={{
                background: colors.primary,
                color: '#fff',
                border: 'none',
                borderRadius: '10px',
                padding: '14px 32px',
                fontSize: '16px',
                fontWeight: '600',
                cursor: 'pointer',
                width: '100%',
              }}
            >
              ¡Entendido!
            </button>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {showPreviewModal && previewVideoUrl && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.9)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1002,
        }}>
          <div style={{
            background: colors.surface,
            borderRadius: '16px',
            padding: '24px',
            maxWidth: '90vw',
            maxHeight: '90vh',
            display: 'flex',
            flexDirection: 'column',
            border: `1px solid ${colors.border}`,
          }}>
            {/* Header */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '16px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '10px',
                  background: '#0CB691',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <IoMdPlay size={20} color="#fff" />
                </div>
                <div>
                  <div style={{ color: colors.text, fontWeight: '600', fontSize: '16px' }}>
                    Vista Previa con Efectos
                  </div>
                  <div style={{ color: colors.textMuted, fontSize: '12px' }}>
                    {cropConfig.enabled && `Crop: ${cropConfig.preset?.toUpperCase() || 'Custom'}`}
                    {cropConfig.enabled && blurConfig.mode === 'auto' && ' + '}
                    {blurConfig.mode === 'auto' && `Censura activa`}
                  </div>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowPreviewModal(false);
                  setPreviewVideoUrl(null);
                }}
                style={{
                  background: colors.card,
                  border: 'none',
                  color: colors.textMuted,
                  cursor: 'pointer',
                  padding: '10px',
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <IoMdClose size={20} />
              </button>
            </div>

            {/* Video Preview */}
            <div style={{
              background: '#000',
              borderRadius: '12px',
              overflow: 'hidden',
              marginBottom: '16px',
            }}>
              <video
                src={previewVideoUrl}
                controls
                autoPlay
                loop
                style={{
                  maxWidth: '100%',
                  maxHeight: '60vh',
                  display: 'block',
                }}
              />
            </div>

            {/* Info */}
            <div style={{
              background: colors.card,
              borderRadius: '10px',
              padding: '14px',
              marginBottom: '16px',
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                color: colors.textSecondary,
                fontSize: '13px',
              }}>
                <span style={{ fontSize: '18px' }}>💡</span>
                <span>
                  Este es un preview de 5 segundos. El video exportado incluirá todos los clips seleccionados con los efectos aplicados.
                </span>
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={() => {
                  setShowPreviewModal(false);
                  setPreviewVideoUrl(null);
                }}
                style={{
                  flex: 1,
                  background: colors.card,
                  color: colors.text,
                  border: `1px solid ${colors.border}`,
                  borderRadius: '10px',
                  padding: '12px',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: 'pointer',
                }}
              >
                Cerrar
              </button>
              <button
                onClick={() => {
                  setShowPreviewModal(false);
                  setPreviewVideoUrl(null);
                  handleExport();
                }}
                disabled={segments.filter(s => s.selected).length === 0}
                style={{
                  flex: 1,
                  background: colors.primary,
                  color: '#fff',
                  border: 'none',
                  borderRadius: '10px',
                  padding: '12px',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                }}
              >
                <IoMdDownload size={16} />
                Exportar Video Completo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Watermark Settings Modal */}
      {showWatermarkSettings && (
        <WatermarkSettings
          config={watermarkConfig}
          onChange={setWatermarkConfig}
          onClose={() => setShowWatermarkSettings(false)}
        />
      )}

      {/* CSS Animation */}
      <style>{`
        @keyframes slideUp {
          from { transform: translateY(20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

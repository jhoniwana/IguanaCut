// API client for web version - replaces Electron IPC
const API_BASE = process.env.IS_WEB ? '' : 'http://localhost:8090';

// Session ID for isolating users without login
function getSessionId(): string {
  const STORAGE_KEY = 'losslesscut_session_id';
  let sessionId = localStorage.getItem(STORAGE_KEY);
  if (!sessionId) {
    // Generate a unique session ID
    sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substring(2, 15);
    localStorage.setItem(STORAGE_KEY, sessionId);
  }
  return sessionId;
}

// Helper to get headers with session ID
function getHeaders(contentType?: string): HeadersInit {
  const headers: HeadersInit = {
    'X-Session-ID': getSessionId(),
  };
  if (contentType) {
    headers['Content-Type'] = contentType;
  }
  return headers;
}

export interface Video {
  id: string;
  file_name: string;
  file_path: string;
  file_size: number;
  duration: number;
  width: number;
  height: number;
  codec: string;
  format: string;
  created_at: string;
}

export interface Project {
  id: string;
  name: string;
  video_id: string;
  segments: Segment[];
  created_at: string;
  updated_at: string;
}

export interface Segment {
  id: string;
  name: string;
  start: number;
  end?: number;
  tags?: Record<string, string>;
  color?: number;
  selected?: boolean;
}

export interface Download {
  id: string;
  url: string;
  title?: string;
  duration?: number;
  status: 'pending' | 'downloading' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  file_path?: string;
  video_id?: string;
  error?: string;
  created_at: string;
  updated_at: string;
}

export interface OutputFile {
  file_name: string;
  size: number;
  created_at: string;
}

export interface Operation {
  id: string;
  type: string;
  project_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  output_files?: string[];
  error?: string;
  created_at: string;
  completed_at?: string;
}

// ==================== Multi-Clip Timeline Types ====================

export interface TimelineClip {
  id: string;
  source_video_id: string;
  source_start: number;
  source_end: number;
  timeline_position: number;
  track_index: number;
  name: string;
  duration: number;
}

export interface TimelineProject {
  id: string;
  name: string;
  session_id?: string;
  video_ids: string[];
  timeline_clips: TimelineClip[];
  total_duration: number;
  created_at: string;
  updated_at: string;
}

export interface CodecInfo {
  video_codec: string;
  audio_codec: string;
  width: number;
  height: number;
  frame_rate: string;
  sample_rate: number;
  pixel_format: string;
}

export interface CodecCompatibility {
  compatible: boolean;
  requires_encode: boolean;
  reason?: string;
  codecs: CodecInfo[];
}

export interface BatchUploadResponse {
  videos: Video[];
  errors: string[];
  success: number;
  failed: number;
}

export interface WatermarkOptions {
  enabled: boolean;
  filename: string;
  position: string;
  opacity: number;
  scale: number;
  margin_x: number;
  margin_y: number;
}

export interface TimelineExportRequest {
  project_id: string;
  clip_ids?: string[];
  output_name?: string;
  format?: string;
  force_reencode?: boolean;
  crop_enabled?: boolean;
  crop_x?: number;
  crop_y?: number;
  crop_width?: number;
  crop_height?: number;
  watermark?: WatermarkOptions;
}

class ApiClient {
  private uploadWithProgress(
    url: string,
    formData: FormData,
    onProgress?: (pct: number) => void,
  ): Promise<XMLHttpRequest> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', url)
      xhr.setRequestHeader('X-Session-ID', getSessionId())
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress(Math.round((e.loaded / e.total) * 100))
        }
      }
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve(xhr)
        else reject(new Error(`Upload failed: ${xhr.status}`))
      }
      xhr.onerror = () => reject(new Error('Upload failed'))
      xhr.send(formData)
    })
  }

  async uploadVideo(file: File, onProgress?: (pct: number) => void) {
    const formData = new FormData();
    formData.append('file', file);
    const xhr = await this.uploadWithProgress('/api/videos/upload', formData, onProgress)
    return JSON.parse(xhr.responseText)
  }

  // Batch upload multiple videos
  async batchUpload(files: File[], onProgress?: (pct: number) => void): Promise<BatchUploadResponse> {
    const formData = new FormData();
    files.forEach(file => formData.append('files', file));
    const xhr = await this.uploadWithProgress('/api/videos/batch-upload', formData, onProgress)
    return JSON.parse(xhr.responseText)
  }

  // Check codec compatibility for merging
  async checkCodecCompatibility(videoIds: string[]): Promise<CodecCompatibility> {
    const response = await fetch('/api/videos/check-compat', {
      method: 'POST',
      headers: getHeaders('application/json'),
      body: JSON.stringify({ video_ids: videoIds }),
    });
    if (!response.ok) throw new Error('Compatibility check failed');
    return response.json();
  }

  // Get video thumbnail
  getThumbnailUrl(videoId: string, timestamp = 0): string {
    return `/api/videos/${videoId}/thumbnail?t=${timestamp}&session=${getSessionId()}`;
  }

  async startDownload(url: string, format = 'best'): Promise<Download> {
    const response = await fetch('/api/downloads', {
      method: 'POST',
      headers: getHeaders('application/json'),
      body: JSON.stringify({ url, format }),
    });
    if (!response.ok) throw new Error('Download start failed');
    return response.json();
  }

  async getDownload(id: string): Promise<Download> {
    const response = await fetch(`/api/downloads/${id}`, {
      headers: getHeaders(),
    });
    if (!response.ok) throw new Error('Failed to get download');
    return response.json();
  }

  async listDownloads() {
    const response = await fetch('/api/downloads', {
      headers: getHeaders(),
    });
    if (!response.ok) throw new Error('Failed to list downloads');
    return response.json();
  }

  async clearAllDownloads() {
    const response = await fetch('/api/downloads', {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (!response.ok) throw new Error('Failed to clear downloads');
    return response.json();
  }

  async createProject(name: string, videoId: string) {
    const response = await fetch('/api/projects', {
      method: 'POST',
      headers: getHeaders('application/json'),
      body: JSON.stringify({ name, video_id: videoId }),
    });
    if (!response.ok) throw new Error('Create project failed');
    return response.json();
  }

  async updateProject(id: string, project: Project) {
    const response = await fetch(`/api/projects/${id}`, {
      method: 'PUT',
      headers: getHeaders('application/json'),
      body: JSON.stringify(project),
    });
    if (!response.ok) throw new Error('Update failed');
    return response.json();
  }

  async getProject(id: string): Promise<Project> {
    const response = await fetch(`/api/projects/${id}`, {
      headers: getHeaders(),
    });
    if (!response.ok) throw new Error('Project not found');
    return response.json();
  }

  async exportProject(projectId: string, options: any): Promise<Operation> {
    const response = await fetch(`/api/projects/${projectId}/export`, {
      method: 'POST',
      headers: getHeaders('application/json'),
      body: JSON.stringify(options),
    });
    if (!response.ok) throw new Error('Export failed');
    return response.json();
  }

  async getOperation(operationId: string): Promise<Operation> {
    const response = await fetch(`/api/operations/${operationId}`, {
      headers: getHeaders(),
    });
    if (!response.ok) throw new Error('Failed to get operation status');
    return response.json();
  }

  getVideoStreamUrl(videoId: string): string {
    return `/api/videos/${videoId}/stream?session=${getSessionId()}`;
  }

  async captureScreenshot(videoId: string, timestamp: number, quality = 2): Promise<{ filename: string; url: string }> {
    const response = await fetch(`/api/videos/${videoId}/screenshot`, {
      method: 'POST',
      headers: getHeaders('application/json'),
      body: JSON.stringify({ timestamp, quality }),
    });
    if (!response.ok) throw new Error('Screenshot capture failed');
    return response.json();
  }

  // ==================== Timeline API ====================

  async createTimelineProject(name: string, videoIds: string[] = []): Promise<TimelineProject> {
    const response = await fetch('/api/timeline/projects', {
      method: 'POST',
      headers: getHeaders('application/json'),
      body: JSON.stringify({ name, video_ids: videoIds }),
    });
    if (!response.ok) throw new Error('Failed to create timeline project');
    return response.json();
  }

  async getTimelineProject(projectId: string): Promise<TimelineProject> {
    const response = await fetch(`/api/timeline/projects/${projectId}`, {
      headers: getHeaders(),
    });
    if (!response.ok) throw new Error('Failed to get timeline project');
    return response.json();
  }

  async listTimelineProjects(): Promise<TimelineProject[]> {
    const response = await fetch('/api/timeline/projects', {
      headers: getHeaders(),
    });
    if (!response.ok) throw new Error('Failed to list timeline projects');
    return response.json();
  }

  async updateTimelineProject(projectId: string, data: Partial<TimelineProject>): Promise<TimelineProject> {
    const response = await fetch(`/api/timeline/projects/${projectId}`, {
      method: 'PUT',
      headers: getHeaders('application/json'),
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('Failed to update timeline project');
    return response.json();
  }

  async deleteTimelineProject(projectId: string): Promise<void> {
    const response = await fetch(`/api/timeline/projects/${projectId}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (!response.ok) throw new Error('Failed to delete timeline project');
  }

  async addTimelineClip(projectId: string, clip: Omit<TimelineClip, 'id' | 'duration'>): Promise<TimelineClip> {
    const response = await fetch(`/api/timeline/projects/${projectId}/clips`, {
      method: 'POST',
      headers: getHeaders('application/json'),
      body: JSON.stringify(clip),
    });
    if (!response.ok) throw new Error('Failed to add clip');
    return response.json();
  }

  async updateTimelineClip(projectId: string, clipId: string, clip: Partial<TimelineClip>): Promise<TimelineClip> {
    const response = await fetch(`/api/timeline/projects/${projectId}/clips/${clipId}`, {
      method: 'PUT',
      headers: getHeaders('application/json'),
      body: JSON.stringify(clip),
    });
    if (!response.ok) throw new Error('Failed to update clip');
    return response.json();
  }

  async deleteTimelineClip(projectId: string, clipId: string): Promise<void> {
    const response = await fetch(`/api/timeline/projects/${projectId}/clips/${clipId}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (!response.ok) throw new Error('Failed to delete clip');
  }

  async reorderTimelineClips(projectId: string, clipIds: string[]): Promise<TimelineProject> {
    const response = await fetch(`/api/timeline/projects/${projectId}/reorder`, {
      method: 'POST',
      headers: getHeaders('application/json'),
      body: JSON.stringify({ clip_ids: clipIds }),
    });
    if (!response.ok) throw new Error('Failed to reorder clips');
    return response.json();
  }

  async addVideoSource(projectId: string, videoId: string): Promise<{ video: Video }> {
    const response = await fetch(`/api/timeline/projects/${projectId}/sources`, {
      method: 'POST',
      headers: getHeaders('application/json'),
      body: JSON.stringify({ video_id: videoId }),
    });
    if (!response.ok) throw new Error('Failed to add video source');
    return response.json();
  }

  async removeVideoSource(projectId: string, videoId: string): Promise<void> {
    const response = await fetch(`/api/timeline/projects/${projectId}/sources/${videoId}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (!response.ok) throw new Error('Failed to remove video source');
  }

  async exportTimeline(projectId: string, options: TimelineExportRequest): Promise<Operation> {
    const response = await fetch(`/api/timeline/projects/${projectId}/export`, {
      method: 'POST',
      headers: getHeaders('application/json'),
      body: JSON.stringify(options),
    });
    if (!response.ok) throw new Error('Failed to start timeline export');
    return response.json();
  }

  // ==================== Watermark API ====================

  async uploadWatermark(file: File): Promise<{ id: string; filename: string; url: string }> {
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch('/api/watermarks/upload', {
      method: 'POST',
      headers: { 'X-Session-ID': getSessionId() },
      body: formData,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(error.error || 'Watermark upload failed');
    }
    return response.json();
  }

  async deleteWatermark(filename: string): Promise<void> {
    const response = await fetch(`/api/watermarks/${filename}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (!response.ok) throw new Error('Failed to delete watermark');
  }

  getWatermarkUrl(filename: string): string {
    return `/api/watermarks/${filename}`;
  }

  // --- Archivos exportados (cortes) ---
  async listOutputs(): Promise<OutputFile[]> {
    const response = await fetch('/api/outputs', {
      headers: getHeaders(),
    });
    if (!response.ok) throw new Error('Failed to list outputs');
    const data = await response.json();
    return data.outputs || [];
  }

  async deleteOutput(filename: string): Promise<void> {
    const response = await fetch(`/api/outputs/${encodeURIComponent(filename)}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (!response.ok) throw new Error('Failed to delete output');
  }

  getOutputUrl(filename: string): string {
    return `/api/outputs/${encodeURIComponent(filename)}`;
  }

  // Get current session ID (for display or debugging)
  getSessionId(): string {
    return getSessionId();
  }
}

export const apiClient = new ApiClient();

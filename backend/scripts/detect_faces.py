#!/usr/bin/env python3
"""
Face Detection Preview Script with InsightFace

Uses InsightFace library for state-of-the-art face detection:
- SCRFD: Fast and accurate face detection
- ArcFace: 512-dimensional face embeddings for consistent identity tracking

Falls back to YuNet/MediaPipe if InsightFace is unavailable.
"""

import argparse
import json
import sys
import os
import base64

try:
    import cv2
    import numpy as np
except ImportError:
    print(json.dumps({"error": "OpenCV not installed"}))
    sys.exit(1)

# Try to import InsightFace (preferred)
INSIGHTFACE_AVAILABLE = False
try:
    from insightface.app import FaceAnalysis
    INSIGHTFACE_AVAILABLE = True
except ImportError:
    pass

# Fallback to MediaPipe
MEDIAPIPE_AVAILABLE = False
try:
    import mediapipe as mp
    MEDIAPIPE_AVAILABLE = True
except ImportError:
    pass


class InsightFaceDetector:
    """State-of-the-art face detector using InsightFace (SCRFD + ArcFace)."""

    def __init__(self, confidence=0.5):
        self.confidence = confidence
        self.app = None
        self._init_detector()

    def _init_detector(self):
        """Initialize InsightFace with SCRFD detection and ArcFace recognition."""
        try:
            # Create model directory
            model_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models", "insightface")
            os.makedirs(model_dir, exist_ok=True)
            os.environ['INSIGHTFACE_HOME'] = model_dir

            # Initialize FaceAnalysis with buffalo_l model (includes SCRFD + ArcFace)
            self.app = FaceAnalysis(
                name='buffalo_l',  # High accuracy model
                providers=['CPUExecutionProvider']  # Use CPU for compatibility
            )
            self.app.prepare(ctx_id=-1, det_size=(640, 640), det_thresh=self.confidence)
            print(json.dumps({"detector": "InsightFace (SCRFD + ArcFace)", "embedding_size": 512}))
            sys.stdout.flush()
        except Exception as e:
            print(json.dumps({"warning": f"InsightFace init failed: {e}, falling back to YuNet"}))
            sys.stdout.flush()
            self.app = None

    def detect(self, frame):
        """
        Detect faces and return list of (x, y, w, h, confidence, embedding).

        Returns:
            List of tuples: (x, y, w, h, confidence, embedding_512d)
        """
        if self.app is None:
            return []

        try:
            faces = self.app.get(frame)
            results = []

            for face in faces:
                bbox = face.bbox.astype(int)
                x1, y1, x2, y2 = bbox
                w, h = x2 - x1, y2 - y1

                # Get confidence score
                conf = float(face.det_score) if hasattr(face, 'det_score') else 0.9

                # Get 512-dimensional ArcFace embedding
                embedding = face.embedding.tolist() if face.embedding is not None else None

                if w > 30 and h > 30:
                    results.append((x1, y1, w, h, conf, embedding))

            return results
        except Exception as e:
            print(json.dumps({"warning": f"InsightFace detection error: {e}"}))
            return []


class FallbackDetector:
    """Fallback face detector using YuNet and MediaPipe."""

    def __init__(self, confidence=0.5):
        self.confidence = confidence
        self.mp_face_detection = None
        self.face_detector_yn = None
        self._init_detector()

    def _init_detector(self):
        # Initialize MediaPipe
        if MEDIAPIPE_AVAILABLE:
            try:
                self.mp_face_detection = mp.solutions.face_detection.FaceDetection(
                    model_selection=1,
                    min_detection_confidence=self.confidence
                )
            except Exception as e:
                print(json.dumps({"warning": f"MediaPipe init failed: {e}"}))

        # Initialize YuNet
        model_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")
        os.makedirs(model_dir, exist_ok=True)
        yn_model_path = os.path.join(model_dir, "face_detection_yunet_2023mar.onnx")

        if not os.path.exists(yn_model_path):
            try:
                import urllib.request
                YN_URL = "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx"
                urllib.request.urlretrieve(YN_URL, yn_model_path)
            except:
                pass

        if os.path.exists(yn_model_path):
            try:
                self.face_detector_yn = cv2.FaceDetectorYN.create(
                    yn_model_path, "", (320, 320),
                    score_threshold=self.confidence,
                    nms_threshold=0.3, top_k=20
                )
                print(json.dumps({"detector": "YuNet + MediaPipe (fallback)"}))
                sys.stdout.flush()
            except:
                pass

    def detect(self, frame):
        """Detect faces, returns list of (x, y, w, h, confidence, None)."""
        h, w = frame.shape[:2]
        results = []

        # YuNet detection
        if self.face_detector_yn is not None:
            self.face_detector_yn.setInputSize((w, h))
            _, faces = self.face_detector_yn.detect(frame)
            if faces is not None:
                for face in faces:
                    x, y, fw, fh = int(face[0]), int(face[1]), int(face[2]), int(face[3])
                    conf = float(face[14])
                    x, y = max(0, x), max(0, y)
                    fw, fh = min(fw, w - x), min(fh, h - y)
                    if fw > 30 and fh > 30:
                        results.append((x, y, fw, fh, conf, None))

        # MediaPipe detection
        if self.mp_face_detection is not None:
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            mp_results = self.mp_face_detection.process(rgb)
            if mp_results.detections:
                for det in mp_results.detections:
                    bbox = det.location_data.relative_bounding_box
                    x = int(bbox.xmin * w)
                    y = int(bbox.ymin * h)
                    fw = int(bbox.width * w)
                    fh = int(bbox.height * h)
                    conf = det.score[0]
                    x, y = max(0, x), max(0, y)
                    fw, fh = min(fw, w - x), min(fh, h - y)

                    if fw > 30 and fh > 30:
                        # Check for duplicates
                        is_dup = any(self._iou((x, y, fw, fh), (rx, ry, rw, rh)) > 0.5
                                    for rx, ry, rw, rh, _, _ in results)
                        if not is_dup:
                            results.append((x, y, fw, fh, float(conf), None))

        return results

    def _iou(self, box1, box2):
        x1, y1, w1, h1 = box1
        x2, y2, w2, h2 = box2
        xi1, yi1 = max(x1, x2), max(y1, y2)
        xi2, yi2 = min(x1 + w1, x2 + w2), min(y1 + h1, y2 + h2)
        inter = max(0, xi2 - xi1) * max(0, yi2 - yi1)
        union = w1 * h1 + w2 * h2 - inter
        return inter / union if union > 0 else 0

    def __del__(self):
        if self.mp_face_detection:
            self.mp_face_detection.close()


def compute_hsv_signature(face_roi):
    """Compute HSV histogram signature (fallback when no embedding available)."""
    try:
        resized = cv2.resize(face_roi, (64, 64))
        hsv = cv2.cvtColor(resized, cv2.COLOR_BGR2HSV)
        hist = cv2.calcHist([hsv], [0, 1], None, [30, 32], [0, 180, 0, 256])
        cv2.normalize(hist, hist, 0, 1, cv2.NORM_MINMAX)
        return hist.flatten().tolist()
    except:
        return None


def cosine_similarity(emb1, emb2):
    """Compute cosine similarity between two embeddings."""
    if emb1 is None or emb2 is None:
        return 0.0
    try:
        a = np.array(emb1)
        b = np.array(emb2)
        return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-10))
    except:
        return 0.0


def are_same_person(sig1, sig2, use_embedding=True, threshold=0.5):
    """
    Check if two signatures represent the same person.

    For ArcFace embeddings: cosine similarity > 0.5 indicates same person
    For HSV histograms: Bhattacharyya distance < 0.5 indicates similar face
    """
    if sig1 is None or sig2 is None:
        return False

    # Detect if using ArcFace embedding (512 dim) or HSV histogram (960 dim)
    is_embedding = len(sig1) == 512

    if is_embedding:
        # ArcFace: higher cosine similarity = same person
        sim = cosine_similarity(sig1, sig2)
        return sim > threshold
    else:
        # HSV histogram: lower Bhattacharyya distance = more similar
        try:
            s1 = np.array(sig1, dtype=np.float32).reshape(-1, 1)
            s2 = np.array(sig2, dtype=np.float32).reshape(-1, 1)
            dist = cv2.compareHist(s1, s2, cv2.HISTCMP_BHATTACHARYYA)
            return dist < threshold
        except:
            return False


def detect_faces_in_video(video_path, sample_interval=1.0, max_faces=50, group_similar=True, segments=None):
    """
    Detect faces in video using InsightFace (SCRFD + ArcFace).

    Returns unique faces with 512-dimensional embeddings for consistent tracking.
    """
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return {"error": f"Cannot open video: {video_path}"}

    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = total_frames / fps

    # Initialize detector (prefer InsightFace, fallback to YuNet/MediaPipe)
    if INSIGHTFACE_AVAILABLE:
        detector = InsightFaceDetector(confidence=0.5)
        if detector.app is None:
            detector = FallbackDetector(confidence=0.5)
            use_arcface = False
        else:
            use_arcface = True
    else:
        detector = FallbackDetector(confidence=0.5)
        use_arcface = False

    unique_faces = []
    frame_interval = int(fps * sample_interval)

    # Build frames to process
    if segments and len(segments) > 0:
        frames_to_process = []
        for seg in segments:
            start_frame = int(seg.get('start', 0) * fps)
            end_frame = int(seg.get('end', duration) * fps)
            for f in range(start_frame, min(end_frame, total_frames), frame_interval):
                frames_to_process.append(f)
        frames_to_process = sorted(set(frames_to_process))
    else:
        frames_to_process = list(range(0, total_frames, frame_interval))

    print(json.dumps({
        "status": "scanning",
        "duration": duration,
        "using_arcface": use_arcface,
        "frames_to_scan": len(frames_to_process)
    }))
    sys.stdout.flush()

    total_to_scan = len(frames_to_process)

    for idx, frame_num in enumerate(frames_to_process):
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_num)
        ret, frame = cap.read()
        if not ret:
            continue

        timestamp = frame_num / fps
        faces = detector.detect(frame)

        for x, y, w, h, conf, embedding in faces:
            # Convert numpy types to Python native types
            x, y, w, h = int(x), int(y), int(w), int(h)
            conf = float(conf)

            if w < 40 or h < 40:
                continue

            # Extract face ROI
            pad = int(min(w, h) * 0.15)
            x1 = max(0, x - pad)
            y1 = max(0, y - pad)
            x2 = min(frame.shape[1], x + w + pad)
            y2 = min(frame.shape[0], y + h + pad)
            face_roi = frame[y1:y2, x1:x2]

            if face_roi.size == 0:
                continue

            # Use ArcFace embedding if available, else compute HSV signature
            # Convert to Python list for JSON serialization
            if embedding is not None:
                signature = [float(v) for v in embedding]
            else:
                signature = compute_hsv_signature(face_roi)

            # Match against existing faces
            matched = False
            if group_similar:
                # Use stricter threshold for ArcFace (0.5 cosine sim), looser for HSV
                match_threshold = 0.5 if (embedding is not None) else 0.4

                for uf in unique_faces:
                    if are_same_person(signature, uf['signature'], threshold=match_threshold):
                        uf['count'] += 1
                        # Update to better quality (larger face)
                        if w * h > uf['bbox'][2] * uf['bbox'][3]:
                            uf['thumbnail'] = face_roi.copy()
                            uf['bbox'] = [x, y, w, h]
                            uf['timestamp'] = float(timestamp)
                            uf['signature'] = signature
                            uf['confidence'] = conf
                        matched = True
                        break

            if not matched and len(unique_faces) < max_faces:
                unique_faces.append({
                    'id': f"face_{len(unique_faces)}",
                    'thumbnail': face_roi.copy(),
                    'signature': signature,
                    'timestamp': float(timestamp),
                    'bbox': [x, y, w, h],
                    'confidence': conf,
                    'count': 1
                })

        # Progress update
        if idx % max(1, total_to_scan // 20) == 0:
            print(json.dumps({
                "progress": (idx + 1) / total_to_scan,
                "faces_found": len(unique_faces)
            }))
            sys.stdout.flush()

    cap.release()

    # Filter by appearance count (skip if not grouping)
    if group_similar:
        confirmed_faces = [f for f in unique_faces if f['count'] >= 2]
    else:
        confirmed_faces = unique_faces

    # Sort by confidence (best quality first)
    confirmed_faces.sort(key=lambda f: f.get('confidence', 0), reverse=True)

    # Convert to output format
    results = []
    for face in confirmed_faces:
        thumbnail = face['thumbnail']

        # Resize thumbnail
        max_size = 120
        th, tw = thumbnail.shape[:2]
        if max(th, tw) > max_size:
            scale = max_size / max(th, tw)
            thumbnail = cv2.resize(thumbnail, (int(tw * scale), int(th * scale)))

        _, buffer = cv2.imencode('.jpg', thumbnail, [cv2.IMWRITE_JPEG_QUALITY, 85])
        b64_thumbnail = base64.b64encode(buffer).decode('utf-8')

        # Convert numpy types to native Python types for JSON serialization
        bbox = [int(v) for v in face['bbox']]
        signature = [float(v) for v in face['signature']] if face['signature'] else None

        results.append({
            'id': face['id'],
            'thumbnail': b64_thumbnail,
            'timestamp': float(face['timestamp']),
            'bbox': bbox,
            'signature': signature,
            'appearances': int(face['count']),
            'confidence': float(face.get('confidence', 0.9))
        })

    return {
        "status": "completed",
        "faces": results,
        "total_unique_faces": int(len(results)),
        "duration": float(duration),
        "using_arcface": bool(use_arcface)
    }


def main():
    parser = argparse.ArgumentParser(description='Detect faces in video (InsightFace)')
    parser.add_argument('--input', '-i', required=True, help='Input video path')
    parser.add_argument('--interval', '-t', type=float, default=0.5, help='Sample interval in seconds')
    parser.add_argument('--max-faces', '-m', type=int, default=50, help='Maximum faces to detect')
    parser.add_argument('--no-group', action='store_true', help='Disable grouping similar faces')
    parser.add_argument('--segments', '-s', type=str, default='', help='JSON array of segments')

    args = parser.parse_args()

    if not os.path.exists(args.input):
        print(json.dumps({"error": f"Input file not found: {args.input}"}))
        sys.exit(1)

    segments = None
    if args.segments:
        try:
            segments = json.loads(args.segments)
        except:
            pass

    result = detect_faces_in_video(
        args.input,
        args.interval,
        args.max_faces,
        group_similar=not args.no_group,
        segments=segments
    )

    print(json.dumps(result))
    sys.exit(0 if "error" not in result else 1)


if __name__ == '__main__':
    main()

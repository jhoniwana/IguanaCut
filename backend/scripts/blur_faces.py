#!/usr/bin/env python3
"""
Robust Face Detection and Blur with DeepSORT Tracking

Uses DeepSORT for consistent multi-face tracking across video frames.
This solves the problem of faces being detected intermittently.

Key improvements over optical flow:
- Kalman filter for motion prediction
- Deep learning embeddings for appearance matching
- Consistent track IDs across frames
- Handles occlusion and reappearance

Supports multiple blur styles:
- pixelate: Classic mosaic effect
- gaussian: Smooth blur
- color: Solid color fill
- box: Black rectangle
- emoji: Emoji overlay
- image: Custom image overlay
"""

import argparse
import json
import sys
import os
import subprocess
import base64
from concurrent.futures import ThreadPoolExecutor
import threading

try:
    import cv2
    import numpy as np
except ImportError:
    print(json.dumps({"error": "OpenCV not installed. Run: pip install opencv-python-headless numpy"}))
    sys.exit(1)

# Performance settings
DETECTION_SCALE = 0.5  # Scale factor for detection (0.5 = half resolution)
DETECT_EVERY_N_FRAMES = 5  # Only run full detection every N frames (saves CPU)
INSIGHTFACE_DETECT_INTERVAL = 8  # InsightFace is heavy, run less frequently
MAX_WORKERS = 4  # Thread pool size for parallel blur

# Try to import InsightFace (preferred for consistent detection)
INSIGHTFACE_AVAILABLE = False
try:
    from insightface.app import FaceAnalysis
    INSIGHTFACE_AVAILABLE = True
except ImportError:
    pass

# Try to import DeepSORT
DEEPSORT_AVAILABLE = False
try:
    from deep_sort_realtime.deepsort_tracker import DeepSort
    DEEPSORT_AVAILABLE = True
except ImportError:
    print(json.dumps({"warning": "DeepSORT not available, using fallback tracker"}))

# Try to import MediaPipe
MEDIAPIPE_AVAILABLE = False
try:
    import mediapipe as mp
    MEDIAPIPE_AVAILABLE = True
except ImportError:
    pass

# Try to import PIL for emoji/image support
PIL_AVAILABLE = False
try:
    from PIL import Image, ImageDraw, ImageFont
    PIL_AVAILABLE = True
except ImportError:
    pass


# Global InsightFace app instance (cached for performance)
_INSIGHTFACE_APP = None


class InsightFaceDetector:
    """Face detector using InsightFace (SCRFD + ArcFace) for consistent detection."""

    def __init__(self, confidence=0.5):
        global _INSIGHTFACE_APP
        self.confidence = confidence
        self.app = None

        if not INSIGHTFACE_AVAILABLE:
            return

        try:
            # Reuse cached instance for performance
            if _INSIGHTFACE_APP is not None:
                self.app = _INSIGHTFACE_APP
                return

            model_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models", "insightface")
            os.makedirs(model_dir, exist_ok=True)
            os.environ['INSIGHTFACE_HOME'] = model_dir

            self.app = FaceAnalysis(
                name='buffalo_l',
                providers=['CPUExecutionProvider']
            )
            self.app.prepare(ctx_id=-1, det_size=(640, 640), det_thresh=confidence)
            _INSIGHTFACE_APP = self.app
            print(json.dumps({"detector": "InsightFace (SCRFD + ArcFace)"}))
            sys.stdout.flush()
        except Exception as e:
            print(json.dumps({"warning": f"InsightFace init failed: {e}"}))
            sys.stdout.flush()
            self.app = None

    def detect(self, frame):
        """Detect faces and return list of (x, y, w, h, confidence, embedding)."""
        if self.app is None:
            return []

        try:
            faces = self.app.get(frame)
            results = []

            for face in faces:
                bbox = face.bbox.astype(int)
                x1, y1, x2, y2 = bbox
                w, h = x2 - x1, y2 - y1
                conf = float(face.det_score) if hasattr(face, 'det_score') else 0.9
                embedding = [float(v) for v in face.embedding] if face.embedding is not None else None

                if w > 30 and h > 30:
                    results.append((int(x1), int(y1), int(w), int(h), conf, embedding))

            return results
        except Exception as e:
            return []

    def close(self):
        pass  # Keep cached instance


class FaceDetector:
    """Multi-method face detector combining MediaPipe + YuNet for best coverage.

    Optimizations:
    - Detects on scaled-down frames for speed
    - Scales coordinates back to original resolution
    """

    def __init__(self, confidence=0.5, scale=DETECTION_SCALE):
        self.confidence = confidence
        self.scale = scale  # Detection scale factor
        self.mp_face_detection = None
        self.face_detector_yn = None
        self.net = None
        self._init_detector()

    def _init_detector(self):
        """Initialize face detectors - prefer YuNet, fallback to MediaPipe/DNN."""
        model_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")
        os.makedirs(model_dir, exist_ok=True)

        # Try YuNet first (best for landmarks validation)
        yn_model_path = os.path.join(model_dir, "face_detection_yunet_2023mar.onnx")
        if not os.path.exists(yn_model_path):
            YN_URL = "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx"
            try:
                import urllib.request
                print(json.dumps({"status": "downloading", "message": "Downloading YuNet face model..."}))
                sys.stdout.flush()
                urllib.request.urlretrieve(YN_URL, yn_model_path)
            except Exception as e:
                print(json.dumps({"warning": f"Could not download YuNet model: {e}"}))

        if os.path.exists(yn_model_path):
            try:
                self.face_detector_yn = cv2.FaceDetectorYN.create(
                    yn_model_path, "", (320, 320),
                    score_threshold=self.confidence,
                    nms_threshold=0.3,
                    top_k=10
                )
                print(json.dumps({"detector": "YuNet (with landmarks)"}))
                sys.stdout.flush()
            except Exception as e:
                print(json.dumps({"warning": f"YuNet init failed: {e}"}))

        # Also initialize MediaPipe as backup
        if MEDIAPIPE_AVAILABLE:
            try:
                self.mp_face_detection = mp.solutions.face_detection.FaceDetection(
                    model_selection=1,
                    min_detection_confidence=self.confidence
                )
                if not self.face_detector_yn:
                    print(json.dumps({"detector": "MediaPipe"}))
                    sys.stdout.flush()
            except Exception as e:
                print(json.dumps({"warning": f"MediaPipe init failed: {e}"}))

        # DNN fallback
        if not self.face_detector_yn and not self.mp_face_detection:
            self._init_dnn(model_dir)

    def _init_dnn(self, model_dir):
        """Initialize OpenCV DNN face detector as last resort."""
        model_path = os.path.join(model_dir, "res10_300x300_ssd_iter_140000.caffemodel")
        config_path = os.path.join(model_dir, "deploy.prototxt")

        MODEL_URL = "https://raw.githubusercontent.com/opencv/opencv_3rdparty/dnn_samples_face_detector_20170830/res10_300x300_ssd_iter_140000.caffemodel"
        CONFIG_URL = "https://raw.githubusercontent.com/opencv/opencv/master/samples/dnn/face_detector/deploy.prototxt"

        import urllib.request
        if not os.path.exists(model_path):
            urllib.request.urlretrieve(MODEL_URL, model_path)
        if not os.path.exists(config_path):
            urllib.request.urlretrieve(CONFIG_URL, config_path)

        self.net = cv2.dnn.readNetFromCaffe(config_path, model_path)
        print(json.dumps({"detector": "OpenCV DNN"}))
        sys.stdout.flush()

    def detect(self, frame):
        """Detect faces and return list of (x, y, w, h, confidence).

        Uses scaled detection for performance, then scales coordinates back.
        """
        orig_h, orig_w = frame.shape[:2]

        # Scale down for faster detection if scale < 1
        if self.scale < 1.0:
            scaled_frame = cv2.resize(frame, None, fx=self.scale, fy=self.scale,
                                      interpolation=cv2.INTER_LINEAR)
            h, w = scaled_frame.shape[:2]
            detect_frame = scaled_frame
        else:
            h, w = orig_h, orig_w
            detect_frame = frame

        all_detections = []

        # YuNet detection (preferred - has landmarks for validation)
        if self.face_detector_yn is not None:
            self.face_detector_yn.setInputSize((w, h))
            _, faces = self.face_detector_yn.detect(detect_frame)

            if faces is not None:
                for face in faces:
                    x, y, fw, fh = int(face[0]), int(face[1]), int(face[2]), int(face[3])
                    conf = float(face[14])

                    # Validate landmarks
                    if self._validate_landmarks(face, x, y, fw, fh):
                        x = max(0, x)
                        y = max(0, y)
                        fw = min(fw, w - x)
                        fh = min(fh, h - y)
                        if fw > 30 and fh > 30:
                            all_detections.append((x, y, fw, fh, conf))

        # MediaPipe detection (good for different angles)
        if self.mp_face_detection is not None:
            rgb_frame = cv2.cvtColor(detect_frame, cv2.COLOR_BGR2RGB)
            results = self.mp_face_detection.process(rgb_frame)

            if results.detections:
                for detection in results.detections:
                    bbox = detection.location_data.relative_bounding_box
                    conf = detection.score[0]

                    x = int(bbox.xmin * w)
                    y = int(bbox.ymin * h)
                    fw = int(bbox.width * w)
                    fh = int(bbox.height * h)

                    x = max(0, x)
                    y = max(0, y)
                    fw = min(fw, w - x)
                    fh = min(fh, h - y)

                    if fw > 30 and fh > 30:
                        # Check if not duplicate
                        is_dup = False
                        for dx, dy, dw, dh, dc in all_detections:
                            if self._iou((x, y, fw, fh), (dx, dy, dw, dh)) > 0.5:
                                is_dup = True
                                break
                        if not is_dup:
                            all_detections.append((x, y, fw, fh, float(conf)))

        # DNN fallback
        if len(all_detections) == 0 and self.net is not None:
            blob = cv2.dnn.blobFromImage(cv2.resize(detect_frame, (300, 300)), 1.0, (300, 300), (104.0, 177.0, 123.0))
            self.net.setInput(blob)
            detections = self.net.forward()

            for i in range(detections.shape[2]):
                conf = detections[0, 0, i, 2]
                if conf > self.confidence:
                    box = detections[0, 0, i, 3:7] * np.array([w, h, w, h])
                    x1, y1, x2, y2 = box.astype(int)
                    all_detections.append((x1, y1, x2 - x1, y2 - y1, float(conf)))

        # Scale coordinates back to original resolution
        if self.scale < 1.0 and len(all_detections) > 0:
            scale_inv = 1.0 / self.scale
            scaled_detections = []
            for (x, y, fw, fh, conf) in all_detections:
                sx = int(x * scale_inv)
                sy = int(y * scale_inv)
                sw = int(fw * scale_inv)
                sh = int(fh * scale_inv)
                # Clamp to original bounds
                sx = max(0, min(sx, orig_w - 1))
                sy = max(0, min(sy, orig_h - 1))
                sw = min(sw, orig_w - sx)
                sh = min(sh, orig_h - sy)
                if sw > 20 and sh > 20:
                    scaled_detections.append((sx, sy, sw, sh, conf))
            return scaled_detections

        return all_detections

    def _validate_landmarks(self, face, x, y, w, h):
        """Validate face geometry using YuNet landmarks.

        Strict validation to reduce false positives.
        """
        try:
            re = (face[4], face[5])  # right eye
            le = (face[6], face[7])  # left eye
            nose = (face[8], face[9])
            mr = (face[10], face[11])  # mouth right
            ml = (face[12], face[13])  # mouth left

            # 1. Eyes must be above nose
            eye_y = (re[1] + le[1]) / 2
            if eye_y >= nose[1]:
                return False

            # 2. Nose must be above mouth
            mouth_y = (mr[1] + ml[1]) / 2
            if nose[1] >= mouth_y:
                return False

            # 3. Eyes roughly on same horizontal level
            if abs(re[1] - le[1]) > h * 0.25:
                return False

            # 4. Eye distance should be reasonable
            eye_dist = abs(re[0] - le[0])
            if eye_dist < w * 0.2 or eye_dist > w * 0.7:
                return False

            # 5. Nose should be between the eyes horizontally
            eye_center_x = (re[0] + le[0]) / 2
            if abs(nose[0] - eye_center_x) > w * 0.25:
                return False

            # 6. All landmarks should be within bounding box
            margin = 0.1
            x_min, x_max = x - w * margin, x + w * (1 + margin)
            y_min, y_max = y - h * margin, y + h * (1 + margin)

            for lm in [re, le, nose, mr, ml]:
                if not (x_min <= lm[0] <= x_max and y_min <= lm[1] <= y_max):
                    return False

            # 7. Face aspect ratio check
            aspect = w / h if h > 0 else 0
            if aspect < 0.5 or aspect > 1.8:
                return False

            # 8. Mouth width should be reasonable
            mouth_width = abs(mr[0] - ml[0])
            if mouth_width < w * 0.15 or mouth_width > w * 0.8:
                return False

            return True
        except:
            return False  # Reject on error (safer)

    def _iou(self, box1, box2):
        """Calculate Intersection over Union."""
        x1, y1, w1, h1 = box1
        x2, y2, w2, h2 = box2

        xi1 = max(x1, x2)
        yi1 = max(y1, y2)
        xi2 = min(x1 + w1, x2 + w2)
        yi2 = min(y1 + h1, y2 + h2)

        inter = max(0, xi2 - xi1) * max(0, yi2 - yi1)
        union = w1 * h1 + w2 * h2 - inter
        return inter / union if union > 0 else 0

    def close(self):
        """Cleanup resources."""
        if self.mp_face_detection:
            self.mp_face_detection.close()


def compute_signature(face_roi):
    """Compute face signature for matching with user-confirmed faces.

    Uses HSV histogram (fallback when InsightFace not available during blur).
    """
    try:
        resized = cv2.resize(face_roi, (64, 64))
        hsv = cv2.cvtColor(resized, cv2.COLOR_BGR2HSV)
        hist = cv2.calcHist([hsv], [0, 1], None, [30, 32], [0, 180, 0, 256])
        cv2.normalize(hist, hist, 0, 1, cv2.NORM_MINMAX)
        return hist.flatten()
    except:
        return None


def cosine_similarity(emb1, emb2):
    """Compute cosine similarity between two embeddings."""
    try:
        a = np.array(emb1, dtype=np.float32)
        b = np.array(emb2, dtype=np.float32)
        return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-10))
    except:
        return 0.0


def signature_matches(face_sig, confirmed_signatures, threshold=0.35):
    """Check if detected face matches any user-confirmed signature.

    IMPORTANT:
    - None = no filter provided, blur all detected faces
    - Empty list [] = user explicitly deselected all faces, blur nothing

    Supports both:
    - ArcFace embeddings (512 dims): Uses cosine similarity, threshold > 0.5 = match
    - HSV histograms (960 dims): Uses Bhattacharyya distance, threshold < 0.35 = match
    """
    if confirmed_signatures is None:
        return True  # No filter provided, blur all faces

    if len(confirmed_signatures) == 0:
        return False  # User deselected all faces, blur nothing

    if face_sig is None:
        return False

    # Detect signature type from first confirmed signature
    first_sig = confirmed_signatures[0]
    is_arcface = len(first_sig) == 512

    for conf_sig in confirmed_signatures:
        try:
            if is_arcface:
                # ArcFace: cosine similarity > 0.5 = same person
                sim = cosine_similarity(face_sig, conf_sig)
                if sim > 0.5:
                    return True
            else:
                # HSV histogram: Bhattacharyya distance < threshold = similar
                face_flat = np.array(face_sig, dtype=np.float32).reshape(-1, 1)
                conf_arr = np.array(conf_sig, dtype=np.float32).reshape(-1, 1)

                if face_flat.size == conf_arr.size:
                    dist = cv2.compareHist(face_flat, conf_arr, cv2.HISTCMP_BHATTACHARYYA)
                else:
                    min_size = min(face_flat.size, conf_arr.size)
                    if min_size >= 64:
                        dist = cv2.compareHist(face_flat[:min_size], conf_arr[:min_size], cv2.HISTCMP_BHATTACHARYYA)
                    else:
                        continue

                if dist < threshold:
                    return True
        except:
            continue

    return False


# ============================================
# Blur Style Functions (unchanged from before)
# ============================================

def create_oval_mask(h, w, feather=0.15):
    """Create an oval mask with smooth feathered edges."""
    y, x = np.ogrid[:h, :w]
    cx, cy = w / 2, h / 2
    rx, ry = w / 2, h / 2
    dist = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2
    inner = 1.0 - feather
    mask = np.clip((1.0 - dist) / feather, 0, 1)
    mask = (mask * 255).astype(np.uint8)
    return mask


def pixelate(image, blocks=10):
    """Pixelate an image region with oval shape."""
    h, w = image.shape[:2]
    blocks = max(5, min(blocks, 20))

    pixelated = image.copy()
    xSteps = np.linspace(0, w, blocks + 1, dtype=int)
    ySteps = np.linspace(0, h, blocks + 1, dtype=int)

    for i in range(1, len(ySteps)):
        for j in range(1, len(xSteps)):
            sx, sy = xSteps[j-1], ySteps[i-1]
            ex, ey = xSteps[j], ySteps[i]
            roi = pixelated[sy:ey, sx:ex]
            if roi.size > 0:
                B, G, R = [int(x) for x in cv2.mean(roi)[:3]]
                cv2.rectangle(pixelated, (sx, sy), (ex, ey), (B, G, R), -1)

    mask = create_oval_mask(h, w, feather=0.2)
    mask_3ch = cv2.merge([mask, mask, mask])
    result = (pixelated.astype(float) * (mask_3ch / 255.0) +
              image.astype(float) * (1 - mask_3ch / 255.0)).astype(np.uint8)
    return result


def gaussian_blur(image, intensity=25):
    """Apply Gaussian blur with oval shape and feathered edges."""
    h, w = image.shape[:2]
    ksize = int(intensity * 2) | 1
    ksize = max(5, min(ksize, 99))
    blurred = cv2.GaussianBlur(image, (ksize, ksize), 0)

    mask = create_oval_mask(h, w, feather=0.25)
    mask = cv2.GaussianBlur(mask, (21, 21), 0)
    mask_3ch = cv2.merge([mask, mask, mask])

    result = (blurred.astype(float) * (mask_3ch / 255.0) +
              image.astype(float) * (1 - mask_3ch / 255.0)).astype(np.uint8)
    return result


def color_fill(image, color_hex='#000000'):
    """Fill image region with a solid color in oval shape."""
    h, w = image.shape[:2]
    color_hex = color_hex.lstrip('#')
    if len(color_hex) == 6:
        r, g, b = tuple(int(color_hex[i:i+2], 16) for i in (0, 2, 4))
    else:
        r, g, b = 0, 0, 0

    overlay = np.full_like(image, (b, g, r))
    mask = create_oval_mask(h, w, feather=0.2)
    mask = cv2.GaussianBlur(mask, (15, 15), 0)
    mask_3ch = cv2.merge([mask, mask, mask])

    result = (overlay.astype(float) * (mask_3ch / 255.0) +
              image.astype(float) * (1 - mask_3ch / 255.0)).astype(np.uint8)
    return result


def black_box(image):
    """Fill image region with black oval."""
    h, w = image.shape[:2]
    overlay = np.zeros_like(image)
    mask = create_oval_mask(h, w, feather=0.2)
    mask = cv2.GaussianBlur(mask, (15, 15), 0)
    mask_3ch = cv2.merge([mask, mask, mask])

    result = (overlay.astype(float) * (mask_3ch / 255.0) +
              image.astype(float) * (1 - mask_3ch / 255.0)).astype(np.uint8)
    return result


def emoji_overlay(image, emoji='fire'):
    """Overlay a fun shape/pattern based on emoji selection."""
    h, w = image.shape[:2]

    emoji_styles = {
        '🔥': {'color': (0, 100, 255), 'pattern': 'flame'},
        '💋': {'color': (80, 0, 180), 'pattern': 'lips'},
        '😈': {'color': (100, 0, 150), 'pattern': 'horns'},
        '👅': {'color': (100, 80, 200), 'pattern': 'oval'},
        '🍑': {'color': (140, 160, 255), 'pattern': 'peach'},
        '🍆': {'color': (100, 50, 120), 'pattern': 'oval'},
        '💦': {'color': (255, 200, 100), 'pattern': 'drops'},
        '😏': {'color': (50, 50, 50), 'pattern': 'smirk'},
        '🥵': {'color': (0, 80, 255), 'pattern': 'hot'},
        '😘': {'color': (180, 100, 255), 'pattern': 'kiss'},
        '💕': {'color': (180, 100, 255), 'pattern': 'hearts'},
        '❤️‍🔥': {'color': (0, 50, 220), 'pattern': 'flame'},
        '🌶️': {'color': (0, 50, 200), 'pattern': 'oval'},
        '🍒': {'color': (50, 50, 180), 'pattern': 'cherry'},
        '🍓': {'color': (80, 80, 220), 'pattern': 'oval'},
        '💄': {'color': (50, 0, 180), 'pattern': 'oval'},
        '👙': {'color': (200, 150, 50), 'pattern': 'bikini'},
        '🩲': {'color': (200, 100, 50), 'pattern': 'oval'},
        '😜': {'color': (0, 200, 255), 'pattern': 'wink'},
        '🤫': {'color': (180, 150, 200), 'pattern': 'shh'},
    }

    style = emoji_styles.get(emoji, {'color': (0, 100, 255), 'pattern': 'oval'})
    color = style['color']
    pattern = style['pattern']

    overlay = np.zeros_like(image)
    mask = create_oval_mask(h, w, feather=0.15)

    if pattern == 'flame':
        for i in range(h):
            factor = 1.0 - (i / h) * 0.5
            row_color = tuple(int(c * factor) for c in color)
            overlay[i, :] = row_color
    elif pattern == 'hearts':
        overlay[:] = color
        for _ in range(5):
            cx, cy = np.random.randint(w//4, 3*w//4), np.random.randint(h//4, 3*h//4)
            cv2.circle(overlay, (cx, cy), min(w, h)//8, (255, 200, 255), -1)
    elif pattern == 'cherry':
        r = min(w, h) // 3
        cv2.circle(overlay, (w//3, h//2), r, color, -1)
        cv2.circle(overlay, (2*w//3, h//2), r, color, -1)
        cv2.line(overlay, (w//3, h//2 - r), (w//2, h//4), (0, 100, 0), max(2, w//20))
        cv2.line(overlay, (2*w//3, h//2 - r), (w//2, h//4), (0, 100, 0), max(2, w//20))
    elif pattern == 'peach':
        cv2.ellipse(overlay, (w//2, int(h*0.45)), (int(w*0.45), int(h*0.45)), 0, 0, 360, color, -1)
        cv2.line(overlay, (w//2, h//3), (w//2, h), (int(color[0]*0.7), int(color[1]*0.7), int(color[2]*0.7)), max(2, w//15))
    else:
        overlay[:] = color

    mask = cv2.GaussianBlur(mask, (15, 15), 0)
    mask_3ch = cv2.merge([mask, mask, mask])

    result = (overlay.astype(float) * (mask_3ch / 255.0) +
              image.astype(float) * (1 - mask_3ch / 255.0)).astype(np.uint8)
    return result


_overlay_cache = {}

def image_overlay(image, image_data_b64):
    """Overlay a custom image on the region."""
    global _overlay_cache

    h, w = image.shape[:2]
    cache_key = f"img_{hash(image_data_b64)}_{w}_{h}"

    if cache_key not in _overlay_cache:
        try:
            if ',' in image_data_b64:
                image_data_b64 = image_data_b64.split(',')[1]

            img_bytes = base64.b64decode(image_data_b64)
            nparr = np.frombuffer(img_bytes, np.uint8)
            overlay_img = cv2.imdecode(nparr, cv2.IMREAD_UNCHANGED)

            if overlay_img is None:
                return black_box(image)

            overlay_img = cv2.resize(overlay_img, (w, h), interpolation=cv2.INTER_AREA)
            _overlay_cache[cache_key] = overlay_img
        except Exception as e:
            print(json.dumps({"warning": f"Failed to decode overlay image: {e}"}))
            return black_box(image)

    overlay = _overlay_cache[cache_key]

    if overlay.shape[0] != h or overlay.shape[1] != w:
        overlay = cv2.resize(overlay, (w, h), interpolation=cv2.INTER_AREA)

    if overlay.shape[2] == 4:
        alpha = overlay[:,:,3:4] / 255.0
        bgr = overlay[:,:,:3]
        image[:] = (alpha * bgr + (1 - alpha) * image).astype(np.uint8)
    else:
        image[:] = overlay

    return image


def apply_blur_style(image, style='pixelate', intensity=25, color=None, emoji=None, image_data=None):
    """Apply the specified blur style to an image region."""
    if style == 'pixelate':
        blur_factor = 4.0 - ((intensity - 15) / 30) * 2.5
        blur_blocks = int(max(1.5, min(4.0, blur_factor)) * 4)
        return pixelate(image, blur_blocks)
    elif style == 'gaussian':
        return gaussian_blur(image, intensity)
    elif style == 'color':
        return color_fill(image, color or '#000000')
    elif style == 'box':
        return black_box(image)
    elif style == 'emoji':
        return emoji_overlay(image, emoji or '😀')
    elif style == 'image':
        if image_data:
            return image_overlay(image, image_data)
        else:
            return black_box(image)
    else:
        return pixelate(image, 10)


def check_vaapi_available():
    """Check if VAAPI hardware encoding is available."""
    try:
        # Check if VAAPI device exists
        if os.path.exists('/dev/dri/renderD128'):
            # Test if ffmpeg can use VAAPI
            result = subprocess.run(
                ['ffmpeg', '-hide_banner', '-hwaccels'],
                capture_output=True, text=True, timeout=5
            )
            return 'vaapi' in result.stdout.lower()
    except:
        pass
    return False


# Cache VAAPI availability check
_VAAPI_AVAILABLE = None


def reencode(input_path, output_path, original=None):
    """Re-encode to H.264 for web compatibility.

    Tries hardware acceleration (VAAPI) first, falls back to libx264.
    """
    global _VAAPI_AVAILABLE

    # Check VAAPI availability once
    if _VAAPI_AVAILABLE is None:
        _VAAPI_AVAILABLE = check_vaapi_available()
        if _VAAPI_AVAILABLE:
            print(json.dumps({"info": "VAAPI hardware encoding available"}))
        else:
            print(json.dumps({"info": "Using software encoding (libx264)"}))
        sys.stdout.flush()

    try:
        # Try VAAPI first if available
        if _VAAPI_AVAILABLE:
            success = _reencode_vaapi(input_path, output_path, original)
            if success:
                return True
            print(json.dumps({"warning": "VAAPI encoding failed, falling back to libx264"}))
            sys.stdout.flush()

        # Fallback to libx264
        return _reencode_libx264(input_path, output_path, original)
    except Exception as e:
        print(json.dumps({"warning": f"Re-encode error: {e}"}))
        return False


def _reencode_vaapi(input_path, output_path, original=None):
    """Re-encode using VAAPI hardware acceleration."""
    try:
        cmd = [
            'ffmpeg', '-y', '-hide_banner', '-loglevel', 'error',
            '-vaapi_device', '/dev/dri/renderD128',
            '-i', input_path
        ]
        if original and os.path.exists(original):
            cmd.extend(['-i', original, '-map', '0:v:0', '-map', '1:a:0?'])
        cmd.extend([
            '-vf', 'format=nv12,hwupload',
            '-c:v', 'h264_vaapi',
            '-profile:v', 'high', '-level', '41',
            '-qp', '23',  # Quality parameter (similar to CRF)
            '-movflags', '+faststart'
        ])
        if original and os.path.exists(original):
            cmd.extend(['-c:a', 'aac', '-b:a', '128k'])
        cmd.append(output_path)
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=3600)
        return result.returncode == 0
    except:
        return False


def _reencode_libx264(input_path, output_path, original=None):
    """Re-encode using libx264 (software)."""
    cmd = ['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-i', input_path]
    if original and os.path.exists(original):
        cmd.extend(['-i', original, '-map', '0:v:0', '-map', '1:a:0?'])
    cmd.extend([
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
        '-profile:v', 'high', '-level', '4.1',
        '-pix_fmt', 'yuv420p', '-movflags', '+faststart'
    ])
    if original and os.path.exists(original):
        cmd.extend(['-c:a', 'aac', '-b:a', '128k'])
    cmd.append(output_path)
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=3600)
    return result.returncode == 0


# ============================================
# Main Blur Function with DeepSORT Tracking
# ============================================

def blur_faces(input_path, output_path, blur_intensity=25, confidence=0.5, confirmed_signatures=None,
               blur_style='pixelate', blur_color=None, blur_emoji=None, blur_image=None):
    """Main face blur function using InsightFace for consistent detection."""

    # Detect signature type (512 = ArcFace, 960 = HSV histogram)
    use_arcface = False
    if confirmed_signatures and len(confirmed_signatures) > 0:
        first_sig = confirmed_signatures[0]
        use_arcface = len(first_sig) == 512

    # Log received signatures for debugging
    num_sigs = len(confirmed_signatures) if confirmed_signatures else 0
    print(json.dumps({
        "debug": "starting_blur",
        "num_confirmed_signatures": num_sigs,
        "blur_style": blur_style,
        "use_arcface": use_arcface,
        "insightface_available": INSIGHTFACE_AVAILABLE
    }))
    sys.stdout.flush()

    # Initialize face detector - use InsightFace if signatures are ArcFace embeddings
    if use_arcface and INSIGHTFACE_AVAILABLE:
        detector = InsightFaceDetector(confidence)
        if detector.app is None:
            detector = FaceDetector(confidence)
            use_arcface = False
    else:
        detector = FaceDetector(confidence)

    cap = cv2.VideoCapture(input_path)
    if not cap.isOpened():
        return {"error": f"Cannot open: {input_path}"}

    fps = int(cap.get(cv2.CAP_PROP_FPS)) or 30
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    if total == 0:
        return {"error": "No frames"}

    # Initialize DeepSORT tracker
    if DEEPSORT_AVAILABLE:
        tracker = DeepSort(
            max_age=30,           # Frames to keep track without detection
            n_init=2,             # Detections needed to confirm track
            nms_max_overlap=0.7,  # NMS threshold
            max_cosine_distance=0.4,  # Appearance similarity threshold
            nn_budget=100,        # Max samples per track
            embedder="mobilenet", # Use MobileNet embeddings
            half=True,            # Use FP16 for speed
            embedder_gpu=False    # CPU for compatibility
        )
        print(json.dumps({"tracker": "DeepSORT", "max_age": 30, "n_init": 2}))
    else:
        tracker = None
        print(json.dumps({"tracker": "Fallback (frame-by-frame)"}))
    sys.stdout.flush()

    temp = output_path + '.temp.mp4'
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    out = cv2.VideoWriter(temp, fourcc, fps, (w, h))

    if not out.isOpened():
        cap.release()
        return {"error": "Cannot create output"}

    # Calculate detection interval for logging
    actual_detect_interval = INSIGHTFACE_DETECT_INTERVAL if (use_arcface and INSIGHTFACE_AVAILABLE) else DETECT_EVERY_N_FRAMES

    print(json.dumps({
        "progress": 0,
        "status": "starting",
        "total_frames": total,
        "blur_style": blur_style,
        "detect_every_n_frames": actual_detect_interval,
        "optimization": f"Detecting every {actual_detect_interval} frames ({100//actual_detect_interval}% detection calls)"
    }))
    sys.stdout.flush()

    frame_count = 0
    faces_blurred_total = 0
    last_prog = -1

    # Track which track IDs match confirmed signatures
    confirmed_track_ids = set()
    track_signatures = {}  # track_id -> signature

    # Cache for face positions (used when skipping detection)
    cached_faces = []  # List of (x, y, w, h) from last detection
    last_detection_frame = -999  # Force detection on first frame

    # Determine detection interval based on detector type
    detect_interval = INSIGHTFACE_DETECT_INTERVAL if (use_arcface and isinstance(detector, InsightFaceDetector)) else DETECT_EVERY_N_FRAMES

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        # Only run detection every N frames to save CPU
        run_detection = (frame_count - last_detection_frame) >= detect_interval or frame_count == 0

        if run_detection:
            detections = detector.detect(frame)
            last_detection_frame = frame_count
        else:
            # Use cached positions or let DeepSORT predict
            detections = []

        faces_to_blur = []

        # InsightFace mode: use embeddings directly for matching
        if use_arcface and isinstance(detector, InsightFaceDetector):
            if run_detection and len(detections) > 0:
                # Update cache with new detections
                cached_faces = []
                for detection in detections:
                    # InsightFace returns (x, y, w, h, conf, embedding)
                    x, y, fw, fh, conf, embedding = detection
                    x1, y1 = max(0, x), max(0, y)
                    x2, y2 = min(w, x + fw), min(h, y + fh)

                    if x2 <= x1 or y2 <= y1:
                        continue

                    # Use ArcFace embedding for matching
                    if confirmed_signatures is None:
                        # No filter, blur all
                        faces_to_blur.append((x1, y1, x2 - x1, y2 - y1))
                        cached_faces.append((x1, y1, x2 - x1, y2 - y1))
                    elif len(confirmed_signatures) == 0:
                        # Empty list = blur nothing
                        pass
                    elif embedding is not None:
                        # Check if this face matches any confirmed signature
                        if signature_matches(embedding, confirmed_signatures):
                            faces_to_blur.append((x1, y1, x2 - x1, y2 - y1))
                            cached_faces.append((x1, y1, x2 - x1, y2 - y1))
            else:
                # Use cached face positions for intermediate frames
                faces_to_blur = cached_faces.copy()

        elif DEEPSORT_AVAILABLE and tracker is not None:
            # DeepSORT mode: use tracker for temporal consistency
            # Format detections for DeepSORT: ([left, top, w, h], confidence, class)
            deepsort_dets = []
            for det in detections:
                # Handle both 5-value and 6-value returns
                if len(det) == 6:
                    x, y, fw, fh, conf, _ = det
                else:
                    x, y, fw, fh, conf = det
                deepsort_dets.append(([x, y, fw, fh], conf, "face"))

            # Update tracker
            tracks = tracker.update_tracks(deepsort_dets, frame=frame)

            for track in tracks:
                if not track.is_confirmed():
                    continue

                track_id = track.track_id
                ltrb = track.to_ltrb()  # [left, top, right, bottom]
                x1, y1, x2, y2 = [int(v) for v in ltrb]
                fw, fh = x2 - x1, y2 - y1

                # Clamp to frame bounds
                x1 = max(0, x1)
                y1 = max(0, y1)
                x2 = min(w, x2)
                y2 = min(h, y2)

                if x2 <= x1 or y2 <= y1:
                    continue

                # Compute signature for this track if not already done
                if track_id not in track_signatures:
                    roi = frame[y1:y2, x1:x2]
                    if roi.size > 0:
                        sig = compute_signature(roi)
                        track_signatures[track_id] = sig

                        # Check if matches confirmed signatures
                        matches = signature_matches(sig, confirmed_signatures)
                        if matches:
                            confirmed_track_ids.add(track_id)

                # Only blur if this track matches a confirmed signature
                if confirmed_signatures is None:
                    faces_to_blur.append((x1, y1, x2 - x1, y2 - y1))
                elif len(confirmed_signatures) == 0:
                    pass
                elif track_id in confirmed_track_ids:
                    faces_to_blur.append((x1, y1, x2 - x1, y2 - y1))

        else:
            # Fallback: blur every detected face if it matches signature
            for det in detections:
                # Handle both 5-value and 6-value returns
                if len(det) == 6:
                    x, y, fw, fh, conf, embedding = det
                else:
                    x, y, fw, fh, conf = det
                    embedding = None
                x1, y1 = max(0, x), max(0, y)
                x2, y2 = min(w, x + fw), min(h, y + fh)

                if x2 > x1 and y2 > y1:
                    roi = frame[y1:y2, x1:x2]
                    if roi.size > 0:
                        sig = compute_signature(roi)
                        if signature_matches(sig, confirmed_signatures):
                            faces_to_blur.append((x1, y1, x2 - x1, y2 - y1))

        # Apply blur to detected faces
        for (fx, fy, fw, fh) in faces_to_blur:
            # Add padding
            pad = int(min(fw, fh) * 0.15)
            x1 = max(0, fx - pad)
            y1 = max(0, fy - pad)
            x2 = min(w, fx + fw + pad)
            y2 = min(h, fy + fh + pad)

            if x2 > x1 and y2 > y1:
                roi = frame[y1:y2, x1:x2]
                frame[y1:y2, x1:x2] = apply_blur_style(
                    roi,
                    style=blur_style,
                    intensity=blur_intensity,
                    color=blur_color,
                    emoji=blur_emoji,
                    image_data=blur_image
                )
                faces_blurred_total += 1

        out.write(frame)
        frame_count += 1

        # Progress update
        prog = int((frame_count / total) * 100)
        if prog > last_prog:
            last_prog = prog
            print(json.dumps({
                "progress": prog / 100.0,
                "frame": frame_count,
                "total_frames": total,
                "faces_this_frame": len(faces_to_blur),
                "confirmed_tracks": len(confirmed_track_ids) if DEEPSORT_AVAILABLE else 0
            }))
            sys.stdout.flush()

    cap.release()
    out.release()
    detector.close()

    print(json.dumps({"status": "encoding", "message": "Re-encoding to H.264..."}))
    sys.stdout.flush()

    reencode(temp, output_path, input_path)

    if os.path.exists(temp):
        try:
            os.remove(temp)
        except:
            pass

    result = {
        "status": "completed",
        "progress": 1.0,
        "frames_processed": frame_count,
        "total_faces_blurred": faces_blurred_total,
        "blur_style": blur_style,
        "output_path": output_path,
        "tracker_used": "DeepSORT" if DEEPSORT_AVAILABLE else "Fallback"
    }

    print(json.dumps(result))
    sys.stdout.flush()
    return result


def main():
    parser = argparse.ArgumentParser(description='Face blur with DeepSORT tracking')
    parser.add_argument('--input', '-i', required=True)
    parser.add_argument('--output', '-o', required=True)
    parser.add_argument('--intensity', '-b', type=int, default=25)
    parser.add_argument('--confidence', type=float, default=0.5)
    parser.add_argument('--zones', '-z', type=str, default=None, help='Ignored (legacy)')
    parser.add_argument('--signatures', '-s', type=str, default=None,
                        help='JSON array of confirmed face signatures')
    parser.add_argument('--signatures-file', type=str, default=None,
                        help='Path to JSON file containing confirmed face signatures')
    parser.add_argument('--style', type=str, default='pixelate',
                        help='Blur style: pixelate, gaussian, color, box, emoji, image')
    parser.add_argument('--color', type=str, default='#000000',
                        help='Color for color style (hex)')
    parser.add_argument('--emoji', type=str, default='😀',
                        help='Emoji for emoji style')
    parser.add_argument('--image', type=str, default=None,
                        help='Base64 image data for image style')

    args = parser.parse_args()

    if not os.path.exists(args.input):
        print(json.dumps({"error": f"Input not found: {args.input}"}))
        sys.exit(1)

    # Parse confirmed signatures - prefer file over argument (for large lists)
    confirmed_signatures = None
    if args.signatures_file and os.path.exists(args.signatures_file):
        try:
            with open(args.signatures_file, 'r') as f:
                confirmed_signatures = json.load(f)
            print(json.dumps({"info": f"Loaded {len(confirmed_signatures)} signatures from file"}))
            sys.stdout.flush()
        except Exception as e:
            print(json.dumps({"warning": f"Failed to load signatures file: {e}"}))
            sys.stdout.flush()
    elif args.signatures:
        try:
            confirmed_signatures = json.loads(args.signatures)
            print(json.dumps({"info": f"Loaded {len(confirmed_signatures)} confirmed signatures"}))
            sys.stdout.flush()
        except:
            pass

    result = blur_faces(
        args.input, args.output, args.intensity, args.confidence, confirmed_signatures,
        blur_style=args.style,
        blur_color=args.color,
        blur_emoji=args.emoji,
        blur_image=args.image
    )
    sys.exit(1 if "error" in result else 0)


if __name__ == '__main__':
    main()

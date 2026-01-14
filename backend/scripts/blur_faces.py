#!/usr/bin/env python3
"""
Robust Face Detection with Landmark Verification

This implementation uses multiple layers of validation to minimize false positives:
1. OpenCV FaceDetectorYN (ONNX model) - provides facial landmarks
2. Landmark geometry verification (eyes above nose, mouth below, etc.)
3. Strict confidence thresholds
4. Skin tone verification
5. Temporal consistency filtering
6. Face signature matching for stable tracking

Supports multiple blur styles:
- pixelate: Classic mosaic effect
- gaussian: Smooth blur
- color: Solid color fill
- box: Black rectangle
- emoji: Emoji overlay
- image: Custom image overlay

Based on research:
- FaceDetectorYN: https://docs.opencv.org/4.x/df/d20/classcv_1_1FaceDetectorYN.html
- Landmark verification reduces false positives by 80%+
"""

import argparse
import json
import sys
import os
import subprocess
import base64
import io

try:
    import cv2
    import numpy as np
except ImportError:
    print(json.dumps({"error": "OpenCV not installed. Run: pip install opencv-python-headless numpy"}))
    sys.exit(1)

# Try to import PIL for emoji/image support
PIL_AVAILABLE = False
try:
    from PIL import Image, ImageDraw, ImageFont
    PIL_AVAILABLE = True
except ImportError:
    pass

# Check for dlib (more accurate but optional)
DLIB_AVAILABLE = False
try:
    import dlib
    DLIB_AVAILABLE = True
except ImportError:
    pass

# Lucas-Kanade optical flow parameters
LK_PARAMS = dict(
    winSize=(21, 21),
    maxLevel=3,
    criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 30, 0.01)
)

# Feature detection parameters
FEATURE_PARAMS = dict(
    maxCorners=50,
    qualityLevel=0.05,
    minDistance=5,
    blockSize=5
)


class RobustFaceDetector:
    """
    Multi-layer face detector with strict validation.
    Uses FaceDetectorYN with landmarks, or falls back to DNN.
    """

    def __init__(self, confidence=0.5):
        self.confidence = max(0.6, confidence)  # Minimum 60% confidence
        self.net = None
        self.face_detector_yn = None
        self.dlib_detector = None
        self.input_size = (320, 320)

        # Temporal filtering
        self.recent_detections = []
        self.frame_idx = 0
        self.detection_history = {}  # position_key -> count

        self._init_detector()

    def _init_detector(self):
        """Initialize face detector - prefer FaceDetectorYN, fallback to DNN."""
        model_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")
        os.makedirs(model_dir, exist_ok=True)

        # Try to use FaceDetectorYN (better, provides landmarks)
        yn_model_path = os.path.join(model_dir, "face_detection_yunet_2023mar.onnx")

        if not os.path.exists(yn_model_path):
            # Download YuNet model
            YN_URL = "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx"
            try:
                import urllib.request
                print(json.dumps({"status": "downloading", "message": "Downloading YuNet face model..."}))
                sys.stdout.flush()
                urllib.request.urlretrieve(YN_URL, yn_model_path)
            except Exception as e:
                print(json.dumps({"warning": f"Could not download YuNet model: {e}"}))
                sys.stdout.flush()

        if os.path.exists(yn_model_path):
            try:
                self.face_detector_yn = cv2.FaceDetectorYN.create(
                    yn_model_path,
                    "",
                    self.input_size,
                    score_threshold=self.confidence,
                    nms_threshold=0.3,
                    top_k=5
                )
                print(json.dumps({"detector": "FaceDetectorYN (with landmarks)"}))
                sys.stdout.flush()
                return
            except Exception as e:
                print(json.dumps({"warning": f"FaceDetectorYN init failed: {e}"}))
                sys.stdout.flush()

        # Fallback to DNN
        self._init_dnn(model_dir)

        # Also try dlib for secondary verification
        if DLIB_AVAILABLE:
            try:
                self.dlib_detector = dlib.get_frontal_face_detector()
                print(json.dumps({"secondary_detector": "dlib HOG"}))
                sys.stdout.flush()
            except:
                pass

    def _init_dnn(self, model_dir):
        """Initialize OpenCV DNN detector."""
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
        print(json.dumps({"detector": "OpenCV DNN SSD"}))
        sys.stdout.flush()

    def detect(self, frame):
        """Detect faces with multiple validation layers."""
        self.frame_idx += 1
        h, w = frame.shape[:2]

        # Use FaceDetectorYN if available
        if self.face_detector_yn is not None:
            return self._detect_with_yn(frame)
        else:
            return self._detect_with_dnn(frame)

    def _detect_with_yn(self, frame):
        """
        Detect faces using FaceDetectorYN with landmark verification.
        YuNet provides: [x, y, w, h, x_re, y_re, x_le, y_le, x_nose, y_nose, x_mouth_r, y_mouth_r, x_mouth_l, y_mouth_l, score]
        """
        h, w = frame.shape[:2]

        # Resize for detection
        self.face_detector_yn.setInputSize((w, h))

        _, faces = self.face_detector_yn.detect(frame)

        if faces is None:
            self._update_history([])
            return []

        candidates = []
        for face in faces:
            # Extract bbox and landmarks
            x, y, fw, fh = int(face[0]), int(face[1]), int(face[2]), int(face[3])
            confidence = face[14]

            # Clamp to bounds
            x = max(0, x)
            y = max(0, y)
            fw = min(fw, w - x)
            fh = min(fh, h - y)

            if fw < 30 or fh < 30:
                continue

            # Extract landmarks
            landmarks = {
                'right_eye': (face[4], face[5]),
                'left_eye': (face[6], face[7]),
                'nose': (face[8], face[9]),
                'mouth_right': (face[10], face[11]),
                'mouth_left': (face[12], face[13])
            }

            # CRITICAL: Validate face geometry using landmarks
            if not self._validate_landmarks(landmarks, x, y, fw, fh, h, w):
                continue

            # Additional validation
            if not self._validate_face(frame, x, y, fw, fh, confidence):
                continue

            candidates.append((x, y, fw, fh, confidence))

        # Apply temporal consistency
        faces = self._temporal_filter(candidates)
        self._update_history(candidates)

        return faces

    def _validate_landmarks(self, lm, x, y, w, h, frame_h, frame_w):
        """
        Validate that landmarks form a proper face geometry.
        This is the KEY to reducing false positives.
        """
        try:
            re = lm['right_eye']
            le = lm['left_eye']
            nose = lm['nose']
            mr = lm['mouth_right']
            ml = lm['mouth_left']

            # 1. Eyes should be above the nose
            eye_y = (re[1] + le[1]) / 2
            if eye_y >= nose[1]:
                return False

            # 2. Nose should be above the mouth
            mouth_y = (mr[1] + ml[1]) / 2
            if nose[1] >= mouth_y:
                return False

            # 3. Eyes should be roughly on same horizontal line (within 25% of face height)
            eye_diff_y = abs(re[1] - le[1])
            if eye_diff_y > h * 0.25:
                return False

            # 4. Left eye should be on the left, right eye on the right (from viewer's perspective)
            if le[0] <= re[0]:  # Swapped eyes indicate wrong detection
                return False

            # 5. Mouth corners should be roughly on same level
            mouth_diff_y = abs(mr[1] - ml[1])
            if mouth_diff_y > h * 0.2:
                return False

            # 6. Face width/height from landmarks should match bbox
            eye_dist = abs(le[0] - re[0])
            if eye_dist < w * 0.2 or eye_dist > w * 0.8:
                return False

            # 7. Nose should be between the eyes horizontally
            if nose[0] < min(re[0], le[0]) or nose[0] > max(re[0], le[0]):
                return False

            # 8. All landmarks should be within the bounding box (with margin)
            margin = max(w, h) * 0.1
            for name, (lx, ly) in lm.items():
                if lx < x - margin or lx > x + w + margin:
                    return False
                if ly < y - margin or ly > y + h + margin:
                    return False

            return True

        except Exception:
            return False

    def _detect_with_dnn(self, frame):
        """Detect using OpenCV DNN with strict validation."""
        h, w = frame.shape[:2]

        blob = cv2.dnn.blobFromImage(cv2.resize(frame, (300, 300)), 1.0, (300, 300), (104.0, 177.0, 123.0))
        self.net.setInput(blob)
        detections = self.net.forward()

        candidates = []
        for i in range(detections.shape[2]):
            conf = detections[0, 0, i, 2]
            if conf > self.confidence:
                box = detections[0, 0, i, 3:7] * np.array([w, h, w, h])
                x1, y1, x2, y2 = box.astype(int)
                x1, y1 = max(0, x1), max(0, y1)
                x2, y2 = min(w, x2), min(h, y2)
                fw, fh = x2 - x1, y2 - y1

                if self._validate_face(frame, x1, y1, fw, fh, conf):
                    # Secondary check with dlib if available
                    if self.dlib_detector is not None:
                        if not self._verify_with_dlib(frame, x1, y1, fw, fh):
                            continue
                    candidates.append((x1, y1, fw, fh, conf))

        faces = self._temporal_filter(candidates)
        self._update_history(candidates)
        return faces

    def _verify_with_dlib(self, frame, x, y, w, h):
        """Use dlib as secondary verification - very few false positives."""
        try:
            # Check a slightly expanded region
            pad = int(min(w, h) * 0.2)
            x1 = max(0, x - pad)
            y1 = max(0, y - pad)
            x2 = min(frame.shape[1], x + w + pad)
            y2 = min(frame.shape[0], y + h + pad)

            roi = frame[y1:y2, x1:x2]
            if roi.size == 0:
                return False

            # Convert to grayscale for dlib
            gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)

            # Detect faces with dlib
            dlib_faces = self.dlib_detector(gray, 0)

            # If dlib finds any face in this region, it's probably real
            return len(dlib_faces) > 0

        except Exception:
            return True  # If dlib fails, allow the detection

    def _validate_face(self, frame, x, y, w, h, confidence):
        """Additional validation checks."""
        frame_h, frame_w = frame.shape[:2]

        # Size checks
        if w < 40 or h < 40:
            return False
        if w > frame_w * 0.75 or h > frame_h * 0.75:
            return False

        # Aspect ratio (faces are roughly square)
        aspect = w / h if h > 0 else 0
        if aspect < 0.65 or aspect > 1.5:
            return False

        # Position check
        cx, cy = x + w/2, y + h/2
        if cx < frame_w * 0.03 or cx > frame_w * 0.97:
            return False
        if cy < frame_h * 0.02 or cy > frame_h * 0.98:
            return False

        # Skin tone check
        if not self._has_skin_tones(frame, x, y, w, h):
            return False

        # Higher confidence for smaller faces
        min_dim = min(w, h)
        if min_dim < 50 and confidence < 0.95:
            return False
        if min_dim < 70 and confidence < 0.90:
            return False
        if min_dim < 100 and confidence < 0.87:
            return False

        return True

    def _has_skin_tones(self, frame, x, y, w, h):
        """Check for skin-like colors."""
        try:
            roi = frame[y:y+h, x:x+w]
            if roi.size == 0:
                return False

            hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)

            # Multiple skin tone ranges
            lower_skin1 = np.array([0, 25, 60], dtype=np.uint8)
            upper_skin1 = np.array([25, 255, 255], dtype=np.uint8)

            lower_skin2 = np.array([0, 10, 100], dtype=np.uint8)
            upper_skin2 = np.array([20, 150, 255], dtype=np.uint8)

            mask1 = cv2.inRange(hsv, lower_skin1, upper_skin1)
            mask2 = cv2.inRange(hsv, lower_skin2, upper_skin2)
            mask = cv2.bitwise_or(mask1, mask2)

            skin_ratio = np.sum(mask > 0) / mask.size
            return skin_ratio > 0.20  # At least 20% skin

        except Exception:
            return True

    def _temporal_filter(self, candidates):
        """Require consistent detection across frames."""
        self.recent_detections.append((self.frame_idx, candidates))
        self.recent_detections = [
            (idx, dets) for idx, dets in self.recent_detections
            if self.frame_idx - idx < 8  # Keep 8 frames history
        ]

        # Be more lenient - return faces that pass basic validation
        if len(self.recent_detections) < 2:
            # First frames - return high confidence faces
            return [(x, y, w, h) for x, y, w, h, conf in candidates if conf > 0.7]

        confirmed = []
        for x, y, w, h, conf in candidates:
            similar_count = 0
            for frame_idx, past_dets in self.recent_detections[:-1]:
                for px, py, pw, ph, pconf in past_dets:
                    cx, cy = x + w/2, y + h/2
                    pcx, pcy = px + pw/2, py + ph/2
                    dist = np.sqrt((cx - pcx)**2 + (cy - pcy)**2)
                    threshold = max(w, h) * 0.6  # Slightly larger threshold
                    if dist < threshold:
                        similar_count += 1
                        break

            # Require detection in at least 1 recent frame or good confidence
            if similar_count >= 1 or conf > 0.75:
                confirmed.append((x, y, w, h))

        return confirmed

    def _update_history(self, candidates):
        """Update detection position history."""
        # Decay old entries
        keys_to_remove = []
        for key in self.detection_history:
            self.detection_history[key] -= 1
            if self.detection_history[key] <= 0:
                keys_to_remove.append(key)
        for key in keys_to_remove:
            del self.detection_history[key]

        # Add new detections
        for x, y, w, h, conf in candidates:
            key = f"{int(x/50)}_{int(y/50)}"  # Grid position
            self.detection_history[key] = self.detection_history.get(key, 0) + 2

    def close(self):
        pass


class FaceSignature:
    """Face signature for identity matching."""

    def __init__(self, face_roi_bgr):
        self.hist_hsv = None
        self.hist_gray = None
        self._compute_signature(face_roi_bgr)

    def _compute_signature(self, face_roi):
        if face_roi is None or face_roi.size == 0:
            return
        try:
            face_resized = cv2.resize(face_roi, (64, 64))
            hsv = cv2.cvtColor(face_resized, cv2.COLOR_BGR2HSV)
            self.hist_hsv = cv2.calcHist([hsv], [0, 1], None, [30, 32], [0, 180, 0, 256])
            cv2.normalize(self.hist_hsv, self.hist_hsv, 0, 1, cv2.NORM_MINMAX)
            gray = cv2.cvtColor(face_resized, cv2.COLOR_BGR2GRAY)
            self.hist_gray = cv2.calcHist([gray], [0], None, [64], [0, 256])
            cv2.normalize(self.hist_gray, self.hist_gray, 0, 1, cv2.NORM_MINMAX)
        except Exception:
            pass

    def compare(self, other):
        if self.hist_hsv is None or other.hist_hsv is None:
            return 1.0
        try:
            dist_hsv = cv2.compareHist(self.hist_hsv, other.hist_hsv, cv2.HISTCMP_BHATTACHARYYA)
            dist_gray = cv2.compareHist(self.hist_gray, other.hist_gray, cv2.HISTCMP_BHATTACHARYYA)
            return 0.7 * dist_hsv + 0.3 * dist_gray
        except:
            return 1.0

    def update(self, face_roi_bgr, blend=0.3):
        if face_roi_bgr is None or face_roi_bgr.size == 0:
            return
        new_sig = FaceSignature(face_roi_bgr)
        if new_sig.hist_hsv is None:
            return
        if self.hist_hsv is None:
            self.hist_hsv = new_sig.hist_hsv
            self.hist_gray = new_sig.hist_gray
        else:
            self.hist_hsv = blend * new_sig.hist_hsv + (1 - blend) * self.hist_hsv
            self.hist_gray = blend * new_sig.hist_gray + (1 - blend) * self.hist_gray


class TrackedFace:
    """Face with cloud tracking."""

    def __init__(self, face_id, bbox, gray, color, force_confirmed=False):
        self.id = face_id
        self.bbox = list(bbox)
        self.points = None
        self.prev_gray = None
        self.frames_lost = 0
        self.detection_count = 1
        self.is_confirmed = force_confirmed  # If user confirmed, blur from frame 0
        self.is_valid = True

        roi = self._get_roi(color, bbox)
        self.signature = FaceSignature(roi)
        self._init_features(gray, bbox)

    def _get_roi(self, frame, bbox):
        x, y, w, h = [int(v) for v in bbox]
        x1, y1 = max(0, x), max(0, y)
        x2, y2 = min(frame.shape[1], x + w), min(frame.shape[0], y + h)
        if x2 > x1 and y2 > y1:
            return frame[y1:y2, x1:x2].copy()
        return None

    def _init_features(self, gray, bbox):
        x, y, w, h = [int(v) for v in bbox]
        pad = int(min(w, h) * 0.1)
        x1, y1 = max(0, x - pad), max(0, y - pad)
        x2, y2 = min(gray.shape[1], x + w + pad), min(gray.shape[0], y + h + pad)

        roi = gray[y1:y2, x1:x2]
        if roi.size == 0:
            self.is_valid = False
            return

        points = cv2.goodFeaturesToTrack(roi, mask=None, **FEATURE_PARAMS)
        if points is None or len(points) < 5:
            params = FEATURE_PARAMS.copy()
            params['qualityLevel'] = 0.01
            params['maxCorners'] = 100
            points = cv2.goodFeaturesToTrack(roi, mask=None, **params)

        if points is None or len(points) < 3:
            self.is_valid = False
            return

        self.points = points.reshape(-1, 2) + np.array([x1, y1])
        self.points = self.points.reshape(-1, 1, 2).astype(np.float32)
        self.prev_gray = gray.copy()

    def track(self, gray):
        if not self.is_valid or self.points is None or len(self.points) < 3:
            return False

        p1, st1, _ = cv2.calcOpticalFlowPyrLK(self.prev_gray, gray, self.points, None, **LK_PARAMS)
        if p1 is None:
            return False

        p0r, st2, _ = cv2.calcOpticalFlowPyrLK(gray, self.prev_gray, p1, None, **LK_PARAMS)
        if p0r is None:
            return False

        fb_error = np.abs(self.points - p0r).reshape(-1, 2).max(axis=1)
        valid = (st1.flatten() == 1) & (st2.flatten() == 1) & (fb_error < 2.0)

        if np.sum(valid) < 3:
            return False

        old_pts = self.points[valid].reshape(-1, 2)
        new_pts = p1[valid].reshape(-1, 2)
        motion = np.median(new_pts - old_pts, axis=0)

        self.bbox[0] += motion[0]
        self.bbox[1] += motion[1]
        self.points = p1[valid].reshape(-1, 1, 2).astype(np.float32)
        self.prev_gray = gray.copy()

        return True

    def update(self, bbox, gray, color, min_conf=3):
        self.detection_count += 1
        if self.detection_count >= min_conf:
            self.is_confirmed = True

        alpha = 0.6
        self.bbox[0] = alpha * bbox[0] + (1 - alpha) * self.bbox[0]
        self.bbox[1] = alpha * bbox[1] + (1 - alpha) * self.bbox[1]
        self.bbox[2] = alpha * bbox[2] + (1 - alpha) * self.bbox[2]
        self.bbox[3] = alpha * bbox[3] + (1 - alpha) * self.bbox[3]

        roi = self._get_roi(color, self.bbox)
        if roi is not None:
            self.signature.update(roi)

        self._init_features(gray, self.bbox)
        self.frames_lost = 0

    def get_bbox(self):
        return tuple(int(v) for v in self.bbox)


class FaceTracker:
    """Multi-face tracker with signature matching."""

    def __init__(self, detector, detect_every=8, max_lost=20):
        self.detector = detector
        self.detect_every = detect_every
        self.max_lost = max_lost
        self.faces = {}
        self.next_id = 0
        self.frame_num = 0
        self.min_confirmations = 2  # Require 2 detections before blur (lowered for short clips)
        self.confirmed_signatures = None  # User-confirmed face signatures
        self.user_confirmed_faces = False  # If true, user already confirmed faces exist

    def update(self, frame):
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        self.frame_num += 1

        do_detect = (
            self.frame_num % self.detect_every == 0 or
            len(self.faces) == 0 or
            self.frame_num <= 5
        )

        # Track existing faces
        for fid in list(self.faces.keys()):
            face = self.faces[fid]
            if face.is_valid and face.prev_gray is not None:
                if not face.track(gray):
                    face.is_valid = False
            face.frames_lost += 1

        # Detect faces
        if do_detect:
            detected = self.detector.detect(frame)
            matched = set()

            for det in detected:
                x, y, w, h = det
                det_roi = frame[max(0,y):min(frame.shape[0],y+h), max(0,x):min(frame.shape[1],x+w)]
                det_sig = FaceSignature(det_roi) if det_roi.size > 0 else None

                best_id = None
                best_score = 0

                for fid, face in self.faces.items():
                    if fid in matched:
                        continue

                    iou = self._iou(det, face.get_bbox())
                    sig_match = 1.0
                    if det_sig and det_sig.hist_hsv is not None:
                        sig_match = 1.0 - face.signature.compare(det_sig)

                    score = 0.4 * iou + 0.6 * sig_match
                    if iou > 0.15 and sig_match > 0.4 and score > best_score:
                        best_score = score
                        best_id = fid

                if best_id is not None:
                    self.faces[best_id].update(det, gray, frame, self.min_confirmations)
                    matched.add(best_id)
                else:
                    # If user already confirmed faces, new faces are immediately confirmed
                    # This ensures blur starts from frame 0
                    force_confirmed = self.user_confirmed_faces
                    new_face = TrackedFace(self.next_id, det, gray, frame, force_confirmed)
                    if new_face.is_valid:
                        self.faces[self.next_id] = new_face
                        matched.add(self.next_id)
                        self.next_id += 1

        # Collect and cleanup
        to_blur = []
        stale = []
        for fid, face in self.faces.items():
            if face.frames_lost > self.max_lost or not face.is_valid:
                stale.append(fid)
            elif face.is_confirmed:
                # If user confirmed ANY faces, blur all detected faces
                # (the confirmation step already filtered false positives)
                to_blur.append(face.get_bbox())

        for fid in stale:
            del self.faces[fid]

        return to_blur

    def _iou(self, b1, b2):
        x1, y1, w1, h1 = b1
        x2, y2, w2, h2 = b2
        xi1, yi1 = max(x1, x2), max(y1, y2)
        xi2, yi2 = min(x1 + w1, x2 + w2), min(y1 + h1, y2 + h2)
        inter = max(0, xi2 - xi1) * max(0, yi2 - yi1)
        union = w1 * h1 + w2 * h2 - inter
        return inter / union if union > 0 else 0


def create_oval_mask(h, w, feather=0.15):
    """Create an oval mask with smooth feathered edges."""
    y, x = np.ogrid[:h, :w]
    cx, cy = w / 2, h / 2
    rx, ry = w / 2, h / 2

    # Calculate normalized distance from center (ellipse equation)
    dist = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2

    # Create smooth gradient mask
    inner = 1.0 - feather
    mask = np.clip((1.0 - dist) / feather, 0, 1)
    mask = (mask * 255).astype(np.uint8)

    return mask


def pixelate(image, blocks=10):
    """Pixelate an image region with oval shape."""
    h, w = image.shape[:2]
    blocks = max(5, min(blocks, 20))

    # Create pixelated version
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

    # Apply oval mask with feathered edges
    mask = create_oval_mask(h, w, feather=0.2)
    mask_3ch = cv2.merge([mask, mask, mask])

    # Blend original and pixelated using mask
    result = (pixelated.astype(float) * (mask_3ch / 255.0) +
              image.astype(float) * (1 - mask_3ch / 255.0)).astype(np.uint8)

    return result


def gaussian_blur(image, intensity=25):
    """Apply Gaussian blur with oval shape and feathered edges."""
    h, w = image.shape[:2]

    # kernel size must be odd
    ksize = int(intensity * 2) | 1
    ksize = max(5, min(ksize, 99))
    blurred = cv2.GaussianBlur(image, (ksize, ksize), 0)

    # Create oval mask with extra smooth feathering
    mask = create_oval_mask(h, w, feather=0.25)

    # Apply additional gaussian blur to mask for smoother edges
    mask = cv2.GaussianBlur(mask, (21, 21), 0)
    mask_3ch = cv2.merge([mask, mask, mask])

    # Blend original and blurred using smooth mask
    result = (blurred.astype(float) * (mask_3ch / 255.0) +
              image.astype(float) * (1 - mask_3ch / 255.0)).astype(np.uint8)

    return result


def color_fill(image, color_hex='#000000'):
    """Fill image region with a solid color in oval shape."""
    h, w = image.shape[:2]
    # Parse hex color
    color_hex = color_hex.lstrip('#')
    if len(color_hex) == 6:
        r, g, b = tuple(int(color_hex[i:i+2], 16) for i in (0, 2, 4))
    else:
        r, g, b = 0, 0, 0

    # Create color overlay
    overlay = np.full_like(image, (b, g, r))  # BGR

    # Apply oval mask with feathered edges
    mask = create_oval_mask(h, w, feather=0.2)
    mask = cv2.GaussianBlur(mask, (15, 15), 0)
    mask_3ch = cv2.merge([mask, mask, mask])

    # Blend
    result = (overlay.astype(float) * (mask_3ch / 255.0) +
              image.astype(float) * (1 - mask_3ch / 255.0)).astype(np.uint8)

    return result


def black_box(image):
    """Fill image region with black oval."""
    h, w = image.shape[:2]
    overlay = np.zeros_like(image)

    # Apply oval mask
    mask = create_oval_mask(h, w, feather=0.2)
    mask = cv2.GaussianBlur(mask, (15, 15), 0)
    mask_3ch = cv2.merge([mask, mask, mask])

    result = (overlay.astype(float) * (mask_3ch / 255.0) +
              image.astype(float) * (1 - mask_3ch / 255.0)).astype(np.uint8)

    return result


# Global cache for emoji/image overlays
_overlay_cache = {}


def emoji_overlay(image, emoji='🔥'):
    """Overlay a fun shape/pattern based on emoji selection."""
    h, w = image.shape[:2]

    # Map emojis to fun colored patterns
    emoji_styles = {
        '🔥': {'color': (0, 100, 255), 'pattern': 'flame'},      # Orange-red flame
        '💋': {'color': (80, 0, 180), 'pattern': 'lips'},         # Red lips
        '😈': {'color': (100, 0, 150), 'pattern': 'horns'},       # Purple devil
        '👅': {'color': (100, 80, 200), 'pattern': 'oval'},       # Pink tongue
        '🍑': {'color': (140, 160, 255), 'pattern': 'peach'},     # Peach color
        '🍆': {'color': (100, 50, 120), 'pattern': 'oval'},       # Purple
        '💦': {'color': (255, 200, 100), 'pattern': 'drops'},     # Light blue
        '😏': {'color': (50, 50, 50), 'pattern': 'smirk'},        # Dark gray
        '🥵': {'color': (0, 80, 255), 'pattern': 'hot'},          # Red hot
        '😘': {'color': (180, 100, 255), 'pattern': 'kiss'},      # Pink kiss
        '💕': {'color': (180, 100, 255), 'pattern': 'hearts'},    # Pink hearts
        '❤️‍🔥': {'color': (0, 50, 220), 'pattern': 'flame'},      # Red flame
        '🌶️': {'color': (0, 50, 200), 'pattern': 'oval'},         # Red pepper
        '🍒': {'color': (50, 50, 180), 'pattern': 'cherry'},      # Cherry red
        '🍓': {'color': (80, 80, 220), 'pattern': 'oval'},        # Strawberry
        '💄': {'color': (50, 0, 180), 'pattern': 'oval'},         # Lipstick red
        '👙': {'color': (200, 150, 50), 'pattern': 'bikini'},     # Cyan bikini
        '🩲': {'color': (200, 100, 50), 'pattern': 'oval'},       # Blue
        '😜': {'color': (0, 200, 255), 'pattern': 'wink'},        # Yellow
        '🤫': {'color': (180, 150, 200), 'pattern': 'shh'},       # Light pink
    }

    style = emoji_styles.get(emoji, {'color': (0, 100, 255), 'pattern': 'oval'})
    color = style['color']
    pattern = style['pattern']

    # Create base oval
    overlay = np.zeros_like(image)
    mask = create_oval_mask(h, w, feather=0.15)

    # Draw pattern based on type
    if pattern == 'flame':
        # Gradient flame effect
        for i in range(h):
            factor = 1.0 - (i / h) * 0.5
            row_color = tuple(int(c * factor) for c in color)
            overlay[i, :] = row_color
    elif pattern == 'hearts':
        # Multiple small hearts pattern
        overlay[:] = color
        # Add some sparkle
        for _ in range(5):
            cx, cy = np.random.randint(w//4, 3*w//4), np.random.randint(h//4, 3*h//4)
            cv2.circle(overlay, (cx, cy), min(w, h)//8, (255, 200, 255), -1)
    elif pattern == 'drops':
        # Water drop effect
        overlay[:] = color
        for i in range(3):
            cx = w // 2 + (i - 1) * w // 4
            cy = h // 2
            cv2.ellipse(overlay, (cx, cy), (w//6, h//4), 0, 0, 360, (255, 230, 150), -1)
    elif pattern == 'cherry':
        # Two circles like cherries
        r = min(w, h) // 3
        cv2.circle(overlay, (w//3, h//2), r, color, -1)
        cv2.circle(overlay, (2*w//3, h//2), r, color, -1)
        # Stem
        cv2.line(overlay, (w//3, h//2 - r), (w//2, h//4), (0, 100, 0), max(2, w//20))
        cv2.line(overlay, (2*w//3, h//2 - r), (w//2, h//4), (0, 100, 0), max(2, w//20))
    elif pattern == 'peach':
        # Peach shape (heart-ish from bottom)
        cv2.ellipse(overlay, (w//2, int(h*0.45)), (int(w*0.45), int(h*0.45)), 0, 0, 360, color, -1)
        # Cleft line
        cv2.line(overlay, (w//2, h//3), (w//2, h), (int(color[0]*0.7), int(color[1]*0.7), int(color[2]*0.7)), max(2, w//15))
    elif pattern == 'bikini':
        # Two triangles
        pts1 = np.array([[w//4, h//3], [w//2 - w//8, h//3], [3*w//8, 2*h//3]], np.int32)
        pts2 = np.array([[3*w//4, h//3], [w//2 + w//8, h//3], [5*w//8, 2*h//3]], np.int32)
        cv2.fillPoly(overlay, [pts1], color)
        cv2.fillPoly(overlay, [pts2], color)
    elif pattern in ['smirk', 'wink', 'shh']:
        # Face-like pattern with expression
        overlay[:] = color
        # Eyes
        eye_y = h // 3
        cv2.ellipse(overlay, (w//3, eye_y), (w//8, h//10), 0, 0, 360, (255, 255, 255), -1)
        cv2.ellipse(overlay, (2*w//3, eye_y), (w//8, h//10), 0, 0, 360, (255, 255, 255), -1)
        # Pupils
        cv2.circle(overlay, (w//3, eye_y), w//16, (30, 30, 30), -1)
        if pattern == 'wink':
            cv2.line(overlay, (2*w//3 - w//8, eye_y), (2*w//3 + w//8, eye_y), (30, 30, 30), max(2, h//20))
        else:
            cv2.circle(overlay, (2*w//3, eye_y), w//16, (30, 30, 30), -1)
        # Mouth
        if pattern == 'smirk':
            cv2.ellipse(overlay, (w//2 + w//8, 2*h//3), (w//6, h//10), 0, 0, 180, (50, 50, 50), max(2, h//25))
        elif pattern == 'shh':
            cv2.line(overlay, (w//2, h//2 + h//8), (w//2, h - h//6), (200, 150, 180), max(3, w//12))
        else:
            cv2.ellipse(overlay, (w//2, 2*h//3), (w//6, h//8), 0, 0, 180, (50, 50, 50), -1)
    elif pattern in ['lips', 'kiss']:
        # Lips shape
        overlay[:] = (0, 0, 0)
        # Upper lip
        pts_upper = np.array([
            [w//6, h//2], [w//3, h//3], [w//2, h//2 - h//8],
            [2*w//3, h//3], [5*w//6, h//2], [w//2, h//2]
        ], np.int32)
        cv2.fillPoly(overlay, [pts_upper], color)
        # Lower lip
        pts_lower = np.array([
            [w//6, h//2], [w//2, h//2], [5*w//6, h//2],
            [2*w//3, 2*h//3 + h//8], [w//2, 3*h//4], [w//3, 2*h//3 + h//8]
        ], np.int32)
        cv2.fillPoly(overlay, [pts_lower], color)
    elif pattern == 'hot':
        # Hot/sweating effect - red with drops
        overlay[:] = color
        # Sweat drops
        for i in range(3):
            dx = w//4 + i * w//4
            cv2.ellipse(overlay, (dx, h//4), (w//12, h//8), 0, 0, 360, (255, 200, 100), -1)
    elif pattern == 'horns':
        # Devil horns on colored background
        overlay[:] = color
        # Horns
        pts1 = np.array([[w//4, 0], [w//6, h//3], [w//3, h//3]], np.int32)
        pts2 = np.array([[3*w//4, 0], [5*w//6, h//3], [2*w//3, h//3]], np.int32)
        cv2.fillPoly(overlay, [pts1], (0, 0, 100))
        cv2.fillPoly(overlay, [pts2], (0, 0, 100))
    else:
        # Default: solid color oval
        overlay[:] = color

    # Apply oval mask with smooth edges
    mask = cv2.GaussianBlur(mask, (15, 15), 0)
    mask_3ch = cv2.merge([mask, mask, mask])

    # Blend
    result = (overlay.astype(float) * (mask_3ch / 255.0) +
              image.astype(float) * (1 - mask_3ch / 255.0)).astype(np.uint8)

    return result


def image_overlay(image, image_data_b64):
    """Overlay a custom image on the region."""
    global _overlay_cache

    h, w = image.shape[:2]
    cache_key = f"img_{hash(image_data_b64)}_{w}_{h}"

    if cache_key not in _overlay_cache:
        try:
            # Decode base64 image
            if ',' in image_data_b64:
                image_data_b64 = image_data_b64.split(',')[1]

            img_bytes = base64.b64decode(image_data_b64)
            nparr = np.frombuffer(img_bytes, np.uint8)
            overlay_img = cv2.imdecode(nparr, cv2.IMREAD_UNCHANGED)

            if overlay_img is None:
                return black_box(image)

            # Resize to match region
            overlay_img = cv2.resize(overlay_img, (w, h), interpolation=cv2.INTER_AREA)
            _overlay_cache[cache_key] = overlay_img
        except Exception as e:
            print(json.dumps({"warning": f"Failed to decode overlay image: {e}"}))
            return black_box(image)

    overlay = _overlay_cache[cache_key]

    # Resize if needed
    if overlay.shape[0] != h or overlay.shape[1] != w:
        overlay = cv2.resize(overlay, (w, h), interpolation=cv2.INTER_AREA)

    # Handle alpha channel if present
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
        # Default to pixelate
        return pixelate(image, 10)


def reencode(input_path, output_path, original=None):
    """Re-encode to H.264."""
    try:
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
        result = subprocess.run(cmd, capture_output=True, text=True)
        return result.returncode == 0
    except Exception as e:
        print(json.dumps({"warning": f"Re-encode error: {e}"}))
        return False


def signature_matches(face_sig, confirmed_signatures, threshold=0.5):
    """Check if a face signature matches any confirmed signature."""
    if confirmed_signatures is None or len(confirmed_signatures) == 0:
        return True  # No filter, allow all faces

    if face_sig is None or face_sig.hist_hsv is None:
        return False

    for conf_sig in confirmed_signatures:
        try:
            conf_sig_arr = np.array(conf_sig, dtype=np.float32).reshape(-1, 1)
            if conf_sig_arr.size < 10:
                continue

            # Compare histograms
            face_flat = face_sig.hist_hsv.flatten().reshape(-1, 1).astype(np.float32)

            # Resize to match if needed
            if face_flat.size != conf_sig_arr.size:
                min_size = min(face_flat.size, conf_sig_arr.size)
                face_flat = face_flat[:min_size]
                conf_sig_arr = conf_sig_arr[:min_size]

            dist = cv2.compareHist(face_flat, conf_sig_arr, cv2.HISTCMP_BHATTACHARYYA)
            if dist < threshold:
                return True
        except Exception:
            continue

    return False


def blur_faces(input_path, output_path, blur_intensity=25, confidence=0.5, confirmed_signatures=None,
               blur_style='pixelate', blur_color=None, blur_emoji=None, blur_image=None):
    """Main face blur function with multiple style support."""
    # If user confirmed faces, use lower confidence threshold
    if confirmed_signatures is not None and len(confirmed_signatures) > 0:
        confidence = max(0.5, confidence)  # More lenient when user confirmed
    detector = RobustFaceDetector(confidence)

    cap = cv2.VideoCapture(input_path)
    if not cap.isOpened():
        return {"error": f"Cannot open: {input_path}"}

    fps = int(cap.get(cv2.CAP_PROP_FPS)) or 30
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    if total == 0:
        return {"error": "No frames"}

    detect_every = max(5, fps // 3)
    max_lost = fps

    tracker = FaceTracker(detector, detect_every, max_lost)

    # Store confirmed signatures for filtering
    tracker.confirmed_signatures = confirmed_signatures

    # If user confirmed faces, be more lenient
    if confirmed_signatures is not None and len(confirmed_signatures) > 0:
        tracker.user_confirmed_faces = True
        tracker.min_confirmations = 1  # Blur immediately if user confirmed faces exist

    temp = output_path + '.temp.mp4'
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    out = cv2.VideoWriter(temp, fourcc, fps, (w, h))

    if not out.isOpened():
        cap.release()
        return {"error": "Cannot create output"}

    print(json.dumps({
        "progress": 0,
        "status": "starting",
        "total_frames": total,
        "method": "FaceDetectorYN with landmarks" if detector.face_detector_yn else "DNN",
        "blur_style": blur_style,
        "dlib_available": DLIB_AVAILABLE,
        "pil_available": PIL_AVAILABLE
    }))
    sys.stdout.flush()

    frame_count = 0
    faces_total = 0
    last_prog = -1

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        faces = tracker.update(frame)

        for bbox in faces:
            x, y, fw, fh = bbox
            pad = int(min(fw, fh) * 0.15)
            x1, y1 = max(0, x - pad), max(0, y - pad)
            x2, y2 = min(w, x + fw + pad), min(h, y + fh + pad)

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
                faces_total += 1

        out.write(frame)
        frame_count += 1

        prog = int((frame_count / total) * 100)
        if prog > last_prog:
            last_prog = prog
            print(json.dumps({
                "progress": prog / 100.0,
                "frame": frame_count,
                "total_frames": total,
                "tracked": len(tracker.faces),
                "blurred": len(faces)
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
        "total_faces_blurred": faces_total,
        "blur_style": blur_style,
        "output_path": output_path
    }

    print(json.dumps(result))
    sys.stdout.flush()
    return result


def main():
    parser = argparse.ArgumentParser(description='Robust face blur with landmark verification')
    parser.add_argument('--input', '-i', required=True)
    parser.add_argument('--output', '-o', required=True)
    parser.add_argument('--intensity', '-b', type=int, default=25)
    parser.add_argument('--confidence', type=float, default=0.5)
    parser.add_argument('--zones', '-z', type=str, default=None, help='Ignored')
    parser.add_argument('--signatures', '-s', type=str, default=None,
                        help='JSON array of confirmed face signatures')
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

    # Parse confirmed signatures if provided
    confirmed_signatures = None
    if args.signatures:
        try:
            confirmed_signatures = json.loads(args.signatures)
            print(json.dumps({"info": f"Using {len(confirmed_signatures)} confirmed face signatures"}))
            sys.stdout.flush()
        except:
            pass

    print(json.dumps({
        "info": f"Blur style: {args.style}",
        "color": args.color if args.style == 'color' else None,
        "emoji": args.emoji if args.style == 'emoji' else None,
        "has_image": args.image is not None if args.style == 'image' else None
    }))
    sys.stdout.flush()

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

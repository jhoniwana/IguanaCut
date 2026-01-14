#!/usr/bin/env python3
"""
Face Detection Preview Script

Scans a video and extracts thumbnails of detected faces for user confirmation.
Returns JSON with face IDs and base64-encoded thumbnails.
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


class FaceDetector:
    """Face detector using YuNet or DNN fallback."""

    def __init__(self, confidence=0.7):
        self.confidence = confidence
        self.face_detector_yn = None
        self.net = None
        self._init_detector()

    def _init_detector(self):
        model_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")
        os.makedirs(model_dir, exist_ok=True)

        # Try YuNet first
        yn_model_path = os.path.join(model_dir, "face_detection_yunet_2023mar.onnx")

        if not os.path.exists(yn_model_path):
            YN_URL = "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx"
            try:
                import urllib.request
                urllib.request.urlretrieve(YN_URL, yn_model_path)
            except:
                pass

        if os.path.exists(yn_model_path):
            try:
                self.face_detector_yn = cv2.FaceDetectorYN.create(
                    yn_model_path, "", (320, 320),
                    score_threshold=self.confidence,
                    nms_threshold=0.3, top_k=10
                )
                return
            except:
                pass

        # Fallback to DNN
        self._init_dnn(model_dir)

    def _init_dnn(self, model_dir):
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

    def detect(self, frame):
        """Detect faces and return list of (x, y, w, h, confidence)."""
        h, w = frame.shape[:2]

        if self.face_detector_yn is not None:
            self.face_detector_yn.setInputSize((w, h))
            _, faces = self.face_detector_yn.detect(frame)

            if faces is None:
                return []

            results = []
            for face in faces:
                x, y, fw, fh = int(face[0]), int(face[1]), int(face[2]), int(face[3])
                conf = face[14]

                # Validate landmarks if using YuNet
                if self._validate_landmarks(face, x, y, fw, fh):
                    results.append((x, y, fw, fh, float(conf)))

            return results
        else:
            # DNN fallback
            blob = cv2.dnn.blobFromImage(cv2.resize(frame, (300, 300)), 1.0, (300, 300), (104.0, 177.0, 123.0))
            self.net.setInput(blob)
            detections = self.net.forward()

            results = []
            for i in range(detections.shape[2]):
                conf = detections[0, 0, i, 2]
                if conf > self.confidence:
                    box = detections[0, 0, i, 3:7] * np.array([w, h, w, h])
                    x1, y1, x2, y2 = box.astype(int)
                    results.append((x1, y1, x2 - x1, y2 - y1, float(conf)))

            return results

    def _validate_landmarks(self, face, x, y, w, h):
        """Validate face geometry using landmarks."""
        try:
            re = (face[4], face[5])  # right eye
            le = (face[6], face[7])  # left eye
            nose = (face[8], face[9])
            mr = (face[10], face[11])  # mouth right
            ml = (face[12], face[13])  # mouth left

            # Eyes above nose
            eye_y = (re[1] + le[1]) / 2
            if eye_y >= nose[1]:
                return False

            # Nose above mouth
            mouth_y = (mr[1] + ml[1]) / 2
            if nose[1] >= mouth_y:
                return False

            # Eyes roughly on same level
            if abs(re[1] - le[1]) > h * 0.3:
                return False

            return True
        except:
            return True


def compute_face_signature(face_roi):
    """Compute a simple signature for face matching."""
    try:
        resized = cv2.resize(face_roi, (32, 32))
        hsv = cv2.cvtColor(resized, cv2.COLOR_BGR2HSV)
        hist = cv2.calcHist([hsv], [0, 1], None, [8, 8], [0, 180, 0, 256])
        cv2.normalize(hist, hist, 0, 1, cv2.NORM_MINMAX)
        return hist.flatten().tolist()
    except:
        return None


def are_similar_faces(sig1, sig2, threshold=0.6):
    """Check if two face signatures are similar."""
    if sig1 is None or sig2 is None:
        return False
    try:
        sig1 = np.array(sig1)
        sig2 = np.array(sig2)
        dist = cv2.compareHist(
            sig1.reshape(-1, 1).astype(np.float32),
            sig2.reshape(-1, 1).astype(np.float32),
            cv2.HISTCMP_BHATTACHARYYA
        )
        return dist < threshold
    except:
        return False


def detect_faces_in_video(video_path, sample_interval=1.0, max_faces=20):
    """
    Detect faces in video and return unique face thumbnails.

    Args:
        video_path: Path to video file
        sample_interval: Seconds between frame samples
        max_faces: Maximum number of unique faces to return

    Returns:
        List of face info dicts with id, thumbnail (base64), timestamp, bbox
    """
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return {"error": f"Cannot open video: {video_path}"}

    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = total_frames / fps

    detector = FaceDetector(confidence=0.6)

    # Store unique faces
    unique_faces = []  # List of {id, thumbnail, signature, timestamp, bbox, count}

    frame_interval = int(fps * sample_interval)
    frame_num = 0

    print(json.dumps({"status": "scanning", "duration": duration}))
    sys.stdout.flush()

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        # Only process at intervals
        if frame_num % frame_interval == 0:
            timestamp = frame_num / fps
            faces = detector.detect(frame)

            for x, y, w, h, conf in faces:
                # Validate size
                if w < 40 or h < 40:
                    continue

                # Extract face ROI with padding
                pad = int(min(w, h) * 0.2)
                x1 = max(0, x - pad)
                y1 = max(0, y - pad)
                x2 = min(frame.shape[1], x + w + pad)
                y2 = min(frame.shape[0], y + h + pad)

                face_roi = frame[y1:y2, x1:x2]
                if face_roi.size == 0:
                    continue

                # Compute signature
                signature = compute_face_signature(face_roi)

                # Check if this face is similar to any existing
                matched = False
                for uf in unique_faces:
                    if are_similar_faces(signature, uf['signature']):
                        uf['count'] += 1
                        # Update to better quality if this one is larger
                        if w * h > uf['bbox'][2] * uf['bbox'][3]:
                            uf['thumbnail'] = face_roi.copy()
                            uf['bbox'] = [x, y, w, h]
                            uf['timestamp'] = timestamp
                            uf['signature'] = signature
                        matched = True
                        break

                if not matched and len(unique_faces) < max_faces:
                    face_id = f"face_{len(unique_faces)}"
                    unique_faces.append({
                        'id': face_id,
                        'thumbnail': face_roi.copy(),
                        'signature': signature,
                        'timestamp': timestamp,
                        'bbox': [x, y, w, h],
                        'count': 1
                    })

            # Progress update
            progress = frame_num / total_frames
            if int(progress * 20) > int((frame_num - frame_interval) / total_frames * 20):
                print(json.dumps({"progress": progress, "faces_found": len(unique_faces)}))
                sys.stdout.flush()

        frame_num += 1

    cap.release()

    # Filter faces that appear only once (likely false positives)
    confirmed_faces = [f for f in unique_faces if f['count'] >= 2]

    # Convert thumbnails to base64
    results = []
    for face in confirmed_faces:
        thumbnail = face['thumbnail']

        # Resize thumbnail to reasonable size
        max_size = 120
        h, w = thumbnail.shape[:2]
        if max(h, w) > max_size:
            scale = max_size / max(h, w)
            thumbnail = cv2.resize(thumbnail, (int(w * scale), int(h * scale)))

        # Encode to base64
        _, buffer = cv2.imencode('.jpg', thumbnail, [cv2.IMWRITE_JPEG_QUALITY, 85])
        b64_thumbnail = base64.b64encode(buffer).decode('utf-8')

        results.append({
            'id': face['id'],
            'thumbnail': b64_thumbnail,
            'timestamp': face['timestamp'],
            'bbox': face['bbox'],
            'signature': face['signature'],
            'appearances': face['count']
        })

    return {
        "status": "completed",
        "faces": results,
        "total_scanned_frames": frame_num,
        "duration": duration
    }


def main():
    parser = argparse.ArgumentParser(description='Detect faces in video for preview')
    parser.add_argument('--input', '-i', required=True, help='Input video path')
    parser.add_argument('--interval', '-t', type=float, default=0.5, help='Sample interval in seconds')
    parser.add_argument('--max-faces', '-m', type=int, default=20, help='Maximum unique faces to detect')

    args = parser.parse_args()

    if not os.path.exists(args.input):
        print(json.dumps({"error": f"Input file not found: {args.input}"}))
        sys.exit(1)

    result = detect_faces_in_video(args.input, args.interval, args.max_faces)

    print(json.dumps(result))
    sys.exit(0 if "error" not in result else 1)


if __name__ == '__main__':
    main()

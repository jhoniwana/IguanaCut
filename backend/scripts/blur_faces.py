#!/usr/bin/env python3
"""
Face Detection and Blur Script for LosslessCut Web

This script detects faces in a video and applies blur to them.
It uses OpenCV's Haar Cascade classifier for face detection.

Usage:
    python blur_faces.py --input video.mp4 --output blurred.mp4 --intensity 25

Requirements:
    pip install opencv-python-headless numpy
"""

import argparse
import json
import sys
import os

try:
    import cv2
    import numpy as np
except ImportError:
    print(json.dumps({"error": "OpenCV not installed. Run: pip install opencv-python-headless numpy"}))
    sys.exit(1)


def blur_faces(input_path: str, output_path: str, blur_intensity: int = 25,
               scale_factor: float = 1.1, min_neighbors: int = 5,
               min_face_size: int = 30) -> dict:
    """
    Detect and blur faces in a video file.

    Args:
        input_path: Path to input video
        output_path: Path to output video
        blur_intensity: Blur kernel size (10-50)
        scale_factor: How much the image size is reduced at each scale
        min_neighbors: How many neighbors each candidate rectangle should have
        min_face_size: Minimum face size to detect (pixels)

    Returns:
        dict with status and statistics
    """

    # Validate blur intensity
    blur_intensity = max(10, min(50, blur_intensity))
    # Make sure it's odd for GaussianBlur
    if blur_intensity % 2 == 0:
        blur_intensity += 1

    # Load face cascade
    cascade_path = cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'
    if not os.path.exists(cascade_path):
        return {"error": f"Haar cascade not found at {cascade_path}"}

    face_cascade = cv2.CascadeClassifier(cascade_path)
    if face_cascade.empty():
        return {"error": "Failed to load face cascade classifier"}

    # Open input video
    cap = cv2.VideoCapture(input_path)
    if not cap.isOpened():
        return {"error": f"Cannot open video: {input_path}"}

    # Get video properties
    fps = int(cap.get(cv2.CAP_PROP_FPS))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    if total_frames == 0:
        return {"error": "Video has no frames"}

    # Create video writer
    # Use mp4v codec for compatibility
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    out = cv2.VideoWriter(output_path, fourcc, fps, (width, height))

    if not out.isOpened():
        cap.release()
        return {"error": f"Cannot create output video: {output_path}"}

    # Process frames
    frame_count = 0
    faces_detected_total = 0
    frames_with_faces = 0

    # Report initial progress
    print(json.dumps({"progress": 0, "status": "starting", "total_frames": total_frames}))
    sys.stdout.flush()

    last_progress = -1

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        # Convert to grayscale for face detection
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

        # Detect faces
        faces = face_cascade.detectMultiScale(
            gray,
            scaleFactor=scale_factor,
            minNeighbors=min_neighbors,
            minSize=(min_face_size, min_face_size)
        )

        # Apply blur to each detected face
        if len(faces) > 0:
            faces_detected_total += len(faces)
            frames_with_faces += 1

            for (x, y, w, h) in faces:
                # Add padding around face
                padding = int(w * 0.2)
                x1 = max(0, x - padding)
                y1 = max(0, y - padding)
                x2 = min(width, x + w + padding)
                y2 = min(height, y + h + padding)

                # Extract face region
                face_region = frame[y1:y2, x1:x2]

                # Apply Gaussian blur
                blurred_face = cv2.GaussianBlur(face_region, (blur_intensity, blur_intensity), 0)

                # Replace face region with blurred version
                frame[y1:y2, x1:x2] = blurred_face

        # Write frame
        out.write(frame)
        frame_count += 1

        # Report progress every 1%
        progress = int((frame_count / total_frames) * 100)
        if progress > last_progress:
            last_progress = progress
            print(json.dumps({
                "progress": progress / 100.0,
                "frame": frame_count,
                "total_frames": total_frames,
                "faces_in_frame": len(faces)
            }))
            sys.stdout.flush()

    # Release resources
    cap.release()
    out.release()

    # Final report
    result = {
        "status": "completed",
        "progress": 1.0,
        "frames_processed": frame_count,
        "frames_with_faces": frames_with_faces,
        "total_faces_detected": faces_detected_total,
        "output_path": output_path
    }

    print(json.dumps(result))
    sys.stdout.flush()

    return result


def main():
    parser = argparse.ArgumentParser(description='Detect and blur faces in video')
    parser.add_argument('--input', '-i', required=True, help='Input video path')
    parser.add_argument('--output', '-o', required=True, help='Output video path')
    parser.add_argument('--intensity', '-b', type=int, default=25,
                        help='Blur intensity (10-50, default: 25)')
    parser.add_argument('--scale-factor', type=float, default=1.1,
                        help='Face detection scale factor (default: 1.1)')
    parser.add_argument('--min-neighbors', type=int, default=5,
                        help='Face detection min neighbors (default: 5)')
    parser.add_argument('--min-face-size', type=int, default=30,
                        help='Minimum face size in pixels (default: 30)')

    args = parser.parse_args()

    # Validate input file
    if not os.path.exists(args.input):
        print(json.dumps({"error": f"Input file not found: {args.input}"}))
        sys.exit(1)

    # Run face blur
    result = blur_faces(
        input_path=args.input,
        output_path=args.output,
        blur_intensity=args.intensity,
        scale_factor=args.scale_factor,
        min_neighbors=args.min_neighbors,
        min_face_size=args.min_face_size
    )

    if "error" in result:
        sys.exit(1)

    sys.exit(0)


if __name__ == '__main__':
    main()

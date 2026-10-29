@echo off
cd /d %~dp0
start "EasyOCR (plates)" cmd /k "cd ALPR-Modules && python easyocr_service.py"
start "Slot monitor (YOLO)" cmd /k "cd ALPR-Modules && set YOLO_MODEL=yolov8s.pt&& set YOLO_CONF=0.10&& set YOLO_IMGSZ=960&& set YOLO_OVERLAP=0.5&& python slot_monitor_service.py"
start "PLPark app" cmd /k "npm run dev"
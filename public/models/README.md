# License plate detector

The supplied ALPR detector has been exported and installed at:

`public/models/license_plate_detector.onnx`

The browser pipeline expects a YOLO single-class export with output shaped as
`[1, 5, N]`, containing `center_x`, `center_y`, `width`, `height`, and
`confidence` values in 640x640 model coordinates.

The existing `yolov8n.onnx` file remains the vehicle detector. The dedicated
ALPR model is used to find plate boxes, and the browser OCR reads only those
boxes. The ALPR module's common 7-character format correction is applied after
OCR to fix common letter/digit confusions.

For production accuracy, train or export a plate-specific YOLO model using
images from the actual entrance and exit cameras. Keep the camera angle,
lighting, plate format, and distance represented in the training set.
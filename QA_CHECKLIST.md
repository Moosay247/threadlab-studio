# Ghost360 v0.20 QA checklist

## Showcase motion
- [x] Automatic preview starts on front -45�.
- [x] Front showcase reaches exactly +45� and returns to -45�.
- [x] Flip from front to back spans exactly 180�.
- [x] Rear showcase runs from 135� to 225� (rear �45�) and returns to 135�.
- [x] Return flip ends at 315�, visually identical to the starting -45� frame.
- [x] Motion uses eased transitions plus short endpoint holds.
- [x] Live preview and exported video use the same `showcaseAngleAt()` motion function.
- [x] Changing showcase duration restarts the preview cleanly.
- [x] Pause/resume labels use showcase wording rather than 360� wording.

## 8K export
- [x] Export resolution is exactly 7680 x 4320.
- [x] Export aspect ratio is fixed to 16:9.
- [x] Export requests 30 fps.
- [x] VP9 is preferred; VP8/WebM remains a browser compatibility fallback.
- [x] Recorder bitrate target is 100 Mbps.
- [x] Renderer pixel ratio is forced to 1 during 8K export to avoid accidental 16K backing buffers on HiDPI displays.
- [x] GPU MAX_RENDERBUFFER_SIZE and MAX_VIEWPORT_DIMS are checked before recording.
- [x] Unsupported hardware is reported instead of silently labeling a lower-resolution export as 8K.
- [x] Interactive renderer pixel ratio, dimensions, camera aspect and motion state are restored after export.
- [x] Export filename identifies the file as an 8K front/back showcase.

## Image / texture quality
- [x] Source preprocessing no longer downsizes images to 1400 px; usable source is preserved up to 4096 px.
- [x] Registered front/back garment textures use 4096 x 4096 canvases.
- [x] Dedicated side textures use 1024 x 4096 canvases.
- [x] Texture anisotropy is raised up to 16x where supported.
- [x] Linear mipmapped minification and linear magnification filters are explicitly enabled.
- [x] Shadow map resolution increased to 4096 x 4096.

## Workflow
- [x] Upload/analysis-first workflow remains intact.
- [x] Continue generation stays blocked until required source views are resolved.
- [x] Duplicate/missing pants-back analysis remains available.
- [x] Generation completion resets the showcase clock to the front -45� start.
- [x] 8K export remains disabled before successful 3D generation.

## Static validation
- [x] JavaScript passes `node --check`.
- [x] Every `$('<id>')` JavaScript UI reference exists in HTML.
- [x] HTML contains no duplicate IDs.
- [x] Package version updated to 0.20.0.
- [x] User-facing version label updated to MVP 0.20.


/** Classic worker deliberately: the pinned MediaPipe WASM loader uses
 * importScripts and a global ModuleFactory. A module worker is not equivalent.
 * Only in-memory ImageBitmaps cross this local worker boundary; no uploads.
 */
const CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
let landmarker = null;
let loading = false;

self.onmessage = async ({data}) => {
  if (data.type === 'init') {
    if (loading || landmarker) return;
    loading = true;
    try {
      importScripts(`${CDN}/vision_bundle.js`);
      const {FaceLandmarker, FilesetResolver} = self.vision;
      const files = await FilesetResolver.forVisionTasks(`${CDN}/wasm`);
      const options = {
        baseOptions: {modelAssetPath: MODEL, delegate: 'GPU'},
        runningMode: 'VIDEO', numFaces: 2, outputFaceBlendshapes: true,
        minFaceDetectionConfidence: .6, minFacePresenceConfidence: .6,
        minTrackingConfidence: .6
      };
      let delegate = 'GPU';
      try {
        landmarker = await FaceLandmarker.createFromOptions(files, options);
      } catch (gpuError) {
        delegate = 'CPU';
        options.baseOptions.delegate = delegate;
        try {
          landmarker = await FaceLandmarker.createFromOptions(files, options);
        } catch (cpuError) {
          throw new Error(`MediaPipe startup failed. GPU: ${gpuError.message}; CPU: ${cpuError.message}`);
        }
      }
      self.postMessage({type: 'ready', delegate});
    } catch (error) {
      self.postMessage({type: 'error', message: error.message || String(error)});
    } finally {
      loading = false;
    }
    return;
  }
  if (data.type === 'frame') {
    try {
      if (!landmarker) throw new Error('The face tracker is not ready.');
      const result = landmarker.detectForVideo(data.bitmap, data.time);
      self.postMessage({type: 'result', time: data.time,
        faceLandmarks: result.faceLandmarks,
        faceBlendshapes: result.faceBlendshapes});
    } catch (error) {
      self.postMessage({type: 'error', message: error.message || String(error)});
    } finally {
      data.bitmap?.close();
    }
  }
};

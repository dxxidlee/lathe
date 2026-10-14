/* Video → GIF conversion for brand slide motion tiles.
   Reuses gif.js from Kinetic Type. Converts on selection so the GIF
   is ready before "Build slide". Cached by source video ID. */
import GIF from 'gif.js';
import gifWorkerUrl from 'gif.js/dist/gif.worker.js?url';

export interface MotionResult {
  gif: Blob;
  poster: Blob;
  width: number;
  height: number;
  frames: number;
  duration: number;
}

const MAX_GIF_BYTES = 5 * 1024 * 1024;

export async function videoToGif(
  videoUrl: string,
  tileWidth: number,
  onProgress?: (pct: number) => void,
): Promise<MotionResult> {
  const proxyUrl = `/api/video?url=${encodeURIComponent(videoUrl)}`;
  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = proxyUrl;

  await new Promise<void>((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new Error('Video failed to load'));
    setTimeout(() => reject(new Error('Video load timeout')), 30000);
  });

  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) throw new Error('Video has no dimensions');

  let width = Math.min(Math.round(tileWidth), 800);
  let fps = 12;
  let duration = Math.min(video.duration || 4, 4);
  if (duration < 0.5) duration = Math.min(video.duration, 2);

  let height = Math.round(vh * width / vw);

  // Capture poster (first frame)
  const posterCanvas = document.createElement('canvas');
  posterCanvas.width = width; posterCanvas.height = height;
  const pctx = posterCanvas.getContext('2d')!;
  pctx.drawImage(video, 0, 0, width, height);
  const poster = await new Promise<Blob>((res, rej) => posterCanvas.toBlob(b => b ? res(b) : rej(new Error('Poster failed')), 'image/png'));

  // Seek to start and play to capture frames
  video.currentTime = 0;
  await new Promise<void>(r => { video.onseeked = () => r(); });

  const frameCanvas = document.createElement('canvas');
  const fctx = frameCanvas.getContext('2d', { willReadFrequently: true })!;

  // Try encoding; if result is too large, reduce fps then duration then width
  let blob: Blob | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    height = Math.round(vh * width / vw);
    frameCanvas.width = width; frameCanvas.height = height;
    const totalFrames = Math.max(1, Math.round(duration * fps));
    const delay = Math.round(1000 / fps);

    const gif = new GIF({
      workers: 2, quality: 10, width, height,
      workerScript: gifWorkerUrl, repeat: 0,
    });

    for (let i = 0; i < totalFrames; i++) {
      video.currentTime = i / fps;
      await new Promise<void>(r => { video.onseeked = () => r(); });
      fctx.drawImage(video, 0, 0, width, height);
      gif.addFrame(fctx, { copy: true, delay });
      onProgress?.(Math.round((i / totalFrames) * 70));
    }

    blob = await new Promise<Blob>(res => {
      gif.on('progress', (p: number) => onProgress?.(70 + Math.round(p * 30)));
      gif.on('finished', res);
      gif.render();
    });

    if (blob.size <= MAX_GIF_BYTES) break;
    if (fps > 8) { fps = 8; continue; }
    if (duration > 2) { duration = 2; continue; }
    width = Math.round(width * 0.75);
  }

  video.src = '';
  video.load();

  if (!blob) throw new Error('GIF encoding failed');

  return {
    gif: blob, poster, width, height,
    frames: Math.max(1, Math.round(duration * fps)), duration,
  };
}

/** Cache key for a video source so the same video never converts twice. */
export function motionCacheKey(videoId: string): string {
  return `motion:gif:${videoId}`;
}

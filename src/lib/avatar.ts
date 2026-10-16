/* Profile photo: upload, crop to 256×256 WebP, store in Supabase Storage. */
import { supabase } from './supabase';

const SIZE = 256;
const MAX_INPUT = 10 * 1024 * 1024;
const BUCKET = 'avatars';

export async function uploadAvatar(file: File, userId: string): Promise<string | null> {
  if (!supabase) return null;
  if (file.size > MAX_INPUT) throw new Error('Image must be under 10 MB');

  const img = new Image();
  img.src = URL.createObjectURL(file);
  await img.decode();
  URL.revokeObjectURL(img.src);

  // Center-crop to square, then resize to 256×256
  const s = Math.min(img.width, img.height);
  const sx = (img.width - s) / 2, sy = (img.height - s) / 2;
  const cv = document.createElement('canvas');
  cv.width = SIZE; cv.height = SIZE;
  const ctx = cv.getContext('2d')!;
  ctx.drawImage(img, sx, sy, s, s, 0, 0, SIZE, SIZE);

  const blob = await new Promise<Blob>((res, rej) =>
    cv.toBlob(b => b ? res(b) : rej(new Error('Encode failed')), 'image/webp', 0.85)
  );

  const path = `${userId}.webp`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    upsert: true, contentType: 'image/webp',
  });
  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return `${data.publicUrl}?t=${Date.now()}`;
}

export async function removeAvatar(userId: string): Promise<void> {
  if (!supabase) return;
  await supabase.storage.from(BUCKET).remove([`${userId}.webp`]);
}

export async function getAvatarUrl(userId: string): Promise<string | null> {
  if (!supabase) return null;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(`${userId}.webp`);
  // Check if the file exists by fetching the head
  try {
    const r = await fetch(data.publicUrl, { method: 'HEAD' });
    return r.ok ? data.publicUrl : null;
  } catch { return null; }
}

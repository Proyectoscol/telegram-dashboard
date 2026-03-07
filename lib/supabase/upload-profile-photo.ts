import { createAdminClient } from '@/lib/supabase/admin';

const BUCKET = 'profile-photos';

/**
 * Upload a profile photo buffer to Supabase Storage and return its public URL.
 * Path in bucket: {userId}/{filename} e.g. user7118289866/7118289866_e_dcooper_photo_0.jpg
 */
export async function uploadProfilePhoto(
  buffer: Buffer,
  userId: string,
  filename: string
): Promise<string> {
  const supabase = createAdminClient();
  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `${userId}/${safeFilename}`;

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buffer, { contentType: 'image/jpeg', upsert: true });

  if (error) throw error;

  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(data.path);
  return urlData.publicUrl;
}

/*
# Vision Pipeline Schema Updates & Storage Setup

## Changes
1. Add `plate_image_url` column to `parking_sessions` table
2. Create Supabase Storage bucket `vehicle-snapshots` for storing entrance and plate images
3. Set up storage policies for public read access and authenticated upload

## Notes
- The storage bucket is created via SQL using the `storage` schema
- Images are organized by: entrance/YYYY-MM-DD/PLATE_timestamp.jpg
- Plates stored in: plates/YYYY-MM-DD/PLATE_timestamp.jpg
*/

-- ============ ADD plate_image_url TO parking_sessions ============
ALTER TABLE parking_sessions ADD COLUMN IF NOT EXISTS plate_image_url text;

-- ============ CREATE STORAGE BUCKET ============
-- Create the storage bucket for vehicle snapshots
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'vehicle-snapshots',
  'vehicle-snapshots',
  true,
  5242880, -- 5MB max file size
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- ============ STORAGE POLICIES ============
-- Allow public read access to all snapshots
DROP POLICY IF EXISTS "Public read access for vehicle snapshots" ON storage.objects;
CREATE POLICY "Public read access for vehicle snapshots"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (bucket_id = 'vehicle-snapshots');

-- Allow anon and authenticated users to upload snapshots
DROP POLICY IF EXISTS "Allow upload vehicle snapshots" ON storage.objects;
CREATE POLICY "Allow upload vehicle snapshots"
ON storage.objects FOR INSERT
TO anon, authenticated
WITH CHECK (bucket_id = 'vehicle-snapshots');

-- Allow anon and authenticated users to update their uploads
DROP POLICY IF EXISTS "Allow update vehicle snapshots" ON storage.objects;
CREATE POLICY "Allow update vehicle snapshots"
ON storage.objects FOR UPDATE
TO anon, authenticated
USING (bucket_id = 'vehicle-snapshots')
WITH CHECK (bucket_id = 'vehicle-snapshots');

-- Allow anon and authenticated users to delete snapshots
DROP POLICY IF EXISTS "Allow delete vehicle snapshots" ON storage.objects;
CREATE POLICY "Allow delete vehicle snapshots"
ON storage.objects FOR DELETE
TO anon, authenticated
USING (bucket_id = 'vehicle-snapshots');

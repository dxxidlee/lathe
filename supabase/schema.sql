-- Lathe database schema. Run this in the Supabase SQL editor (Dashboard > SQL Editor > New query).

-- Custom tools (user-generated via Make a Tool)
CREATE TABLE IF NOT EXISTS custom_tools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  tool_id text NOT NULL,
  name text NOT NULL,
  "group" text NOT NULL DEFAULT 'Offcuts',
  description text,
  defaults jsonb DEFAULT '[]',
  code text NOT NULL,
  prompt text,
  versions jsonb DEFAULT '[]',
  current_version int DEFAULT 0,
  chat jsonb DEFAULT '[]',
  project_id uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_custom_tools_user ON custom_tools(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_tools_user_tool ON custom_tools(user_id, tool_id);

ALTER TABLE custom_tools ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_tools" ON custom_tools FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Library items (saved decks, audit results, palettes, images)
CREATE TABLE IF NOT EXISTS library_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  type text NOT NULL,
  name text NOT NULL,
  tool_id text,
  data jsonb,
  storage_path text,
  thumbnail_path text,
  project_id uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_library_items_user ON library_items(user_id);
CREATE INDEX IF NOT EXISTS idx_library_items_type ON library_items(user_id, type);

ALTER TABLE library_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_items" ON library_items FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Storage bucket for user files
INSERT INTO storage.buckets (id, name, public) VALUES ('library', 'library', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "own_upload" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'library' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "own_read" ON storage.objects FOR SELECT
  USING (bucket_id = 'library' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "own_delete" ON storage.objects FOR DELETE
  USING (bucket_id = 'library' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "own_update" ON storage.objects FOR UPDATE
  USING (bucket_id = 'library' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Boards: collections of images from Subject Audit
CREATE TABLE IF NOT EXISTS boards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL DEFAULT 'Untitled board',
  visibility text NOT NULL DEFAULT 'private',
  share_slug text UNIQUE,
  query text,
  project_id uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_boards_user ON boards(user_id, updated_at DESC);

ALTER TABLE boards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_boards" ON boards FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS board_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id uuid REFERENCES boards(id) ON DELETE CASCADE NOT NULL,
  position int NOT NULL DEFAULT 0,
  source_id text NOT NULL,
  source text NOT NULL,
  title text,
  creator text,
  date text,
  year int,
  image_url text NOT NULL,
  thumb_url text NOT NULL,
  width int,
  height int,
  license text,
  is_public_domain boolean DEFAULT false,
  source_url text,
  type text,
  palette jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_board_items_board ON board_items(board_id, position);

ALTER TABLE board_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_board_items" ON board_items FOR ALL
  USING (board_id IN (SELECT id FROM boards WHERE user_id = auth.uid()))
  WITH CHECK (board_id IN (SELECT id FROM boards WHERE user_id = auth.uid()));

-- No anonymous read policies. Shared boards are accessed only through get_shared_board().

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_board_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER boards_updated_at
  BEFORE UPDATE ON boards
  FOR EACH ROW EXECUTE FUNCTION update_board_timestamp();

-- Touch board when items change
CREATE OR REPLACE FUNCTION touch_board_on_item_change()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE boards SET updated_at = now()
  WHERE id = COALESCE(NEW.board_id, OLD.board_id);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER board_items_touch_board
  AFTER INSERT OR UPDATE OR DELETE ON board_items
  FOR EACH ROW EXECUTE FUNCTION touch_board_on_item_change();

-- Secure function for shared board access (anon can call this)
CREATE OR REPLACE FUNCTION get_shared_board(slug text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  board_row boards%ROWTYPE;
  result jsonb;
BEGIN
  SELECT * INTO board_row FROM boards
  WHERE share_slug = slug AND visibility = 'unlisted'
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'name', board_row.name,
    'item_count', (SELECT count(*) FROM board_items WHERE board_id = board_row.id),
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'image_url', bi.image_url,
        'thumb_url', bi.thumb_url,
        'width', bi.width,
        'height', bi.height,
        'title', bi.title,
        'creator', bi.creator,
        'date', bi.date,
        'source', bi.source,
        'license', bi.license,
        'source_url', bi.source_url
      ) ORDER BY bi.position)
      FROM board_items bi WHERE bi.board_id = board_row.id
    ), '[]'::jsonb)
  ) INTO result;

  RETURN result;
END;
$$;

-- Grant anon access to the function only
GRANT EXECUTE ON FUNCTION get_shared_board(text) TO anon;

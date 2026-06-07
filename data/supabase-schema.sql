-- ============================================================
-- NativePlant RAG — Supabase Schema
-- 在 Supabase Dashboard > SQL Editor 執行此檔案
-- ============================================================

-- 1. 啟用向量擴充
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. RAG chunks 主表
CREATE TABLE IF NOT EXISTS rag_chunks (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  content     text        NOT NULL,
  embedding   vector(1536),
  source_type text        NOT NULL CHECK (source_type IN ('pdf','image','plant_db','field_note')),
  source_file text,
  page        integer,
  metadata    jsonb       DEFAULT '{}'::jsonb,
  created_at  timestamptz DEFAULT now()
);

-- 3. 向量相似度索引（IVFFlat，適合中型資料集）
CREATE INDEX IF NOT EXISTS rag_chunks_embedding_idx
  ON rag_chunks
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- 4. 全文搜尋索引（備用）
CREATE INDEX IF NOT EXISTS rag_chunks_content_idx
  ON rag_chunks
  USING gin (to_tsvector('simple', content));

-- 5. source_type 篩選索引
CREATE INDEX IF NOT EXISTS rag_chunks_source_type_idx
  ON rag_chunks (source_type);

-- 6. 相似度查詢函數
CREATE OR REPLACE FUNCTION match_chunks(
  query_embedding vector(1536),
  match_count     int     DEFAULT 5,
  filter_source   text    DEFAULT NULL
)
RETURNS TABLE (
  id          uuid,
  content     text,
  source_type text,
  source_file text,
  page        integer,
  metadata    jsonb,
  similarity  float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.content,
    c.source_type,
    c.source_file,
    c.page,
    c.metadata,
    1 - (c.embedding <=> query_embedding) AS similarity
  FROM rag_chunks c
  WHERE
    (filter_source IS NULL OR c.source_type = filter_source)
    AND c.embedding IS NOT NULL
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- 7. Row Level Security（公開讀取，僅 service_role 可寫入）
ALTER TABLE rag_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access"
  ON rag_chunks FOR SELECT
  USING (true);

CREATE POLICY "Service role write access"
  ON rag_chunks FOR ALL
  USING (auth.role() = 'service_role');

export type Source = 'email' | 'file' | 'chat';

interface DocumentMetadata {
  source?: Source | null;
  source_id?: string | null;
  url?: string | null;
  created_at?: string | null;
  author?: string | null;
}

interface DocumentChunkMetadata extends DocumentMetadata {
  document_id?: string | null;
}

interface DocumentChunk {
  id?: string | null;
  text: string;
  metadata: DocumentChunkMetadata;
  embedding?: Array<number> | null;
}

interface DocumentChunkWithScore extends DocumentChunk {
  score: number;
}

export interface QueryResult {
  query: string;
  results: Array<DocumentChunkWithScore>;
}

-- Add visual_summaries table for storing the visual meeting summary (second LLM dispatch)
CREATE TABLE IF NOT EXISTS visual_summaries (
    meeting_id TEXT PRIMARY KEY NOT NULL,
    status TEXT NOT NULL,
    result TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
);

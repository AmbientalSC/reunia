-- Last live insight (summary, topic, keywords...) of a meeting, kept after the recording ends
CREATE TABLE IF NOT EXISTS meeting_insights (
    meeting_id TEXT PRIMARY KEY NOT NULL,
    result TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
);

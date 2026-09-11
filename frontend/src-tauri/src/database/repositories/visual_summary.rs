use crate::database::models::VisualSummary;
use chrono::Utc;
use serde_json::Value;
use sqlx::SqlitePool;
use tracing::info as log_info;

pub struct VisualSummariesRepository;

impl VisualSummariesRepository {
    /// Retrieves the visual summary row for a given meeting ID.
    pub async fn get(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<Option<VisualSummary>, sqlx::Error> {
        sqlx::query_as::<_, VisualSummary>("SELECT * FROM visual_summaries WHERE meeting_id = ?")
            .bind(meeting_id)
            .fetch_optional(pool)
            .await
    }

    /// Creates the row or resets it to PENDING before a new generation.
    /// Keeps the previous result so the UI can show the old visual summary
    /// until the new one is ready.
    pub async fn create_or_reset(pool: &SqlitePool, meeting_id: &str) -> Result<(), sqlx::Error> {
        let now = Utc::now();
        sqlx::query(
            r#"
            INSERT INTO visual_summaries (meeting_id, status, result, error, created_at, updated_at)
            VALUES (?, 'PENDING', NULL, NULL, ?, ?)
            ON CONFLICT(meeting_id) DO UPDATE SET
                status = 'PENDING',
                error = NULL,
                updated_at = excluded.updated_at
            "#,
        )
        .bind(meeting_id)
        .bind(now)
        .bind(now)
        .execute(pool)
        .await?;
        log_info!(
            "Visual summary process reset to PENDING for meeting_id: {}",
            meeting_id
        );
        Ok(())
    }

    pub async fn update_completed(
        pool: &SqlitePool,
        meeting_id: &str,
        result: &Value,
    ) -> Result<(), sqlx::Error> {
        let result_str = serde_json::to_string(result)
            .map_err(|e| sqlx::Error::Protocol(format!("Failed to serialize result: {}", e)))?;
        sqlx::query(
            "UPDATE visual_summaries SET status = 'completed', result = ?, error = NULL, updated_at = ? WHERE meeting_id = ?",
        )
        .bind(result_str)
        .bind(Utc::now())
        .bind(meeting_id)
        .execute(pool)
        .await?;
        log_info!("Visual summary completed for meeting_id: {}", meeting_id);
        Ok(())
    }

    pub async fn update_failed(
        pool: &SqlitePool,
        meeting_id: &str,
        error: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE visual_summaries SET status = 'failed', error = ?, updated_at = ? WHERE meeting_id = ?",
        )
        .bind(error)
        .bind(Utc::now())
        .bind(meeting_id)
        .execute(pool)
        .await?;
        log_info!("Visual summary failed for meeting_id: {}", meeting_id);
        Ok(())
    }

    pub async fn update_cancelled(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE visual_summaries SET status = 'cancelled', updated_at = ? WHERE meeting_id = ?",
        )
        .bind(Utc::now())
        .bind(meeting_id)
        .execute(pool)
        .await?;
        log_info!("Visual summary cancelled for meeting_id: {}", meeting_id);
        Ok(())
    }
}

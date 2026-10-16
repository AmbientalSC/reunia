use chrono::{DateTime, Utc};
use sqlx::{FromRow, SqlitePool};

#[derive(Debug, Clone, FromRow)]
pub struct MeetingInsight {
    pub meeting_id: String,
    /// `LiveInsightData` serialized as JSON.
    pub result: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

pub struct MeetingInsightsRepository;

impl MeetingInsightsRepository {
    pub async fn get(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<Option<MeetingInsight>, sqlx::Error> {
        sqlx::query_as::<_, MeetingInsight>("SELECT * FROM meeting_insights WHERE meeting_id = ?")
            .bind(meeting_id)
            .fetch_optional(pool)
            .await
    }

    /// Stores the insight, replacing the previous one of the same meeting.
    pub async fn upsert(
        pool: &SqlitePool,
        meeting_id: &str,
        result: &str,
    ) -> Result<(), sqlx::Error> {
        let now = Utc::now();
        sqlx::query(
            r#"
            INSERT INTO meeting_insights (meeting_id, result, created_at, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(meeting_id) DO UPDATE SET
                result = excluded.result,
                updated_at = excluded.updated_at
            "#,
        )
        .bind(meeting_id)
        .bind(result)
        .bind(now)
        .bind(now)
        .execute(pool)
        .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn pool_with_meeting(meeting_id: &str) -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        sqlx::query(
            "INSERT INTO meetings (id, title, created_at, updated_at) VALUES (?, 'Reunião', ?, ?)",
        )
        .bind(meeting_id)
        .bind(Utc::now())
        .bind(Utc::now())
        .execute(&pool)
        .await
        .unwrap();
        pool
    }

    #[tokio::test]
    async fn returns_none_when_the_meeting_has_no_insight() {
        let pool = pool_with_meeting("m1").await;

        assert!(MeetingInsightsRepository::get(&pool, "m1").await.unwrap().is_none());
    }

    #[tokio::test]
    async fn upsert_stores_and_then_replaces_the_insight() {
        let pool = pool_with_meeting("m1").await;

        MeetingInsightsRepository::upsert(&pool, "m1", r#"{"summary":["a"]}"#).await.unwrap();
        MeetingInsightsRepository::upsert(&pool, "m1", r#"{"summary":["b"]}"#).await.unwrap();

        let stored = MeetingInsightsRepository::get(&pool, "m1").await.unwrap().unwrap();
        assert_eq!(stored.result, r#"{"summary":["b"]}"#);
    }

    #[tokio::test]
    async fn rejects_insights_for_meetings_that_do_not_exist() {
        let pool = pool_with_meeting("m1").await;

        let result = MeetingInsightsRepository::upsert(&pool, "ghost", "{}").await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn deleting_the_meeting_removes_its_insight() {
        let pool = pool_with_meeting("m1").await;
        MeetingInsightsRepository::upsert(&pool, "m1", "{}").await.unwrap();

        sqlx::query("DELETE FROM meetings WHERE id = 'm1'").execute(&pool).await.unwrap();

        assert!(MeetingInsightsRepository::get(&pool, "m1").await.unwrap().is_none());
    }
}

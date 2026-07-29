import React, { useRef, useEffect } from 'react';
import { useTranscription, TranscriptionSegment } from '../hooks/useTranscription';
import { useInsights, InsightsData } from '../hooks/useInsights';

interface InsightPanelProps {
  fullScreen?: boolean;
  onClose?: () => void;
  currentSegments?: TranscriptionSegment[];
  currentInsights?: InsightsData | null;
}

/**
 * InsightPanel — Painel expansível que mostra:
 * - Transcrição ao vivo com identificação de falante
 * - Itens de ação detectados pelo LLM
 * - Insights e sugestões em tempo real
 * - Tópicos sendo discutidos
 * 
 * Design: tema escuro, glassmorphism, scroll automático.
 */
const InsightPanel: React.FC<InsightPanelProps> = ({
  fullScreen = false,
  onClose,
  currentSegments,
  currentInsights,
}) => {
  const transcriptionFeed = useTranscription();
  const insightsFeed = useInsights();
  const segments = currentSegments ?? transcriptionFeed.segments;
  const insights = currentInsights ?? insightsFeed.insights;
  const transcriptionConnected = transcriptionFeed.isConnected || segments.length > 0;
  const insightsConnected = insightsFeed.isConnected || Boolean(insights);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to latest transcription
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [segments]);

  // Format timestamp
  const formatTime = (ts: number) => {
    return new Date(ts).toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const panelClass = fullScreen ? 'insight-panel fullscreen' : 'insight-panel floater';

  return (
    <div className={panelClass}>
      {/* Header */}
      <div className="panel-header">
        <h2>Reunia</h2>
        <div className="panel-header-info">
          {transcriptionConnected && <span className="conn-badge online">Transcrição ativa</span>}
          {insightsConnected && <span className="conn-badge online">IA conectada</span>}
        </div>
        {onClose && (
          <button className="ctrl-btn close-panel" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        )}
      </div>

      <div className="panel-content">
        <div className="panel-columns">
          {/* Left: Live Transcription */}
          <div className="panel-col transcription-col">
            <h3>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5-3c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
              </svg>
              Transcrição ao Vivo
            </h3>
            <div className="transcript-feed">
              {segments.length === 0 && (
                <div className="empty-state">
                  <p>Aguardando áudio...</p>
                  <p className="hint">Inicie uma reunião para começar a transcrição</p>
                </div>
              )}
              {segments.map((seg, idx) => (
                <div key={idx} className={`transcript-item ${seg.speaker}`}>
                  <span className="speaker-badge">
                    {seg.speaker === 'mic' ? '🎤 Eu' : seg.speaker === 'system' ? '🔊 Outros' : '👤 ?'}
                  </span>
                  <span className="transcript-time">{formatTime(seg.timestamp)}</span>
                  <p className="transcript-text">{seg.text}</p>
                </div>
              ))}
              <div ref={transcriptEndRef} />
            </div>
          </div>

          {/* Right: Insights */}
          <div className="panel-col insights-col">
            <h3>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7zm2.85 11.1l-.85.6V16h-4v-2.3l-.85-.6C7.8 12.16 7 10.63 7 9c0-2.76 2.24-5 5-5s5 2.24 5 5c0 1.63-.8 3.16-2.15 4.1z" />
              </svg>
              Insights
            </h3>
            <div className="insights-feed">
              {/* Topics */}
              {insights?.topics && insights.topics.length > 0 && (
                <div className="insight-section">
                  <h4>Tópicos</h4>
                  <div className="tags">
                    {insights.topics.map((topic, i) => (
                      <span key={i} className="tag">{topic}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Action Items */}
              {insights?.actionItems && insights.actionItems.length > 0 && (
                <div className="insight-section">
                  <h4>📌 Itens de Ação</h4>
                  <ul className="action-list">
                    {insights.actionItems.map((item, i) => (
                      <li key={i}>
                        <input type="checkbox" id={`action-${i}`} />
                        <label htmlFor={`action-${i}`}>{item}</label>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Contradictions */}
              {insights?.contradictions && insights.contradictions.length > 0 && (
                <div className="insight-section warning">
                  <h4>⚠️ Contradições</h4>
                  <ul>
                    {insights.contradictions.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Unresolved */}
              {insights?.unresolvedPoints && insights.unresolvedPoints.length > 0 && (
                <div className="insight-section warning">
                  <h4>❓ Pontos Não Resolvidos</h4>
                  <ul>
                    {insights.unresolvedPoints.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Suggestions */}
              {insights?.suggestions && insights.suggestions.length > 0 && (
                <div className="insight-section">
                  <h4>💡 Sugestões</h4>
                  <ul>
                    {insights.suggestions.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}

              {!insights && (
                <div className="empty-state">
                  <p>Nenhum insight ainda</p>
                  <p className="hint">Os insights aparecerão após alguns minutos de conversa</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InsightPanel;

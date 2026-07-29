import React from 'react';
import { InsightsData } from '../hooks/useInsights';

interface LiveSummaryProps {
  insights: InsightsData | null;
  segmentCount: number;
  isVisible: boolean;
}

/**
 * LiveSummary — Painel de sumário ao vivo que aparece acima do widget flutuante.
 * 
 * Mostra em tempo real:
 * - Tópicos sendo discutidos (tags)
 * - Principais pontos extraídos pelo LLM
 * - Itens de ação identificados
 * - Conexões entre tópicos
 * 
 * O painel expande a janela do float widget automaticamente
 * quando insights são gerados.
 */
const LiveSummary: React.FC<LiveSummaryProps> = ({ insights, segmentCount, isVisible }) => {
  if (!isVisible || !insights) return null;

  const hasContent =
    (insights.topics && insights.topics.length > 0) ||
    (insights.actionItems && insights.actionItems.length > 0) ||
    (insights.suggestions && insights.suggestions.length > 0) ||
    (insights.contradictions && insights.contradictions.length > 0);

  if (!hasContent) return null;

  // Tópicos já aparecem como tags; não os repete nos pontos principais.
  const keyPoints = insights.suggestions?.slice(0, 3) || [];

  // Build connections: contradictions + unresolved points
  const connections = [
    ...(insights.contradictions?.map((c: string) => `⚠️ ${c}`) || []),
    ...(insights.unresolvedPoints?.map((u: string) => `❓ ${u}`) || []),
  ];

  return (
    <div className="live-summary">
      {/* Header */}
      <div className="summary-header">
        <span className="summary-title">Resumo ao vivo</span>
        <span className="summary-segments">{segmentCount} seg.</span>
      </div>

      {/* Topics */}
      {insights.topics && insights.topics.length > 0 && (
        <div className="summary-section">
          <div className="summary-label">Assuntos</div>
          <div className="summary-tags">
            {insights.topics.map((topic: string, i: number) => (
              <span key={i} className="summary-tag">{topic}</span>
            ))}
          </div>
        </div>
      )}

      {/* Key Points */}
      {keyPoints.length > 0 && (
        <div className="summary-section">
          <div className="summary-label">Pontos principais</div>
          <ul className="summary-bullets">
            {keyPoints.slice(0, 4).map((point: string, i: number) => (
              <li key={i}>{point}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Action Items */}
      {insights.actionItems && insights.actionItems.length > 0 && (
        <div className="summary-section">
          <div className="summary-label">
            Ações
            <span className="summary-count">{insights.actionItems.length}</span>
          </div>
          <ul className="summary-bullets actions">
            {insights.actionItems.slice(0, 3).map((item: string, i: number) => (
              <li key={i}>
                <span className="action-checkbox">☐</span> {item}
              </li>
            ))}
            {insights.actionItems.length > 3 && (
              <li className="summary-more">+{insights.actionItems.length - 3} mais...</li>
            )}
          </ul>
        </div>
      )}

      {/* Connections */}
      {connections.length > 0 && (
        <div className="summary-section connections">
          <div className="summary-label">Pendências e conexões</div>
          <ul className="summary-bullets">
            {connections.slice(0, 2).map((conn: string, i: number) => (
              <li key={i}>{conn}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default LiveSummary;

import { MeetingData } from '../audio/audioService';

/**
 * NoteGenerator creates structured Markdown notes for Obsidian
 * based on meeting transcription data and insights.
 * 
 * Template features:
 * - YAML frontmatter with date, time, duration, participants, tags
 * - Executive Summary section
 * - Main Topics discussed
 * - Decisions made
 * - Action items with checkboxes
 * - Full transcript in collapsible <details> section
 */
export class NoteGenerator {
  private meetingData: MeetingData;

  constructor(meetingData: MeetingData) {
    this.meetingData = meetingData;
  }

  /**
   * Generate the complete Markdown note content.
   */
  generate(): string {
    const {
      id,
      startTime,
      endTime,
      durationMs,
      transcriptSegments,
      insights,
      summary,
    } = this.meetingData;

    const dateStr = this.formatDate(startTime);
    const timeStr = this.formatTime(startTime);
    const durationStr = this.formatDuration(durationMs || 0);
    const participants = this.extractParticipants(insights as any);

    // --- Frontmatter ---
    let note = '---\n';
    note += `title: "Reunião - ${dateStr}"\n`;
    note += `date: ${this.formatDateISO(startTime)}\n`;
    note += `time: ${timeStr}\n`;
    note += `duration: ${durationStr}\n`;
    note += `meeting-id: "${id}"\n`;
    note += `tags: [reunião, ata]\n`;

    if (participants.length > 0) {
      note += `participants:\n`;
      for (const p of participants) {
        note += `  - "${p}"\n`;
      }
    }

    note += '---\n\n';

    // --- Title ---
    note += `# 📝 Ata de Reunião — ${dateStr}\n\n`;
    note += `**Horário:** ${this.formatTime(startTime)} às ${endTime ? this.formatTime(endTime) : '--:--'}\n`;
    note += `**Duração:** ${durationStr}\n\n`;

    // --- Executive Summary ---
    note += '## 📋 Resumo Executivo\n\n';
    if ((insights as any)?.summary) {
      note += `${(insights as any).summary}\n\n`;
    } else if (summary) {
      note += `${summary}\n\n`;
    } else {
      note += '*Nenhum resumo gerado automaticamente.*\n\n';
    }

    // --- Main Topics ---
    note += '## 🎯 Tópicos Principais\n\n';
    if (insights?.topics && insights.topics.length > 0) {
      for (const topic of insights.topics) {
        note += `- ${topic}\n`;
      }
    } else {
      note += '*Nenhum tópico identificado.*\n';
    }
    note += '\n';

    // --- Decisions ---
    note += '## ✅ Decisões Tomadas\n\n';
    if ((insights as any)?.decisions && (insights as any).decisions.length > 0) {
      for (const decision of (insights as any).decisions) {
        note += `- ${decision}\n`;
      }
    } else {
      note += '*Nenhuma decisão registrada.*\n';
    }
    note += '\n';

    // --- Action Items ---
    note += '## 📌 Itens de Ação\n\n';
    if (insights?.actionItems && insights.actionItems.length > 0) {
      for (const item of insights.actionItems) {
        note += `- [ ] ${item}\n`;
      }
    } else {
      note += '*Nenhum item de ação identificado.*\n';
    }
    note += '\n';

    // --- Contradictions / Unresolved ---
    if (
      insights?.contradictions?.length ||
      insights?.unresolvedPoints?.length
    ) {
      note += '## ⚠️ Pontos de Atenção\n\n';

      if (insights?.contradictions && insights.contradictions.length > 0) {
        note += '### Contradições\n';
        for (const c of insights.contradictions) {
          note += `- ${c}\n`;
        }
        note += '\n';
      }

      if (insights?.unresolvedPoints && insights.unresolvedPoints.length > 0) {
        note += '### Pontos Não Resolvidos\n';
        for (const u of insights.unresolvedPoints) {
          note += `- ${u}\n`;
        }
        note += '\n';
      }
    }

    // --- Suggestions ---
    if (insights?.suggestions && insights.suggestions.length > 0) {
      note += '## 💡 Sugestões & Insights\n\n';
      for (const s of insights.suggestions) {
        note += `- ${s}\n`;
      }
      note += '\n';
    }

    // --- Full Transcription (collapsible) ---
    note += '## 📜 Transcrição Completa\n\n';
    note += '<details>\n';
    note += '<summary>Clique para expandir a transcrição completa</summary>\n\n';

    if (transcriptSegments && transcriptSegments.length > 0) {
      for (const segment of transcriptSegments) {
        const speakerLabel =
          segment.speaker === 'mic' ? '🎤 **Eu**' :
          segment.speaker === 'system' ? '🔊 **Outros**' :
          '👤 **Desconhecido**';
        const time = this.formatTimestamp(segment.timestamp);
        note += `> ${speakerLabel} _(${time})_:\n> ${segment.text}\n>\n`;
      }
    } else {
      note += '*Nenhuma transcrição disponível.*\n';
    }

    note += '\n</details>\n';

    return note;
  }

  // --- Format helpers ---

  private formatDate(date: Date): string {
    const d = new Date(date);
    return d.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });
  }

  private formatDateISO(date: Date): string {
    const d = new Date(date);
    return d.toISOString().split('T')[0];
  }

  private formatTime(date: Date): string {
    const d = new Date(date);
    return d.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  private formatDuration(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}h ${minutes}min ${seconds}s`;
    }
    if (minutes > 0) {
      return `${minutes}min ${seconds}s`;
    }
    return `${seconds}s`;
  }

  private formatTimestamp(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  private extractParticipants(insights: {
    participants?: string[];
  } | null): string[] {
    if (insights?.participants && insights.participants.length > 0) {
      return insights.participants;
    }
    return [];
  }
}

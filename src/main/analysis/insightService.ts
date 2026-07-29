import { getGroqClient, withRetry, resetGroqClient } from '../transcription/groqClient';
import { getConfigStore } from '../store/configStore';
import { InsightsData } from '../../preload/index';

const INSIGHT_SYSTEM_PROMPT = `Você é um analista de reuniões especializado em extrair insights valiosos de transcrições em tempo real.

Analise a transcrição fornecida e extraia as seguintes informações em formato JSON:

1. **actionItems**: Lista de itens de ação / tarefas que foram mencionadas ou atribuídas a alguém.
2. **contradictions**: Pontos onde houve contradição ou mudança de opinião entre os participantes.
3. **unresolvedPoints**: Questões que ficaram sem resposta ou decisão.
4. **suggestions**: Sugestões contextuais ou insights relevantes com base no que está sendo discutido.
5. **topics**: Lista dos principais tópicos sendo discutidos neste segmento.

Responda APENAS com um objeto JSON válido. Não inclua markdown, explicações ou texto extra.
Se um campo não tiver dados, retorne um array vazio.`;

const FINAL_SUMMARY_SYSTEM_PROMPT = `Você é um assistente especializado em gerar atas de reunião executivas.

Com base na transcrição completa da reunião fornecida, gere um resumo estruturado contendo:

1. **Resumo Executivo**: Um parágrafo conciso resumindo o que foi discutido e as conclusões principais.
2. **Tópicos Principais**: Lista dos tópicos discutidos.
3. **Decisões Tomadas**: Lista de decisões que foram tomadas.
4. **Itens de Ação**: Lista de tarefas com responsável (se mencionado) e prazo (se mencionado).

Responda APENAS com um objeto JSON válido com a seguinte estrutura:
{
  "executiveSummary": "string",
  "mainTopics": ["string"],
  "decisions": ["string"],
  "actionItems": ["{responsavel}: {tarefa}"],
  "participants": ["string"]
}`;

/**
 * InsightService uses Groq LLM models to analyze transcribed text
 * and extract actionable insights, action items, and contradictions
 * in real-time during meetings.
 */
export class InsightService {
  private lastAnalysisText: string = '';

  /**
   * Analyze a transcript segment and extract mid-meeting insights.
   * Called periodically during the meeting.
   */
  async analyzeTranscript(transcript: string): Promise<InsightsData | null> {
    // Avoid re-analyzing the same text
    if (transcript === this.lastAnalysisText || transcript.length < 50) {
      return null;
    }

    try {
      const client = getGroqClient();
      const store = getConfigStore();
      const model = store.get('llmModel');

      // Only analyze the new portion since last analysis
      const newText = transcript.slice(this.lastAnalysisText.length);

      if (newText.length < 50) return null;

      const response = await withRetry(async () => {
        return client.chat.completions.create({
          model,
          messages: [
            { role: 'system', content: INSIGHT_SYSTEM_PROMPT },
            { role: 'user', content: `Transcrição da reunião (trecho mais recente):\n\n${newText}` },
          ],
          temperature: 0.1,
          response_format: { type: 'json_object' },
        });
      });

      this.lastAnalysisText = transcript;

      const content = response.choices[0]?.message?.content;
      if (!content) return null;

      const parsed = JSON.parse(content);
      return {
        actionItems: parsed.actionItems || [],
        contradictions: parsed.contradictions || [],
        unresolvedPoints: parsed.unresolvedPoints || [],
        suggestions: parsed.suggestions || [],
        topics: parsed.topics || [],
        timestamp: Date.now(),
      };
    } catch (err: any) {
      if (err.message?.includes('API key') || err.status === 401) {
        resetGroqClient();
      }
      console.warn('[InsightService] Mid-meeting analysis failed:', err.message);
      return null;
    }
  }

  /**
   * Generate a comprehensive final summary of the entire meeting.
   * Called when the meeting ends.
   */
  async generateFinalSummary(fullTranscript: string): Promise<InsightsData> {
    try {
      const client = getGroqClient();
      const store = getConfigStore();
      const model = store.get('llmModel');

      if (fullTranscript.length < 20) {
        return {
          actionItems: [],
          contradictions: [],
          unresolvedPoints: [],
          suggestions: [],
          topics: ['Reunião sem conteúdo detectado'],
          timestamp: Date.now(),
        };
      }

      const response = await withRetry(async () => {
        return client.chat.completions.create({
          model,
          messages: [
            { role: 'system', content: FINAL_SUMMARY_SYSTEM_PROMPT },
            {
              role: 'user',
              content: `Transcrição completa da reunião:\n\n${fullTranscript}`,
            },
          ],
          temperature: 0.1,
          response_format: { type: 'json_object' },
        });
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        return this.getDefaultInsights();
      }

      const parsed = JSON.parse(content);

      return {
        actionItems: parsed.actionItems || [],
        contradictions: parsed.contradictions || [],
        unresolvedPoints: parsed.unresolvedPoints || [],
        suggestions: parsed.suggestions || [],
        topics: parsed.mainTopics || parsed.topics || [],
        timestamp: Date.now(),
        summary: parsed.executiveSummary || '',
        decisions: parsed.decisions || [],
        participants: parsed.participants || [],
      } as any;
    } catch (err: any) {
      if (err.message?.includes('API key') || err.status === 401) {
        resetGroqClient();
      }
      console.error('[InsightService] Final summary failed:', err.message);
      return this.getDefaultInsights();
    }
  }

  private getDefaultInsights(): InsightsData {
    return {
      actionItems: [],
      contradictions: [],
      unresolvedPoints: [],
      suggestions: [],
      topics: [],
      timestamp: Date.now(),
    };
  }
}

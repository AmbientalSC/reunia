import { BrowserWindow } from 'electron';
import { ChunkManager } from '../transcription/chunkManager';
import { WhisperService } from '../transcription/whisperService';
import { InsightService } from '../analysis/insightService';
import { InsightsData } from '../../preload/index';
import { getConfigStore } from '../store/configStore';
import { NoteGenerator } from '../obsidian/noteGenerator';
import { NoteWriter } from '../obsidian/noteWriter';

export interface MeetingData {
  id: string;
  startTime: Date;
  endTime?: Date;
  durationMs?: number;
  transcriptSegments: TranscriptSegment[];
  insights?: InsightsData;
  summary?: string;
  notePath?: string;
  noteError?: string;
}

export interface TranscriptSegment {
  speaker: 'mic' | 'system' | 'unknown';
  text: string;
  timestamp: number;
  isFinal: boolean;
}

export type AudioState = 'idle' | 'recording' | 'paused';

export class AudioService {
  private state: AudioState = 'idle';
  private micBuffer: string[] = [];
  private systemBuffer: string[] = [];
  private segments: TranscriptSegment[] = [];
  private meetingStartTime: Date | null = null;
  private chunkManager: ChunkManager;
  private whisperService: WhisperService;
  private insightService: InsightService;
  private insightInterval: NodeJS.Timeout | null = null;
  private latestInsights: InsightsData | undefined;
  private pendingTranscriptions = new Set<Promise<void>>();

  constructor() {
    this.chunkManager = new ChunkManager();
    this.whisperService = new WhisperService();
    this.insightService = new InsightService();
    // Listen for WAV buffer chunks from ChunkManager and transcribe them
    this.chunkManager.onTranscription((wavBuffer, speaker) => {
      const sessionSegments = this.segments;
      const task = (async () => {
        try {
          const text = await this.whisperService.transcribe(wavBuffer, speaker);
          if (text) {
            const segment: TranscriptSegment = {
              speaker,
              text,
              timestamp: Date.now(),
              isFinal: true,
            };
            sessionSegments.push(segment);
            this.broadcastTranscription(segment);
          }
        } catch (err) {
          console.error('[AudioService] Transcription failed:', err);
        }
      })();

      this.pendingTranscriptions.add(task);
      task.finally(() => this.pendingTranscriptions.delete(task));
    });
  }

  /**
   * Start recording — signals renderer to begin audio capture.
   */
  async start(): Promise<void> {
    if (this.state === 'recording') return;
    this.state = 'recording';
    this.meetingStartTime = new Date();
    this.segments = [];
    this.micBuffer = [];
    this.systemBuffer = [];
    this.latestInsights = undefined;
    this.whisperService.resetTranscript();
    this.insightService.reset();

    console.log('[AudioService] Recording started');

    // Start the chunk manager's transcription loop
    this.chunkManager.start(this.micBuffer, this.systemBuffer);

    // Start periodic insight generation
    this.startInsightLoop();

    // Notify renderers
    this.broadcastInsights(this.emptyInsights());
    this.broadcastStateChange('recording');
  }

  /**
   * Pause recording — stop sending chunks but keep buffers.
   */
  async pause(): Promise<void> {
    if (this.state !== 'recording') return;
    this.state = 'paused';

    this.chunkManager.pause();
    this.stopInsightLoop();

    console.log('[AudioService] Recording paused');
    this.broadcastStateChange('paused');
  }

  /**
   * Resume recording after pause.
   */
  async resume(): Promise<void> {
    if (this.state !== 'paused') return;
    this.state = 'recording';

    this.chunkManager.resume();
    this.startInsightLoop();

    console.log('[AudioService] Recording resumed');
    this.broadcastStateChange('recording');
  }

  /**
   * Stop recording, generate final analysis, and save note.
   */
  async stop(): Promise<MeetingData | null> {
    if (this.state === 'idle') return null;

    this.state = 'idle';

    // Para o processamento dos chunks enviados pelo renderer
    this.chunkManager.stop();
    this.stopInsightLoop();

    const endTime = new Date();
    const durationMs = this.meetingStartTime
      ? endTime.getTime() - this.meetingStartTime.getTime()
      : 0;

    console.log('[AudioService] Recording stopped. Saving note immediately...');

    const sessionSegments = this.segments;
    const pendingAtStop = [...this.pendingTranscriptions];

    const meetingData: MeetingData = {
      id: `meeting-${Date.now()}`,
      startTime: this.meetingStartTime || new Date(),
      endTime,
      durationMs,
      transcriptSegments: [...sessionSegments],
      insights: this.latestInsights,
      summary: this.latestInsights?.topics?.join(', '),
    };

    const vaultPath = getConfigStore().get('obsidianVaultPath');
    if (vaultPath) {
      try {
        const writer = new NoteWriter(vaultPath);
        meetingData.notePath = await writer.write(new NoteGenerator(meetingData).generate());

        // A nota já existe no Obsidian. As últimas transcrições e a análise
        // final enriquecem o mesmo arquivo sem bloquear o botão Parar.
        void this.finalizeSavedNote(
          meetingData,
          sessionSegments,
          pendingAtStop,
          writer,
          meetingData.notePath
        );
      } catch (err: any) {
        meetingData.noteError = err?.message || 'Falha ao salvar a nota no Obsidian';
        console.error('[AudioService] Failed to save Obsidian note:', err);
      }
    } else {
      meetingData.noteError = 'Configure a pasta do Obsidian Vault antes de iniciar a reunião.';
      console.warn('[AudioService] Obsidian vault path is not configured.');
    }

    this.broadcastStateChange('idle');
    this.broadcastMeetingEnded(meetingData);

    // Clear buffers
    this.micBuffer = [];
    this.systemBuffer = [];

    return meetingData;
  }

  private async finalizeSavedNote(
    meetingData: MeetingData,
    sessionSegments: TranscriptSegment[],
    pendingAtStop: Promise<void>[],
    writer: NoteWriter,
    filePath: string
  ): Promise<void> {
    try {
      await Promise.allSettled(pendingAtStop);
      const transcriptSegments = [...sessionSegments];
      let finalInsights = meetingData.insights;

      if (transcriptSegments.length > 0) {
        const fullTranscript = transcriptSegments.map((segment) => segment.text).join(' ');
        finalInsights = this.limitInsights(
          await this.insightService.generateFinalSummary(fullTranscript)
        );
      }

      const finalized: MeetingData = {
        ...meetingData,
        transcriptSegments,
        insights: finalInsights,
        summary: finalInsights?.topics?.join(', ') || meetingData.summary,
      };
      await writer.update(filePath, new NoteGenerator(finalized).generate());
    } catch (err) {
      // A nota inicial continua salva mesmo se o enriquecimento falhar.
      console.error('[AudioService] Failed to update note with final analysis:', err);
    }
  }

  // --- Buffer management (called from IPC handlers) ---

  onMicChunk(data: string): void {
    if (this.state === 'recording') {
      this.micBuffer.push(data);
    }
  }

  onSystemChunk(data: string): void {
    if (this.state === 'recording') {
      this.systemBuffer.push(data);
    }
  }

  // --- Private helpers ---

  /** Envia evento para todas as janelas, ignorando as que já foram destruídas. */
  private safeSendAll(event: string, ...args: any[]): void {
    BrowserWindow.getAllWindows().forEach((win) => {
      if (win.isDestroyed()) return;
      try {
        const wc = win.webContents;
        if (wc && !wc.isDestroyed()) {
          wc.send(event, ...args);
        }
      } catch {
        // Render frame disposed ou outros erros — ignora silenciosamente
      }
    });
  }

  private broadcastTranscription(segment: TranscriptSegment): void {
    this.safeSendAll('transcription:new-segment', segment);
  }

  private broadcastStateChange(state: AudioState): void {
    this.safeSendAll('meeting:state-changed', state);
  }

  private broadcastMeetingEnded(data: MeetingData): void {
    this.safeSendAll('meeting:ended', data);
  }

  private broadcastInsights(insights: InsightsData): void {
    this.safeSendAll('insights:update', insights);
  }

  private emptyInsights(): InsightsData {
    return {
      actionItems: [],
      contradictions: [],
      unresolvedPoints: [],
      suggestions: [],
      topics: [],
      timestamp: Date.now(),
    };
  }

  private limitInsights(incoming: InsightsData): InsightsData {
    return {
      ...incoming,
      actionItems: this.normalizeInsightList(incoming.actionItems, 8),
      contradictions: this.normalizeInsightList(incoming.contradictions, 5),
      unresolvedPoints: this.normalizeInsightList(incoming.unresolvedPoints, 6),
      suggestions: this.normalizeInsightList(incoming.suggestions, 6),
      topics: this.normalizeInsightList(incoming.topics, 6),
      timestamp: incoming.timestamp,
    };
  }

  private normalizeInsightList(values: string[], limit: number): string[] {
    const unique = new Map<string, string>();

    for (const value of values) {
      const cleaned = typeof value === 'string' ? value.trim() : '';
      if (!cleaned) continue;
      unique.set(cleaned.toLocaleLowerCase('pt-BR'), cleaned);
    }

    return [...unique.values()].slice(-limit);
  }

  private startInsightLoop(): void {
    if (this.insightInterval) return;

    // Generate insights after every 5 new segments
    let lastSegmentCount = 0;
    this.insightInterval = setInterval(async () => {
      if (this.segments.length - lastSegmentCount >= 3) {
        lastSegmentCount = this.segments.length;
        try {
          const transcript = this.segments.map(s => `${s.text}`).join(' ');
          const insights = await this.insightService.analyzeTranscript(
            transcript,
            this.latestInsights
          );
          if (insights) {
            // A resposta já representa o estado completo reconciliado.
            // Substituir permite remover itens resolvidos e consolidar equivalentes.
            this.latestInsights = this.limitInsights(insights);
            this.broadcastInsights(this.latestInsights);
          }
        } catch (err) {
          // Silent fail — insights are best-effort
          console.warn('[AudioService] Insight generation failed:', err);
        }
      }
    }, 10_000); // Check every 10 seconds

    console.log('[AudioService] Insight loop started');
  }

  private stopInsightLoop(): void {
    if (this.insightInterval) {
      clearInterval(this.insightInterval);
      this.insightInterval = null;
    }
  }
}

import { VirtualizedTranscriptView } from '@/components/VirtualizedTranscriptView';
import { PermissionWarning } from '@/components/PermissionWarning';
import { LiveInsightPanel } from '@/components/LiveInsightPanel';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Copy, FileText, GlobeIcon, Sparkles } from 'lucide-react';
import { useTranscripts } from '@/contexts/TranscriptContext';
import { useConfig } from '@/contexts/ConfigContext';
import { useRecordingState } from '@/contexts/RecordingStateContext';
import { usePermissionCheck } from '@/hooks/usePermissionCheck';
import { ModalType } from '@/hooks/useModalState';
import { useIsLinux } from '@/hooks/usePlatform';
import { MIN_SEGMENTS_BEFORE_FIRST_INSIGHT, useLiveInsight } from '@/hooks/useLiveInsight';
import { useMemo, useState } from 'react';

/**
 * TranscriptPanel Component
 *
 * Displays transcript content with controls for copying and language settings.
 * Uses TranscriptContext, ConfigContext, and RecordingStateContext internally.
 *
 * Also switches between the live transcript and the "Insight" tab — a
 * lightweight, real-time analysis of the in-progress transcript (see
 * `useLiveInsight`). This is separate from the post-meeting summary/report
 * pipeline and the "Tela" visual summary, which are unaffected.
 */

interface TranscriptPanelProps {
  // indicates stop-processing state for transcripts; derived from backend statuses.
  isProcessingStop: boolean;
  isStopping: boolean;
  showModal: (name: ModalType, message?: string) => void;
}

type TranscriptView = 'transcricao' | 'insight';

export function TranscriptPanel({
  isProcessingStop,
  isStopping,
  showModal
}: TranscriptPanelProps) {
  // Contexts
  const { transcripts, transcriptContainerRef, copyTranscript } = useTranscripts();
  const { transcriptModelConfig, modelConfig } = useConfig();
  const { isRecording, isPaused } = useRecordingState();
  const { checkPermissions, isChecking, hasSystemAudio, hasMicrophone } = usePermissionCheck();
  const isLinux = useIsLinux();

  const [activeView, setActiveView] = useState<TranscriptView>('transcricao');

  // Convert transcripts to segments for virtualized view
  const segments = useMemo(() =>
    transcripts.map(t => ({
      id: t.id,
      timestamp: t.audio_start_time ?? 0,
      endTime: t.audio_end_time,
      text: t.text,
      confidence: t.confidence,
    })),
    [transcripts]
  );

  // Only finalized segments feed the live insight — partial/in-progress text
  // keeps changing and would just add noise to the prompt.
  const finalizedSegments = useMemo(
    () => transcripts.filter(t => !t.is_partial).map(t => ({ text: t.text })),
    [transcripts]
  );

  const {
    insight: liveInsight,
    status: liveInsightStatus,
    error: liveInsightError,
    generateNow: generateLiveInsightNow,
  } = useLiveInsight(finalizedSegments, isRecording, isPaused, modelConfig.provider, modelConfig.model);

  return (
    <div className="w-full border-r border-gray-200 bg-white flex flex-col overflow-hidden">
      {/* Transcrição | Insight switcher */}
      <div className="flex items-center justify-center border-b border-gray-200 pb-3 pt-3">
        <Tabs value={activeView} onValueChange={(value) => setActiveView(value as TranscriptView)}>
          <TabsList>
            <TabsTrigger value="transcricao" className="gap-1.5">
              <FileText size={15} aria-hidden="true" />
              Transcrição
            </TabsTrigger>
            <TabsTrigger value="insight" className="gap-1.5">
              <Sparkles size={15} aria-hidden="true" />
              Insight
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div
        ref={transcriptContainerRef}
        className={`w-full ${activeView === 'transcricao' ? 'flex' : 'hidden'} flex-1 flex-col overflow-y-auto`}
      >
        {/* Title area - Sticky header */}
        <div className="sticky top-0 z-10 bg-white p-4 border-gray-200">
          <div className="flex flex-col space-y-3">
            <div className="flex  flex-col space-y-2">
              <div className="flex justify-center  items-center space-x-2">
                <ButtonGroup>
                  {transcripts?.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={copyTranscript}
                      title="Copiar Transcrição"
                    >
                      <Copy />
                      <span className='hidden md:inline'>
                        Copiar
                      </span>
                    </Button>
                  )}
                  {transcriptModelConfig.provider === "localWhisper" &&
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => showModal('languageSettings')}
                      title="Idioma"
                    >
                      <GlobeIcon />
                      <span className='hidden md:inline'>
                        Idioma
                      </span>
                    </Button>
                  }
                </ButtonGroup>
              </div>
            </div>
          </div>
        </div>

        {/* Permission Warning - Not needed on Linux */}
        {!isRecording && !isChecking && !isLinux && (
          <div className="flex justify-center px-4 pt-4">
            <PermissionWarning
              hasMicrophone={hasMicrophone}
              hasSystemAudio={hasSystemAudio}
              onRecheck={checkPermissions}
              isRechecking={isChecking}
            />
          </div>
        )}

        {/* Transcript content */}
        <div className="pb-20">
          <div className="flex justify-center">
            <div className="w-2/3 max-w-[750px]">
              <VirtualizedTranscriptView
                segments={segments}
                isRecording={isRecording}
                isPaused={isPaused}
                isProcessing={isProcessingStop}
                isStopping={isStopping}
                enableStreaming={isRecording}
                showConfidence={true}
              />
            </div>
          </div>
        </div>
      </div>

      <div className={`w-full ${activeView === 'insight' ? 'flex' : 'hidden'} flex-1 flex-col overflow-y-auto`}>
        <LiveInsightPanel
          insight={liveInsight}
          status={liveInsightStatus}
          error={liveInsightError}
          hasEnoughTranscript={finalizedSegments.length >= MIN_SEGMENTS_BEFORE_FIRST_INSIGHT}
          onRefresh={generateLiveInsightNow}
        />
      </div>
    </div>
  );
}

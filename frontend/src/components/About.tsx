import React, { useState, useEffect } from "react";
import { getVersion } from '@tauri-apps/api/app';
import { AmbientalLogo } from './AmbientalLogo';
import { UpdateDialog } from "./UpdateDialog";
import { updateService, UpdateInfo } from '@/services/updateService';
import { Button } from './ui/button';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';


export function About() {
    const [currentVersion, setCurrentVersion] = useState<string>('0.4.0');
    const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
    const [isChecking, setIsChecking] = useState(false);
    const [showUpdateDialog, setShowUpdateDialog] = useState(false);

    useEffect(() => {
        // Get current version on mount
        getVersion().then(setCurrentVersion).catch(console.error);
    }, []);

    const handleCheckForUpdates = async () => {
        setIsChecking(true);
        try {
            const info = await updateService.checkForUpdates(true);
            setUpdateInfo(info);
            if (info.available) {
                setShowUpdateDialog(true);
            } else {
                toast.success('Você está usando a versão mais recente');
            }
        } catch (error: any) {
            console.error('Failed to check for updates:', error);
            toast.error('Falha ao verificar atualizações: ' + (error.message || 'Erro desconhecido'));
        } finally {
            setIsChecking(false);
        }
    };

    return (
        <div className="p-4 space-y-4 h-[80vh] overflow-y-auto">
            {/* Compact Header */}
            <div className="text-center">
                <div className="mb-3">
                    <AmbientalLogo size={64} className="mx-auto" />
                </div>
                {/* <h1 className="text-xl font-bold text-gray-900">Meetily</h1> */}
                <span className="text-sm text-gray-500"> v{currentVersion}</span>
                <p className="text-medium text-gray-600 mt-1">
                    Anotações e resumos em tempo real que nunca saem da sua máquina.
                </p>
                <div className="mt-3">
                    <Button
                        onClick={handleCheckForUpdates}
                        disabled={isChecking}
                        variant="outline"
                        size="sm"
                        className="text-xs"
                    >
                        {isChecking ? (
                            <>
                                <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                                Verificando...
                            </>
                        ) : (
                            <>
                                <CheckCircle2 className="h-3 w-3 mr-2" />
                                Verificar Atualizações
                            </>
                        )}
                    </Button>
                    {updateInfo?.available && (
                        <div className="mt-2 text-xs text-blue-600">
                            Atualização disponível: v{updateInfo.version}
                        </div>
                    )}
                </div>
            </div>

            {/* Features Grid - Compact */}
            <div className="space-y-3">
                <h2 className="text-base font-semibold text-gray-800">O que torna o ReunIA diferente</h2>
                <div className="grid grid-cols-2 gap-2">
                    <div className="bg-gray-50 rounded p-3 hover:bg-gray-100 transition-colors">
                        <h3 className="font-bold text-sm text-gray-900 mb-1">Privacidade em primeiro lugar</h3>
                        <p className="text-xs text-gray-600 leading-relaxed">Seus dados e fluxo de trabalho de IA agora podem permanecer dentro da sua infraestrutura. Sem nuvem, sem vazamentos.</p>
                    </div>
                    <div className="bg-gray-50 rounded p-3 hover:bg-gray-100 transition-colors">
                        <h3 className="font-bold text-sm text-gray-900 mb-1">Use Qualquer Modelo</h3>
                        <p className="text-xs text-gray-600 leading-relaxed">Prefere um modelo local de código aberto? Ótimo. Quer conectar uma API externa? Também pode. Sem aprisionamento.</p>
                    </div>
                    <div className="bg-gray-50 rounded p-3 hover:bg-gray-100 transition-colors">
                        <h3 className="font-bold text-sm text-gray-900 mb-1">Custo Inteligente</h3>
                        <p className="text-xs text-gray-600 leading-relaxed">Evite cobranças por minuto executando modelos localmente (ou pague apenas pelas chamadas que você escolher).</p>
                    </div>
                    <div className="bg-gray-50 rounded p-3 hover:bg-gray-100 transition-colors">
                        <h3 className="font-bold text-sm text-gray-900 mb-1">Funciona em qualquer lugar</h3>
                        <p className="text-xs text-gray-600 leading-relaxed">Google Meet, Zoom, Teams — online ou offline.</p>
                    </div>
                </div>
            </div>

            {/* Coming Soon - Compact */}
            <div className="bg-blue-50 rounded p-3">
                <p className="text-s text-blue-800">
                    <span className="font-bold">Em breve:</span> Uma biblioteca de agentes de IA no dispositivo, automatizando acompanhamentos, rastreamento de ações e muito mais.
                </p>
            </div>

            {/* CTA Section - Compact */}
            <div className="text-center space-y-2 bg-ambiental-blue-soft/60 rounded-xl p-4">
                <p className="text-sm font-medium text-ambiental-text">
                    Desenvolvido para uso interno da <span className="font-semibold text-ambiental-blue">Ambiental</span>
                </p>
                <p className="text-xs text-ambiental-gray-mid">
                    Gestão de resíduos e limpeza urbana · Santa Catarina
                </p>
            </div>

            {/* Footer - Compact */}
            <div className="pt-2 border-t border-gray-200 text-center">
                <p className="text-xs text-gray-400">
                    Desenvolvido pela Ambiental
                </p>
            </div>

            {/* Update Dialog */}
            <UpdateDialog
                open={showUpdateDialog}
                onOpenChange={setShowUpdateDialog}
                updateInfo={updateInfo}
            />
        </div>

    )
}
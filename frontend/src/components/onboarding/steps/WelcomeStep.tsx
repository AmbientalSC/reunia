import React from 'react';
import { Lock, Sparkles, Cpu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { OnboardingContainer } from '../OnboardingContainer';
import { useOnboarding } from '@/contexts/OnboardingContext';

export function WelcomeStep() {
  const { goNext } = useOnboarding();

  const features = [
    {
      icon: Lock,
      title: 'Seus dados nunca saem do seu dispositivo',
    },
    {
      icon: Sparkles,
      title: 'Resumos inteligentes e insights',
    },
    {
      icon: Cpu,
      title: 'Funciona offline, sem necessidade de nuvem',
    },
  ];

  return (
    <OnboardingContainer
      title="Boas-vindas ao ReunIA"
      description="Grave. Transcreva. Resuma. Tudo no seu dispositivo."
      step={1}
      hideProgress={true}
    >
      <div className="flex flex-col items-center space-y-10">
        {/* Divider */}
        <div className="w-16 h-px bg-ambiental-green" />

        {/* Features Card */}
        <div className="w-full max-w-md bg-white rounded-xl border border-gray-100 shadow-md shadow-gray-900/5 p-6 space-y-5">
          {features.map((feature, index) => {
            const Icon = feature.icon;
            return (
              <div key={index} className="flex items-start gap-3">
                <div className="flex-shrink-0 mt-0.5">
                  <div className="w-9 h-9 rounded-lg bg-ambiental-blue-soft flex items-center justify-center">
                    <Icon className="w-4 h-4 text-ambiental-blue" />
                  </div>
                </div>
                <p className="text-sm text-ambiental-text leading-relaxed pt-2">{feature.title}</p>
              </div>
            );
          })}
        </div>

        {/* CTA Section */}
        <div className="w-full max-w-xs space-y-3">
          <Button
            onClick={goNext}
            className="w-full h-11 bg-ambiental-blue hover:bg-ambiental-blue-dark text-white shadow-md shadow-ambiental-blue/25 transition-all duration-200"
          >
            Começar
          </Button>
          <p className="text-xs text-center text-gray-500">Leva menos de 3 minutos</p>
        </div>
      </div>
    </OnboardingContainer>
  );
}

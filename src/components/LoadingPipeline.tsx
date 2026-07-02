'use client';

import { motion } from 'framer-motion';
import { FileSearch, Calculator, ShieldAlert, FileCheck } from 'lucide-react';

interface Props {
  stage: 'idle' | 'ingesting' | 'analyzing' | 'assessing' | 'reporting' | 'done';
}

const STEPS: { key: Props['stage']; label: string; detail: string; icon: typeof FileSearch }[] = [
  { key: 'ingesting', label: 'Document intake', detail: 'Reading statements and client files', icon: FileSearch },
  { key: 'analyzing', label: 'Financial signal scan', detail: 'Calculating capacity and liquidity', icon: Calculator },
  { key: 'assessing', label: 'Risk judgement', detail: 'Reviewing policy and exception markers', icon: ShieldAlert },
  { key: 'reporting', label: 'Credit memo assembly', detail: 'Preparing recommendation trail', icon: FileCheck },
];

const STAGE_INDEX: Record<Props['stage'], number> = {
  idle: -1,
  ingesting: 0,
  analyzing: 1,
  assessing: 2,
  reporting: 3,
  done: 4,
};

export default function LoadingPipeline({ stage }: Props) {
  const currentIndex = STAGE_INDEX[stage];

  if (currentIndex < 0) return null;

  return (
    <motion.div
      className="rfm-pipeline"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
    >
      <div className="rfm-pipeline-brand" aria-hidden="true">
        {['R', 'F', 'M'].map((letter, index) => (
          <motion.span
            key={letter}
            animate={{ opacity: [0.58, 1, 0.7], y: [0, -2, 0] }}
            transition={{ repeat: Infinity, repeatType: 'mirror', duration: 1.5, delay: index * 0.18 }}
          >
            {letter}
          </motion.span>
        ))}
      </div>

      <div className="rfm-pipeline-track">
        {STEPS.map((step, index) => {
          const isActive = index === currentIndex;
          const isComplete = index < currentIndex;
          const Icon = step.icon;

          return (
            <motion.div
              key={step.key}
              className={`rfm-pipeline-step ${isActive ? 'active' : ''} ${isComplete ? 'complete' : ''}`}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.08 }}
            >
              {index < STEPS.length - 1 && (
                <div className="rfm-pipeline-line" aria-hidden="true">
                  <motion.div
                    initial={{ scaleY: 0 }}
                    animate={{ scaleY: isComplete ? 1 : 0 }}
                    transition={{ duration: 0.3 }}
                  />
                </div>
              )}

              <motion.div
                className="rfm-pipeline-icon"
                animate={{ scale: isActive ? [1, 1.08, 1] : 1 }}
                transition={{ scale: { repeat: isActive ? Infinity : 0, duration: 1.5 } }}
              >
                <Icon className="w-5 h-5" />
                {isComplete && (
                  <motion.div
                    className="rfm-pipeline-check"
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                  >
                    <svg className="w-2 h-2 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={4}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </motion.div>
                )}
              </motion.div>

              <div className="rfm-pipeline-text">
                <p>{step.label}</p>
                {isActive && (
                  <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                    {step.detail}
                  </motion.p>
                )}
                {isComplete && <p>Cleared</p>}
              </div>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}

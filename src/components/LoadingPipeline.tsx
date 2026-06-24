'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { FileSearch, Calculator, ShieldAlert, FileCheck } from 'lucide-react';

interface Props {
  stage: 'idle' | 'ingesting' | 'analyzing' | 'assessing' | 'reporting' | 'done';
}

const STEPS = [
  { key: 'ingesting', label: 'Reading Document', icon: FileSearch },
  { key: 'analyzing', label: 'Crunching Numbers', icon: Calculator },
  { key: 'assessing', label: 'Assessing Risk', icon: ShieldAlert },
  { key: 'reporting', label: 'Generating Report', icon: FileCheck },
] as const;

const STAGE_INDEX: Record<string, number> = {
  idle: -1,
  ingesting: 0,
  analyzing: 1,
  assessing: 2,
  reporting: 3,
  done: 4,
};

export default function LoadingPipeline({ stage }: Props) {
  const currentIndex = STAGE_INDEX[stage] ?? -1;

  if (currentIndex < 0) return null;

  return (
    <div className="w-full max-w-xl mx-auto">
      <div className="space-y-0">
        {STEPS.map((step, i) => {
          const isActive = i === currentIndex;
          const isComplete = i < currentIndex;
          const isPending = i > currentIndex;
          const Icon = step.icon;

          return (
            <motion.div
              key={step.key}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.15 }}
              className="relative flex items-center gap-4 py-3"
            >
              {/* connector line */}
              {i < STEPS.length - 1 && (
                <div className="absolute left-[18px] top-12 w-0.5 h-6">
                  <motion.div
                    className="h-full bg-blue-500 origin-top"
                    initial={{ scaleY: 0 }}
                    animate={{ scaleY: isComplete ? 1 : 0 }}
                    transition={{ duration: 0.3 }}
                  />
                  <div className="absolute inset-0 bg-slate-700 -z-10" />
                </div>
              )}

              {/* icon */}
              <motion.div
                animate={{
                  scale: isActive ? [1, 1.1, 1] : 1,
                  backgroundColor: isComplete
                    ? 'rgba(59, 130, 246, 0.2)'
                    : isActive
                      ? 'rgba(59, 130, 246, 0.15)'
                      : 'rgba(51, 65, 85, 0.5)',
                }}
                transition={{ scale: { repeat: isActive ? Infinity : 0, duration: 1.5 } }}
                className={`relative p-2 rounded-lg z-10 ${
                  isComplete ? 'text-blue-400' : isActive ? 'text-blue-400' : 'text-slate-600'
                }`}
              >
                <Icon className="w-5 h-5" />
                {isComplete && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-green-500 rounded-full flex items-center justify-center"
                  >
                    <svg className="w-2 h-2 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={4}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </motion.div>
                )}
              </motion.div>

              {/* label */}
              <div className="flex-1">
                <p
                  className={`text-sm font-medium transition-colors ${
                    isComplete
                      ? 'text-blue-300'
                      : isActive
                        ? 'text-slate-200'
                        : 'text-slate-600'
                  }`}
                >
                  {step.label}
                </p>
                {isActive && (
                  <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-xs text-slate-500 mt-0.5"
                  >
                    In progress...
                  </motion.p>
                )}
                {isComplete && (
                  <p className="text-xs text-green-600 mt-0.5">Complete</p>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

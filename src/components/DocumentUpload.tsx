'use client';

import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, FileText } from 'lucide-react';

interface Props {
  onUpload: (data: string, fileName: string) => void;
  disabled?: boolean;
}

export default function DocumentUpload({ onUpload, disabled }: Props) {
  const [error, setError] = useState<string | null>(null);

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      setError(null);
      const file = acceptedFiles[0];
      if (!file) return;

      const ext = file.name.split('.').pop()?.toLowerCase();
      if (!ext || !['json', 'csv', 'xlsx', 'txt'].includes(ext)) {
        setError('Unsupported format. Please upload JSON, CSV, or TXT.');
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        onUpload(reader.result as string, file.name);
      };
      reader.onerror = () => {
        setError('Failed to read file.');
      };
      reader.readAsText(file);
    },
    [onUpload],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    disabled,
    maxFiles: 1,
    accept: {
      'application/json': ['.json'],
      'text/csv': ['.csv'],
      'text/plain': ['.txt'],
    },
  });

  return (
    <div className="w-full max-w-xl mx-auto">
      <div
        {...getRootProps()}
        className={`relative flex flex-col items-center justify-center p-12 border-2 border-dashed rounded-2xl transition-all duration-300 cursor-pointer
          ${isDragActive
            ? 'border-blue-400 bg-blue-500/10 scale-[1.02]'
            : 'border-slate-700 bg-slate-900/50 hover:border-blue-500/50 hover:bg-slate-800/50'
          }
          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
        `}
      >
        <input {...getInputProps()} />
        <div className="flex flex-col items-center gap-4 text-center">
          <div className={`p-4 rounded-full ${isDragActive ? 'bg-blue-500/20' : 'bg-slate-800'}`}>
            <Upload className={`w-8 h-8 ${isDragActive ? 'text-blue-400' : 'text-slate-400'}`} />
          </div>
          <div>
            <p className="text-lg font-semibold text-slate-200">
              {isDragActive ? 'Drop your file here' : 'Upload Customer Data'}
            </p>
            <p className="text-sm text-slate-400 mt-1">
              Drag & drop a JSON, CSV, or TXT file
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <FileText className="w-3 h-3" />
            Supported: .json, .csv, .txt
          </div>
        </div>
      </div>
      {error && (
        <p className="mt-3 text-sm text-red-400 text-center">{error}</p>
      )}
    </div>
  );
}

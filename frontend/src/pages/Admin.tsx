import { useState, type ReactNode } from 'react';
import { RefreshCw, Wrench } from 'lucide-react';
import { api } from '@/lib/api';

export default function Admin() {
  const [processing, setProcessing] = useState<string | null>(null);

  async function handleProcessDocuments() {
    setProcessing('documents');
    try {
      const result = await api.processDocuments();
      alert(`Processed ${result.processed} documents`);
    } catch (err) {
      alert(`Error: ${err}`);
    } finally {
      setProcessing(null);
    }
  }

  async function handleProcessCalendar() {
    setProcessing('calendar');
    try {
      const result = await api.processCalendar();
      alert(`Found ${result.processed} calendar events with medical appointments`);
    } catch (err) {
      alert(`Error: ${err}`);
    } finally {
      setProcessing(null);
    }
  }

  async function handleRunMatching() {
    setProcessing('matching');
    try {
      const result = await api.runMatching();
      alert(`Created ${result.created} match candidates`);
    } catch (err) {
      alert(`Error: ${err}`);
    } finally {
      setProcessing(null);
    }
  }

  return (
    <div className="p-8">
      <div className="flex items-center gap-3 mb-6">
        <Wrench size={24} />
        <h1 className="text-3xl font-bold bauhaus-accent">Advanced Administration</h1>
      </div>

      <div className="bg-white border-2 border-bauhaus-black p-6 mb-6">
        <p className="text-sm text-bauhaus-gray mb-4">
          Background scanning runs every 3 hours and processes full history.
          Use these actions only for manual troubleshooting.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <ActionButton
            onClick={handleProcessDocuments}
            disabled={processing !== null}
          >
            {processing === 'documents' ? 'Scanning...' : 'Scan Email Attachments'}
          </ActionButton>
          <ActionButton
            onClick={handleProcessCalendar}
            disabled={processing !== null}
          >
            {processing === 'calendar' ? 'Searching...' : 'Scan Calendar Events'}
          </ActionButton>
          <ActionButton
            onClick={handleRunMatching}
            disabled={processing !== null}
          >
            {processing === 'matching' ? 'Matching...' : 'Run Auto-Matching'}
          </ActionButton>
        </div>

        <div className="mt-6 flex items-center gap-2 text-sm text-bauhaus-gray">
          <RefreshCw size={14} />
          Background jobs keep data fresh daily.
        </div>
      </div>
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  disabled
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={
        "px-4 py-3 bg-bauhaus-black text-white font-medium transition-colors text-left " +
        (disabled ? "opacity-50 cursor-not-allowed" : "hover:bg-bauhaus-gray")
      }
    >
      {children}
    </button>
  );
}

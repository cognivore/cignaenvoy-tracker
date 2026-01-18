import { useState, useEffect } from 'react';
import { Heart, RefreshCw, Inbox, Calendar, User, FileText } from 'lucide-react';
import { cn, formatDate } from '@/lib/utils';
import { EmptyState, LoadingSpinner, DetailRow } from '@/components';
import { api, type Illness, type Patient } from '@/lib/api';
import { useUnseenList } from '@/lib/useUnseenList';

const typeColors: Record<string, string> = {
  acute: 'bg-bauhaus-yellow text-bauhaus-black',
  chronic: 'bg-bauhaus-red',
};

export default function ArchivedIllnesses() {
  const {
    items: illnesses,
    loading,
    refresh,
    removeItem,
  } = useUnseenList<Illness>({
    fetcher: api.getArchivedIllnesses,
    cacheKey: 'archived-illnesses',
    sortFn: (a, b) => new Date(b.archivedAt!).getTime() - new Date(a.archivedAt!).getTime(),
  });

  const [patients, setPatients] = useState<Record<string, Patient>>({});
  const [selectedIllness, setSelectedIllness] = useState<Illness | null>(null);
  const [unarchiving, setUnarchiving] = useState(false);

  // Load patients for display
  useEffect(() => {
    const loadPatients = async () => {
      try {
        const all = await api.getPatients();
        const map: Record<string, Patient> = {};
        for (const p of all) {
          map[p.id] = p;
        }
        setPatients(map);
      } catch (err) {
        console.error('Failed to load patients:', err);
      }
    };
    loadPatients();
  }, []);

  async function handleUnarchive(illness: Illness) {
    setUnarchiving(true);
    try {
      await api.setIllnessArchived(illness.id, false);
      removeItem(illness.id);
      if (selectedIllness?.id === illness.id) {
        setSelectedIllness(null);
      }
    } catch (err) {
      console.error('Failed to unarchive illness:', err);
      alert(`Error: ${err}`);
    } finally {
      setUnarchiving(false);
    }
  }

  const getPatientName = (patientId: string) => {
    return patients[patientId]?.name || 'Unknown Patient';
  };

  if (loading && illnesses.length === 0) {
    return (
      <div className="p-8 flex justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold bauhaus-accent">Archived Illnesses</h1>
        <button
          onClick={refresh}
          className="bauhaus-button-secondary flex items-center gap-2"
        >
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>

      {illnesses.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="No archived illnesses"
          message="Illnesses you archive will appear here."
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Illnesses List */}
          <div className="space-y-2 max-h-[calc(100vh-200px)] overflow-y-auto">
            {illnesses.map((illness) => {
              const isSelected = selectedIllness?.id === illness.id;

              return (
                <div
                  key={illness.id}
                  onClick={() => setSelectedIllness(illness)}
                  className={cn(
                    'bauhaus-card cursor-pointer transition-all flex items-start gap-4',
                    isSelected && 'ring-2 ring-bauhaus-blue'
                  )}
                >
                  <div className="p-2 bg-bauhaus-lightgray rounded">
                    <Heart size={20} className="text-bauhaus-gray" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={cn('px-2 py-0.5 text-xs font-medium rounded', typeColors[illness.type])}>
                        {illness.type.toUpperCase()}
                      </span>
                    </div>
                    <h3 className="font-medium">{illness.name}</h3>
                    <p className="text-sm text-bauhaus-gray">{getPatientName(illness.patientId)}</p>
                    <p className="text-xs text-bauhaus-gray mt-1">
                      Archived: {formatDate(illness.archivedAt!)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Detail Panel */}
          {selectedIllness && (
            <div className="bauhaus-card h-fit sticky top-8">
              <div className="flex items-center justify-between mb-4">
                <span className={cn(
                  'px-2 py-1 text-xs font-medium rounded',
                  typeColors[selectedIllness.type]
                )}>
                  {selectedIllness.type.toUpperCase()}
                </span>
                <button
                  onClick={() => handleUnarchive(selectedIllness)}
                  disabled={unarchiving}
                  className="bauhaus-button-secondary flex items-center gap-2 text-sm"
                >
                  <Inbox size={14} />
                  {unarchiving ? 'Restoring...' : 'Restore'}
                </button>
              </div>

              <h2 className="text-xl font-bold mb-4">{selectedIllness.name}</h2>

              <div className="space-y-3">
                <DetailRow
                  icon={User}
                  label="Patient"
                  value={getPatientName(selectedIllness.patientId)}
                />
                {selectedIllness.icdCode && (
                  <DetailRow
                    icon={FileText}
                    label="ICD Code"
                    value={selectedIllness.icdCode}
                  />
                )}
                {selectedIllness.onsetDate && (
                  <DetailRow
                    icon={Calendar}
                    label="Onset Date"
                    value={formatDate(selectedIllness.onsetDate)}
                  />
                )}
                {selectedIllness.resolvedDate && (
                  <DetailRow
                    icon={Calendar}
                    label="Resolved Date"
                    value={formatDate(selectedIllness.resolvedDate)}
                  />
                )}
                {selectedIllness.notes && (
                  <div className="pt-3 border-t border-bauhaus-lightgray">
                    <p className="text-sm font-medium mb-1">Notes</p>
                    <p className="text-sm text-bauhaus-gray">{selectedIllness.notes}</p>
                  </div>
                )}
                {selectedIllness.relevantAccounts.length > 0 && (
                  <div className="pt-3 border-t border-bauhaus-lightgray">
                    <p className="text-sm font-medium mb-2">Relevant Accounts</p>
                    <div className="space-y-1">
                      {selectedIllness.relevantAccounts.map((account, idx) => (
                        <p key={idx} className="text-sm text-bauhaus-gray">
                          {account.name ? `${account.name} <${account.email}>` : account.email}
                          {account.role && <span className="ml-2 text-xs">({account.role})</span>}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
                {selectedIllness.archivedAt && (
                  <div className="pt-3 border-t border-bauhaus-lightgray">
                    <p className="text-sm text-bauhaus-gray">
                      Archived: {formatDate(selectedIllness.archivedAt)}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

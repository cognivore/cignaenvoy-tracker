import { useState } from 'react';
import { Users, RefreshCw, Inbox, Calendar, Mail, MapPin } from 'lucide-react';
import { cn, formatDate } from '@/lib/utils';
import { EmptyState, LoadingSpinner, DetailRow } from '@/components';
import { api, type Patient } from '@/lib/api';
import { useUnseenList } from '@/lib/useUnseenList';

const relationshipColors: Record<string, string> = {
  Employee: 'bg-bauhaus-blue',
  Member: 'bg-green-600',
  Beneficiary: 'bg-purple-600',
};

export default function ArchivedPatients() {
  const {
    items: patients,
    loading,
    refresh,
    removeItem,
  } = useUnseenList<Patient>({
    fetcher: api.getArchivedPatients,
    cacheKey: 'archived-patients',
    sortFn: (a, b) => new Date(b.archivedAt!).getTime() - new Date(a.archivedAt!).getTime(),
  });

  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [unarchiving, setUnarchiving] = useState(false);

  async function handleUnarchive(patient: Patient) {
    setUnarchiving(true);
    try {
      await api.setPatientArchived(patient.id, false);
      removeItem(patient.id);
      if (selectedPatient?.id === patient.id) {
        setSelectedPatient(null);
      }
    } catch (err) {
      console.error('Failed to unarchive patient:', err);
      alert(`Error: ${err}`);
    } finally {
      setUnarchiving(false);
    }
  }

  if (loading && patients.length === 0) {
    return (
      <div className="p-8 flex justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold bauhaus-accent">Archived Patients</h1>
        <button
          onClick={refresh}
          className="bauhaus-button-secondary flex items-center gap-2"
        >
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>

      {patients.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="No archived patients"
          message="Patients you archive will appear here."
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Patients List */}
          <div className="space-y-2 max-h-[calc(100vh-200px)] overflow-y-auto">
            {patients.map((patient) => {
              const isSelected = selectedPatient?.id === patient.id;

              return (
                <div
                  key={patient.id}
                  onClick={() => setSelectedPatient(patient)}
                  className={cn(
                    'bauhaus-card cursor-pointer transition-all flex items-start gap-4',
                    isSelected && 'ring-2 ring-bauhaus-blue'
                  )}
                >
                  <div className="p-2 bg-bauhaus-lightgray rounded">
                    <Users size={20} className="text-bauhaus-gray" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={cn('px-2 py-0.5 text-xs font-medium text-white rounded', relationshipColors[patient.relationship])}>
                        {patient.relationship}
                      </span>
                    </div>
                    <h3 className="font-medium">{patient.name}</h3>
                    <p className="text-sm text-bauhaus-gray">Cigna ID: {patient.cignaId}</p>
                    <p className="text-xs text-bauhaus-gray mt-1">
                      Archived: {formatDate(patient.archivedAt!)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Detail Panel */}
          {selectedPatient && (
            <div className="bauhaus-card h-fit sticky top-8">
              <div className="flex items-center justify-between mb-4">
                <span className={cn(
                  'px-2 py-1 text-xs font-medium text-white rounded',
                  relationshipColors[selectedPatient.relationship]
                )}>
                  {selectedPatient.relationship}
                </span>
                <button
                  onClick={() => handleUnarchive(selectedPatient)}
                  disabled={unarchiving}
                  className="bauhaus-button-secondary flex items-center gap-2 text-sm"
                >
                  <Inbox size={14} />
                  {unarchiving ? 'Restoring...' : 'Restore'}
                </button>
              </div>

              <h2 className="text-xl font-bold mb-4">{selectedPatient.name}</h2>

              <div className="space-y-3">
                <DetailRow
                  label="Cigna ID"
                  value={selectedPatient.cignaId}
                />
                <DetailRow
                  icon={Calendar}
                  label="Date of Birth"
                  value={formatDate(selectedPatient.dateOfBirth)}
                />
                {selectedPatient.email && (
                  <DetailRow
                    icon={Mail}
                    label="Email"
                    value={selectedPatient.email}
                  />
                )}
                {selectedPatient.citizenship && (
                  <DetailRow
                    icon={MapPin}
                    label="Citizenship"
                    value={selectedPatient.citizenship}
                  />
                )}
                {selectedPatient.workLocation && (
                  <DetailRow
                    icon={MapPin}
                    label="Work Location"
                    value={selectedPatient.workLocation}
                  />
                )}
                {selectedPatient.archivedAt && (
                  <div className="pt-3 border-t border-bauhaus-lightgray">
                    <p className="text-sm text-bauhaus-gray">
                      Archived: {formatDate(selectedPatient.archivedAt)}
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

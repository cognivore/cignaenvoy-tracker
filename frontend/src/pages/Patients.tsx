import { useState, useEffect, useMemo, useRef } from 'react';
import {
  User,
  Plus,
  RefreshCw,
  Calendar,
  Mail,
  Heart,
  ChevronRight,
  X,
  Edit,
  Archive
} from 'lucide-react';
import { cn, formatDate } from '@/lib/utils';
import { LoadingSpinner, UnseenDivider } from '@/components';
import {
  api,
  type Patient,
  type Illness,
  type CreatePatientInput,
  type CreateIllnessInput
} from '@/lib/api';
import { useUnseenList } from '@/lib/useUnseenList';
import { useUnseenDivider } from '@/lib/useUnseenDivider';

type RelationshipType = 'Employee' | 'Member' | 'Beneficiary';
type IllnessType = 'acute' | 'chronic';

export default function Patients() {
  const {
    items: patients,
    loading,
    unseenIds,
    refresh: refreshPatients,
    markAllSeen,
    applyLocalUpdate,
    upsertItem,
    removeItem,
  } = useUnseenList<Patient>({
    fetcher: async () => {
      const all = await api.getPatients();
      return all.filter((patient) => !patient.archivedAt);
    },
    cacheKey: 'patients',
  });
  const [archiving, setArchiving] = useState(false);

  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [patientIllnesses, setPatientIllnesses] = useState<Illness[]>([]);
  const [loadingIllnesses, setLoadingIllnesses] = useState(false);
  const dividerRef = useRef<HTMLDivElement | null>(null);

  // Forms
  const [showPatientForm, setShowPatientForm] = useState(false);
  const [showIllnessForm, setShowIllnessForm] = useState(false);
  const [editingPatient, setEditingPatient] = useState<Patient | null>(null);

  // Selected illness for detail view
  const [selectedIllness, setSelectedIllness] = useState<Illness | null>(null);

  // Track selectedPatient.id to avoid reload loops when patient object reference changes
  const selectedPatientId = selectedPatient?.id;

  useEffect(() => {
    if (selectedPatientId) {
      loadPatientIllnesses(selectedPatientId);
    } else {
      setPatientIllnesses([]);
      setSelectedIllness(null);
    }
  }, [selectedPatientId]); // Only re-run when ID changes, not object reference

  useEffect(() => {
    if (!selectedPatientId) return;
    const updated = patients.find((patient) => patient.id === selectedPatientId);
    if (updated && updated !== selectedPatient) {
      setSelectedPatient(updated);
    }
  }, [patients, selectedPatientId]); // Use ID, not object reference

  async function handleUpdateIllness(
    illnessId: string,
    updates: Partial<CreateIllnessInput>
  ) {
    try {
      const updated = await api.updateIllness(illnessId, updates);
      setPatientIllnesses((prev) =>
        prev.map((illness) => (illness.id === illnessId ? updated : illness))
      );
      setSelectedIllness(updated);
      return updated;
    } catch (err) {
      console.error('Failed to update illness:', err);
      throw err;
    }
  }

  async function loadPatientIllnesses(patientId: string) {
    setLoadingIllnesses(true);
    try {
      const data = await api.getPatientIllnesses(patientId);
      setPatientIllnesses(data);
    } catch (err) {
      console.error('Failed to load illnesses:', err);
    } finally {
      setLoadingIllnesses(false);
    }
  }

  async function handleCreatePatient(input: CreatePatientInput) {
    try {
      const newPatient = await api.createPatient(input);
      applyLocalUpdate((prev) => [...prev, newPatient]);
      setShowPatientForm(false);
      setSelectedPatient(newPatient);
    } catch (err) {
      console.error('Failed to create patient:', err);
      alert(`Error: ${err}`);
    }
  }

  async function handleUpdatePatient(id: string, updates: Partial<CreatePatientInput>) {
    try {
      const updated = await api.updatePatient(id, updates);
      upsertItem(updated);
      setEditingPatient(null);
      if (selectedPatient?.id === id) {
        setSelectedPatient(updated);
      }
    } catch (err) {
      console.error('Failed to update patient:', err);
      alert(`Error: ${err}`);
    }
  }

  async function handleCreateIllness(input: CreateIllnessInput) {
    try {
      const newIllness = await api.createIllness(input);
      setPatientIllnesses([...patientIllnesses, newIllness]);
      setShowIllnessForm(false);
    } catch (err) {
      console.error('Failed to create illness:', err);
      alert(`Error: ${err}`);
    }
  }

  async function handleArchivePatient() {
    if (!selectedPatient) return;
    setArchiving(true);
    try {
      await api.setPatientArchived(selectedPatient.id, true);
      removeItem(selectedPatient.id);
      setSelectedPatient(null);
    } catch (err) {
      console.error('Failed to archive patient:', err);
      alert(`Error: ${err}`);
    } finally {
      setArchiving(false);
    }
  }

  const relationshipColors: Record<RelationshipType, string> = {
    Employee: 'bg-bauhaus-blue text-white',
    Member: 'bg-bauhaus-yellow text-bauhaus-black',
    Beneficiary: 'bg-bauhaus-red text-white',
  };

  const illnessTypeColors: Record<IllnessType, string> = {
    chronic: 'bg-bauhaus-red/10 text-bauhaus-red border border-bauhaus-red',
    acute: 'bg-bauhaus-yellow/10 text-bauhaus-black border border-bauhaus-yellow',
  };

  const patientSections = useMemo(() => {
    const unseenPatients = patients.filter((patient) => unseenIds.has(patient.id));
    const seenPatients = patients.filter((patient) => !unseenIds.has(patient.id));
    return {
      unseenPatients,
      seenPatients,
      hasVisibleUnseen: unseenPatients.length > 0,
    };
  }, [patients, unseenIds]);

  useUnseenDivider({
    dividerRef,
    onSeen: markAllSeen,
    active: patientSections.hasVisibleUnseen,
    deps: [patients],
  });

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold bauhaus-accent">Patients</h1>
          <p className="text-bauhaus-gray mt-1">Manage patient personas and their conditions</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowPatientForm(true)}
            className="flex items-center gap-2 px-4 py-2 bg-bauhaus-blue text-white font-medium hover:bg-bauhaus-blue/90 transition-colors"
          >
            <Plus size={18} />
            Add Patient
          </button>
          <button
            onClick={refreshPatients}
            className="flex items-center gap-2 px-4 py-2 bg-bauhaus-black text-white font-medium hover:bg-bauhaus-gray transition-colors"
          >
            <RefreshCw size={18} />
            Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : patients.length === 0 ? (
        <EmptyState onAdd={() => setShowPatientForm(true)} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Patients list */}
          <div className="space-y-4">
            <h2 className="font-bold text-lg flex items-center gap-2">
              <User size={20} />
              Patients ({patients.length})
            </h2>
            {patientSections.unseenPatients.map((patient) => (
              <div
                key={patient.id}
                onClick={() => {
                  setSelectedPatient(patient);
                  setSelectedIllness(null);
                }}
                className={cn(
                  'bauhaus-card cursor-pointer transition-all',
                  selectedPatient?.id === patient.id && 'ring-2 ring-bauhaus-blue'
                )}
              >
                <div className="flex items-start justify-between mb-3">
                  <span className={cn(
                    'inline-block px-2 py-1 text-xs font-medium',
                    relationshipColors[patient.relationship]
                  )}>
                    {patient.relationship}
                  </span>
                  <span className="text-xs text-bauhaus-gray">
                    ID: {patient.cignaId}
                  </span>
                </div>
                <h3 className="font-bold text-lg mb-2">{patient.name}</h3>
                <div className="space-y-1 text-sm text-bauhaus-gray">
                  {patient.dateOfBirth && (
                    <div className="flex items-center gap-2">
                      <Calendar size={14} />
                      <span>Born {formatDate(patient.dateOfBirth)}</span>
                    </div>
                  )}
                  {patient.email && (
                    <div className="flex items-center gap-2">
                      <Mail size={14} />
                      <span>{patient.email}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
            <UnseenDivider
              ref={dividerRef}
              visible={patientSections.hasVisibleUnseen}
              label="Unseen"
            />
            {patientSections.seenPatients.map((patient) => (
              <div
                key={patient.id}
                onClick={() => {
                  setSelectedPatient(patient);
                  setSelectedIllness(null);
                }}
                className={cn(
                  'bauhaus-card cursor-pointer transition-all',
                  selectedPatient?.id === patient.id && 'ring-2 ring-bauhaus-blue'
                )}
              >
                <div className="flex items-start justify-between mb-3">
                  <span className={cn(
                    'inline-block px-2 py-1 text-xs font-medium',
                    relationshipColors[patient.relationship]
                  )}>
                    {patient.relationship}
                  </span>
                  <span className="text-xs text-bauhaus-gray">
                    ID: {patient.cignaId}
                  </span>
                </div>
                <h3 className="font-bold text-lg mb-2">{patient.name}</h3>
                <div className="space-y-1 text-sm text-bauhaus-gray">
                  {patient.dateOfBirth && (
                    <div className="flex items-center gap-2">
                      <Calendar size={14} />
                      <span>Born {formatDate(patient.dateOfBirth)}</span>
                    </div>
                  )}
                  {patient.email && (
                    <div className="flex items-center gap-2">
                      <Mail size={14} />
                      <span>{patient.email}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Patient detail + illnesses */}
          {selectedPatient && (
            <div className="lg:col-span-2 space-y-6">
              {/* Patient details */}
              <div className="bauhaus-card">
                <div className="flex items-start justify-between mb-4">
                  <h2 className="text-xl font-bold">{selectedPatient.name}</h2>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setEditingPatient(selectedPatient)}
                      className="p-2 text-bauhaus-gray hover:text-bauhaus-black transition-colors"
                    >
                      <Edit size={18} />
                    </button>
                    <button
                      onClick={handleArchivePatient}
                      disabled={archiving}
                      className={cn(
                        'p-2 border border-bauhaus-red text-bauhaus-red hover:bg-bauhaus-lightgray transition-colors',
                        archiving && 'opacity-60 cursor-not-allowed'
                      )}
                      title="Archive"
                    >
                      <Archive size={18} />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-6">
                  <DetailRow label="Cigna ID" value={selectedPatient.cignaId} />
                  <DetailRow label="Relationship" value={selectedPatient.relationship} />
                  <DetailRow label="Date of Birth" value={formatDate(selectedPatient.dateOfBirth)} />
                  {selectedPatient.citizenship && (
                    <DetailRow label="Citizenship" value={selectedPatient.citizenship} />
                  )}
                  {selectedPatient.workLocation && (
                    <DetailRow label="Work Location" value={selectedPatient.workLocation} />
                  )}
                  {selectedPatient.email && (
                    <DetailRow label="Email" value={selectedPatient.email} />
                  )}
                </div>

                {/* Illnesses section */}
                <div className="border-t-2 border-bauhaus-black pt-4">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-bold flex items-center gap-2">
                      <Heart size={18} />
                      Illnesses & Conditions
                    </h3>
                    <button
                      onClick={() => setShowIllnessForm(true)}
                      className="flex items-center gap-1 px-3 py-1 text-sm bg-bauhaus-black text-white hover:bg-bauhaus-gray transition-colors"
                    >
                      <Plus size={14} />
                      Add Illness
                    </button>
                  </div>

                  {loadingIllnesses ? (
                    <div className="flex justify-center py-8">
                      <div className="w-6 h-6 border-2 border-bauhaus-blue border-t-transparent rounded-full animate-spin" />
                    </div>
                  ) : patientIllnesses.length === 0 ? (
                    <p className="text-bauhaus-gray text-center py-6">
                      No illnesses registered for this patient
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {patientIllnesses.map((illness) => (
                        <div
                          key={illness.id}
                          onClick={() => setSelectedIllness(illness)}
                          className={cn(
                            'p-3 border-2 cursor-pointer transition-all flex items-center justify-between',
                            selectedIllness?.id === illness.id
                              ? 'border-bauhaus-blue bg-bauhaus-blue/5'
                              : 'border-bauhaus-lightgray hover:border-bauhaus-gray'
                          )}
                        >
                          <div className="flex items-center gap-3">
                            <span className={cn(
                              'px-2 py-0.5 text-xs font-medium',
                              illnessTypeColors[illness.type]
                            )}>
                              {illness.type}
                            </span>
                            <span className="font-medium">{illness.name}</span>
                            {illness.icdCode && (
                              <span className="text-xs text-bauhaus-gray">
                                ({illness.icdCode})
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            {illness.relevantAccounts.length > 0 && (
                              <span className="text-xs text-bauhaus-gray">
                                {illness.relevantAccounts.length} accounts
                              </span>
                            )}
                            <ChevronRight size={16} className="text-bauhaus-gray" />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Selected illness detail */}
              {selectedIllness && (
                <IllnessDetail
                  illness={selectedIllness}
                  onClose={() => setSelectedIllness(null)}
                  onUpdate={handleUpdateIllness}
                />
              )}
            </div>
          )}
        </div>
      )}

      {/* Patient form modal */}
      {(showPatientForm || editingPatient) && (
        <PatientFormModal
          patient={editingPatient}
          onSave={editingPatient
            ? (data) => handleUpdatePatient(editingPatient.id, data)
            : handleCreatePatient
          }
          onClose={() => {
            setShowPatientForm(false);
            setEditingPatient(null);
          }}
        />
      )}

      {/* Illness form modal */}
      {showIllnessForm && selectedPatient && (
        <IllnessFormModal
          patientId={selectedPatient.id}
          patientName={selectedPatient.name}
          onSave={handleCreateIllness}
          onClose={() => setShowIllnessForm(false)}
        />
      )}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="py-2 border-b border-bauhaus-lightgray">
      <span className="text-xs text-bauhaus-gray uppercase tracking-wide">{label}</span>
      <p className="font-medium">{value}</p>
    </div>
  );
}

function IllnessDetail({
  illness,
  onClose,
  onUpdate,
}: {
  illness: Illness;
  onClose: () => void;
  onUpdate: (id: string, updates: Partial<CreateIllnessInput>) => Promise<Illness>;
}) {
  const roleColors: Record<string, string> = {
    provider: 'bg-bauhaus-blue/10 text-bauhaus-blue',
    pharmacy: 'bg-green-100 text-green-700',
    lab: 'bg-purple-100 text-purple-700',
    insurance: 'bg-bauhaus-yellow/20 text-bauhaus-black',
    other: 'bg-bauhaus-lightgray text-bauhaus-gray',
  };
  const [cignaSymptom, setCignaSymptom] = useState(illness.cignaSymptom ?? '');
  const [cignaDescription, setCignaDescription] = useState(illness.cignaDescription ?? '');
  const [savingMapping, setSavingMapping] = useState(false);
  const [mappingError, setMappingError] = useState<string | null>(null);

  useEffect(() => {
    setCignaSymptom(illness.cignaSymptom ?? '');
    setCignaDescription(illness.cignaDescription ?? '');
    setMappingError(null);
  }, [illness.id, illness.cignaSymptom, illness.cignaDescription]);

  async function handleSaveMapping() {
    setSavingMapping(true);
    setMappingError(null);
    try {
      const trimmedSymptom = cignaSymptom.trim();
      const trimmedDescription = cignaDescription.trim();
      await onUpdate(illness.id, {
        cignaSymptom: trimmedSymptom || undefined,
        cignaDescription: trimmedDescription || undefined,
      });
    } catch (err) {
      setMappingError('Failed to save Cigna mapping.');
    } finally {
      setSavingMapping(false);
    }
  }

  return (
    <div className="bauhaus-card">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-lg font-bold">{illness.name}</h3>
          {illness.icdCode && (
            <span className="text-sm text-bauhaus-gray">ICD: {illness.icdCode}</span>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-1 text-bauhaus-gray hover:text-bauhaus-black"
        >
          <X size={18} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div>
          <span className="text-xs text-bauhaus-gray uppercase">Type</span>
          <p className="font-medium capitalize">{illness.type}</p>
        </div>
        {illness.onsetDate && (
          <div>
            <span className="text-xs text-bauhaus-gray uppercase">Onset</span>
            <p className="font-medium">{formatDate(illness.onsetDate)}</p>
          </div>
        )}
        {illness.resolvedDate && (
          <div>
            <span className="text-xs text-bauhaus-gray uppercase">Resolved</span>
            <p className="font-medium">{formatDate(illness.resolvedDate)}</p>
          </div>
        )}
      </div>

      {illness.notes && (
        <div className="mb-6">
          <span className="text-xs text-bauhaus-gray uppercase">Notes</span>
          <p className="mt-1 text-sm">{illness.notes}</p>
        </div>
      )}

      <div className="border-t-2 border-bauhaus-black pt-4 mb-6">
        <h4 className="font-bold mb-3 flex items-center gap-2">
          <Heart size={16} />
          Cigna Mapping
        </h4>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-bauhaus-gray uppercase mb-1">
              Cigna Symptom (exact option)
            </label>
            <input
              type="text"
              value={cignaSymptom}
              onChange={(e) => setCignaSymptom(e.target.value)}
              className="w-full p-2 border-2 border-bauhaus-black focus:outline-none focus:ring-2 focus:ring-bauhaus-blue"
              placeholder="e.g., TIRED OR WEAK"
            />
          </div>
          <div>
            <label className="block text-xs text-bauhaus-gray uppercase mb-1">
              Cigna Diagnosis (exact option)
            </label>
            <input
              type="text"
              value={cignaDescription}
              onChange={(e) => setCignaDescription(e.target.value)}
              className="w-full p-2 border-2 border-bauhaus-black focus:outline-none focus:ring-2 focus:ring-bauhaus-blue"
              placeholder="e.g., MALAISE AND FATIGUE"
            />
          </div>
          {mappingError && (
            <p className="text-xs text-red-600">{mappingError}</p>
          )}
          <button
            type="button"
            onClick={handleSaveMapping}
            disabled={savingMapping}
            className={cn(
              'px-3 py-2 text-sm font-medium bg-bauhaus-blue text-white hover:bg-bauhaus-blue/90 transition-colors',
              savingMapping && 'opacity-60 cursor-not-allowed'
            )}
          >
            {savingMapping ? 'Saving...' : 'Save Cigna Mapping'}
          </button>
        </div>
      </div>

      {/* Relevant accounts */}
      <div className="border-t-2 border-bauhaus-black pt-4">
        <h4 className="font-bold mb-3 flex items-center gap-2">
          <Mail size={16} />
          Relevant Accounts ({illness.relevantAccounts.length})
        </h4>

        {illness.relevantAccounts.length === 0 ? (
          <p className="text-sm text-bauhaus-gray">
            No accounts linked yet. Accounts are added when confirming document matches.
          </p>
        ) : (
          <div className="space-y-2">
            {illness.relevantAccounts.map((account, idx) => (
              <div
                key={idx}
                className="p-3 bg-bauhaus-lightgray/30 border border-bauhaus-lightgray flex items-center justify-between"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      'px-2 py-0.5 text-xs font-medium rounded',
                      roleColors[account.role || 'other']
                    )}>
                      {account.role || 'other'}
                    </span>
                    <span className="font-medium">{account.email}</span>
                  </div>
                  {account.name && (
                    <p className="text-sm text-bauhaus-gray mt-1">{account.name}</p>
                  )}
                </div>
                <span className="text-xs text-bauhaus-gray">
                  Added {formatDate(account.addedAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="bauhaus-card text-center py-16">
      <div className="w-16 h-16 bg-bauhaus-lightgray rounded-full mx-auto mb-4 flex items-center justify-center">
        <User size={32} className="text-bauhaus-gray" />
      </div>
      <h2 className="text-xl font-bold mb-2">No Patients Yet</h2>
      <p className="text-bauhaus-gray mb-6">
        Add patient personas to track their claims and conditions
      </p>
      <button
        onClick={onAdd}
        className="px-6 py-3 bg-bauhaus-blue text-white font-medium hover:bg-bauhaus-blue/90 transition-colors"
      >
        Add First Patient
      </button>
    </div>
  );
}

function PatientFormModal({
  patient,
  onSave,
  onClose
}: {
  patient?: Patient | null;
  onSave: (data: CreatePatientInput) => void;
  onClose: () => void;
}) {
  const [formData, setFormData] = useState<CreatePatientInput>({
    cignaId: patient?.cignaId || '',
    name: patient?.name || '',
    relationship: patient?.relationship || 'Employee',
    dateOfBirth: patient?.dateOfBirth ? patient.dateOfBirth.split('T')[0] : '',
    citizenship: patient?.citizenship || '',
    workLocation: patient?.workLocation || '',
    email: patient?.email || '',
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave(formData);
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white p-6 w-full max-w-md border-2 border-bauhaus-black">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold">
            {patient ? 'Edit Patient' : 'Add Patient'}
          </h2>
          <button onClick={onClose} className="text-bauhaus-gray hover:text-bauhaus-black">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Name *</label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full p-2 border-2 border-bauhaus-black focus:outline-none focus:ring-2 focus:ring-bauhaus-blue"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Cigna ID *</label>
            <input
              type="text"
              required
              value={formData.cignaId}
              onChange={(e) => setFormData({ ...formData, cignaId: e.target.value })}
              className="w-full p-2 border-2 border-bauhaus-black focus:outline-none focus:ring-2 focus:ring-bauhaus-blue"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Relationship *</label>
            <select
              required
              value={formData.relationship}
              onChange={(e) => setFormData({ ...formData, relationship: e.target.value as RelationshipType })}
              className="w-full p-2 border-2 border-bauhaus-black focus:outline-none focus:ring-2 focus:ring-bauhaus-blue"
            >
              <option value="Employee">Employee</option>
              <option value="Member">Member</option>
              <option value="Beneficiary">Beneficiary</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Date of Birth *</label>
            <input
              type="date"
              required
              value={formData.dateOfBirth}
              onChange={(e) => setFormData({ ...formData, dateOfBirth: e.target.value })}
              className="w-full p-2 border-2 border-bauhaus-black focus:outline-none focus:ring-2 focus:ring-bauhaus-blue"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Email</label>
            <input
              type="email"
              value={formData.email || ''}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="w-full p-2 border-2 border-bauhaus-black focus:outline-none focus:ring-2 focus:ring-bauhaus-blue"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Citizenship</label>
            <input
              type="text"
              value={formData.citizenship || ''}
              onChange={(e) => setFormData({ ...formData, citizenship: e.target.value })}
              className="w-full p-2 border-2 border-bauhaus-black focus:outline-none focus:ring-2 focus:ring-bauhaus-blue"
              placeholder="e.g., US, DE, LV"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Work Location</label>
            <input
              type="text"
              value={formData.workLocation || ''}
              onChange={(e) => setFormData({ ...formData, workLocation: e.target.value })}
              className="w-full p-2 border-2 border-bauhaus-black focus:outline-none focus:ring-2 focus:ring-bauhaus-blue"
              placeholder="e.g., Berlin, Germany"
            />
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border-2 border-bauhaus-black font-medium hover:bg-bauhaus-lightgray transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-bauhaus-blue text-white font-medium hover:bg-bauhaus-blue/90 transition-colors"
            >
              {patient ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function IllnessFormModal({
  patientId,
  patientName,
  onSave,
  onClose
}: {
  patientId: string;
  patientName: string;
  onSave: (data: CreateIllnessInput) => void;
  onClose: () => void;
}) {
  const [formData, setFormData] = useState<CreateIllnessInput>({
    patientId,
    name: '',
    type: 'chronic',
    icdCode: '',
    onsetDate: '',
    notes: '',
    cignaSymptom: '',
    cignaDescription: '',
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave(formData);
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white p-6 w-full max-w-md border-2 border-bauhaus-black">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold">Add Illness</h2>
            <p className="text-sm text-bauhaus-gray">for {patientName}</p>
          </div>
          <button onClick={onClose} className="text-bauhaus-gray hover:text-bauhaus-black">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Condition Name *</label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full p-2 border-2 border-bauhaus-black focus:outline-none focus:ring-2 focus:ring-bauhaus-blue"
              placeholder="e.g., Anxiety, Diabetes Type 2"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Type *</label>
            <select
              required
              value={formData.type}
              onChange={(e) => setFormData({ ...formData, type: e.target.value as IllnessType })}
              className="w-full p-2 border-2 border-bauhaus-black focus:outline-none focus:ring-2 focus:ring-bauhaus-blue"
            >
              <option value="chronic">Chronic (ongoing)</option>
              <option value="acute">Acute (temporary)</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">ICD Code</label>
            <input
              type="text"
              value={formData.icdCode || ''}
              onChange={(e) => setFormData({ ...formData, icdCode: e.target.value })}
              className="w-full p-2 border-2 border-bauhaus-black focus:outline-none focus:ring-2 focus:ring-bauhaus-blue"
              placeholder="e.g., F41.9, E11"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Cigna Symptom</label>
            <input
              type="text"
              value={formData.cignaSymptom || ''}
              onChange={(e) => setFormData({ ...formData, cignaSymptom: e.target.value })}
              className="w-full p-2 border-2 border-bauhaus-black focus:outline-none focus:ring-2 focus:ring-bauhaus-blue"
              placeholder="e.g., TIRED OR WEAK"
            />
            <p className="text-xs text-bauhaus-gray mt-1">
              Must match the Cigna option text exactly.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Cigna Diagnosis</label>
            <input
              type="text"
              value={formData.cignaDescription || ''}
              onChange={(e) => setFormData({ ...formData, cignaDescription: e.target.value })}
              className="w-full p-2 border-2 border-bauhaus-black focus:outline-none focus:ring-2 focus:ring-bauhaus-blue"
              placeholder="e.g., MALAISE AND FATIGUE"
            />
            <p className="text-xs text-bauhaus-gray mt-1">
              Must match the Cigna option text exactly.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Onset Date</label>
            <input
              type="date"
              value={formData.onsetDate || ''}
              onChange={(e) => setFormData({ ...formData, onsetDate: e.target.value })}
              className="w-full p-2 border-2 border-bauhaus-black focus:outline-none focus:ring-2 focus:ring-bauhaus-blue"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Notes</label>
            <textarea
              value={formData.notes || ''}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              className="w-full p-2 border-2 border-bauhaus-black focus:outline-none focus:ring-2 focus:ring-bauhaus-blue"
              rows={3}
              placeholder="Additional notes about this condition..."
            />
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border-2 border-bauhaus-black font-medium hover:bg-bauhaus-lightgray transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-bauhaus-blue text-white font-medium hover:bg-bauhaus-blue/90 transition-colors"
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

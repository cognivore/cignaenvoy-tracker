import { useEffect, useMemo, useState } from 'react';
import { Calendar, Check, ExternalLink, FilePlus, FileText, RefreshCw, X } from 'lucide-react';
import { cn, formatCurrency, formatDate, truncate } from '@/lib/utils';
import { FilterTabs, type FilterTabItem, DetailRow, EmptyState, LoadingSpinner } from '@/components';
import {
  api,
  getDocumentFileUrl,
  type DraftClaim,
  type DraftClaimRange,
  type DraftClaimStatus,
  type Illness,
  type MedicalDocument,
  type Patient,
} from '@/lib/api';

type DraftFilter = DraftClaimStatus | 'all';
type DateMode = 'calendar' | 'manual';

const statusLabels: Record<DraftClaimStatus, { label: string; color: string }> = {
  pending: { label: 'Pending', color: 'bg-bauhaus-yellow text-bauhaus-black' },
  accepted: { label: 'Accepted', color: 'bg-bauhaus-blue text-white' },
  rejected: { label: 'Rejected', color: 'bg-bauhaus-red text-white' },
};

const rangeOptions: Array<{ label: string; value: DraftClaimRange }> = [
  { label: 'Forever', value: 'forever' },
  { label: 'Last Month', value: 'last_month' },
  { label: 'Last Week', value: 'last_week' },
];

export default function DraftClaims() {
  const [drafts, setDrafts] = useState<DraftClaim[]>([]);
  const [documents, setDocuments] = useState<MedicalDocument[]>([]);
  const [illnesses, setIllnesses] = useState<Illness[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDraft, setSelectedDraft] = useState<DraftClaim | null>(null);
  const [filter, setFilter] = useState<DraftFilter>('pending');
  const [processing, setProcessing] = useState<string | null>(null);

  const [selectedIllnessId, setSelectedIllnessId] = useState('');
  const [doctorNotes, setDoctorNotes] = useState('');
  const [dateMode, setDateMode] = useState<DateMode>('calendar');
  const [manualDate, setManualDate] = useState('');
  const [selectedCalendarIds, setSelectedCalendarIds] = useState<string[]>([]);

  useEffect(() => {
    loadDrafts();
  }, []);

  async function loadDrafts() {
    setLoading(true);
    try {
      const [draftsData, docs, illnessesData, patientsData] = await Promise.all([
        api.getDraftClaims(),
        api.getDocuments(),
        api.getIllnesses(),
        api.getPatients(),
      ]);
      setDrafts(draftsData);
      setDocuments(docs);
      setIllnesses(illnessesData);
      setPatients(patientsData);
    } catch (err) {
      console.error('Failed to load draft claims:', err);
    } finally {
      setLoading(false);
    }
  }

  function resetDraftForm(draft: DraftClaim | null) {
    if (!draft) {
      setSelectedIllnessId('');
      setDoctorNotes('');
      setDateMode('calendar');
      setManualDate('');
      setSelectedCalendarIds([]);
      return;
    }

    setSelectedIllnessId(draft.illnessId ?? '');
    setDoctorNotes(draft.doctorNotes ?? '');
    setSelectedCalendarIds(draft.calendarDocumentIds ?? []);

    if (draft.treatmentDateSource === 'manual') {
      setDateMode('manual');
      setManualDate(draft.treatmentDate ? draft.treatmentDate.slice(0, 10) : '');
    } else {
      setDateMode('calendar');
      setManualDate('');
    }
  }

  const calendarDocs = useMemo(
    () => documents.filter((doc) => doc.sourceType === 'calendar'),
    [documents]
  );

  const filteredDrafts = useMemo(() => {
    const base = filter === 'all' ? drafts : drafts.filter((draft) => draft.status === filter);
    // Sort by generatedAt descending (most recent first)
    return [...base].sort((a, b) =>
      new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime()
    );
  }, [drafts, filter]);

  const counts = {
    pending: drafts.filter((draft) => draft.status === 'pending').length,
    accepted: drafts.filter((draft) => draft.status === 'accepted').length,
    rejected: drafts.filter((draft) => draft.status === 'rejected').length,
  };

  const filterItems: FilterTabItem<DraftFilter>[] = [
    { key: 'pending', label: 'Pending', count: counts.pending },
    { key: 'accepted', label: 'Accepted', count: counts.accepted },
    { key: 'rejected', label: 'Rejected', count: counts.rejected },
    { key: 'all', label: 'All', count: drafts.length },
  ];

  const selectedDocument = selectedDraft
    ? documents.find((doc) => doc.id === selectedDraft.primaryDocumentId)
    : undefined;

  const selectedIllness = illnesses.find((illness) => illness.id === selectedIllnessId);
  const selectedPatient = selectedIllness
    ? patients.find((patient) => patient.id === selectedIllness.patientId)
    : undefined;

  async function handleGenerate(range: DraftClaimRange) {
    setProcessing(range);
    try {
      const result = await api.generateDraftClaims(range);
      setDrafts((prev) => [...result.drafts, ...prev]);
      alert(`Generated ${result.created} draft claims`);
    } catch (err) {
      console.error('Failed to generate draft claims:', err);
      alert(`Error: ${err}`);
    } finally {
      setProcessing(null);
    }
  }

  async function handleAccept() {
    if (!selectedDraft) return;
    if (!selectedIllnessId) {
      alert('Select an illness before accepting');
      return;
    }
    if (!doctorNotes.trim()) {
      alert('Doctor notes are required');
      return;
    }

    if (dateMode === 'manual' && !manualDate) {
      alert('Select a treatment date or switch to calendar dates');
      return;
    }

    if (dateMode === 'calendar' && selectedCalendarIds.length === 0) {
      alert('Select at least one calendar event for dates');
      return;
    }

    setProcessing('accept');
    try {
      const updated = await api.acceptDraftClaim(selectedDraft.id, {
        illnessId: selectedIllnessId,
        doctorNotes: doctorNotes.trim(),
        ...(dateMode === 'manual' && manualDate ? { treatmentDate: manualDate } : {}),
        ...(dateMode === 'calendar' ? { calendarDocumentIds: selectedCalendarIds } : {}),
      });

      setDrafts((prev) => prev.map((draft) => (draft.id === updated.id ? updated : draft)));
      setSelectedDraft(updated);
      resetDraftForm(updated);
    } catch (err) {
      console.error('Failed to accept draft claim:', err);
      alert(`Error: ${err}`);
    } finally {
      setProcessing(null);
    }
  }

  async function handleReject() {
    if (!selectedDraft) return;
    setProcessing('reject');
    try {
      const updated = await api.rejectDraftClaim(selectedDraft.id);
      setDrafts((prev) => prev.map((draft) => (draft.id === updated.id ? updated : draft)));
      setSelectedDraft(updated);
      resetDraftForm(updated);
    } catch (err) {
      console.error('Failed to reject draft claim:', err);
      alert(`Error: ${err}`);
    } finally {
      setProcessing(null);
    }
  }

  async function handleRunMatching() {
    setProcessing('matching');
    try {
      const result = await api.runDraftMatching();
      alert(`Created ${result.created} match candidates`);
    } catch (err) {
      console.error('Failed to run matching:', err);
      alert(`Error: ${err}`);
    } finally {
      setProcessing(null);
    }
  }

  function toggleCalendarId(id: string) {
    setSelectedCalendarIds((prev) =>
      prev.includes(id) ? prev.filter((docId) => docId !== id) : [...prev, id]
    );
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold bauhaus-accent">Draft Claims</h1>
          <p className="text-bauhaus-gray mt-1">
            Generate and review draft claims from payment documents
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {rangeOptions.map((range) => (
            <button
              key={range.value}
              onClick={() => handleGenerate(range.value)}
              disabled={processing !== null}
              className="flex items-center gap-2 px-4 py-2 bg-bauhaus-blue text-white font-medium hover:bg-bauhaus-blue/90 transition-colors disabled:opacity-60"
            >
              <FilePlus size={18} />
              {processing === range.value ? 'Generating...' : range.label}
            </button>
          ))}
          <button
            onClick={handleRunMatching}
            disabled={processing !== null}
            className="flex items-center gap-2 px-4 py-2 bg-bauhaus-black text-white font-medium hover:bg-bauhaus-gray transition-colors disabled:opacity-60"
          >
            <Check size={18} />
            {processing === 'matching' ? 'Matching...' : 'Run Matching'}
          </button>
          <button
            onClick={loadDrafts}
            className="flex items-center gap-2 px-4 py-2 border-2 border-bauhaus-black font-medium hover:bg-bauhaus-lightgray transition-colors"
          >
            <RefreshCw size={18} />
            Refresh
          </button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="mb-6">
        <FilterTabs items={filterItems} active={filter} onChange={setFilter} />
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : drafts.length === 0 ? (
        <EmptyState
          icon={FilePlus}
          title="No Draft Claims"
          message="Generate draft claims from unattached payment documents"
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Draft list */}
          <div className="space-y-4 max-h-[calc(100vh-280px)] overflow-auto pr-2">
            {filteredDrafts.map((draft) => (
              <DraftCard
                key={draft.id}
                draft={draft}
                document={documents.find((doc) => doc.id === draft.primaryDocumentId)}
                selected={selectedDraft?.id === draft.id}
                onClick={() => {
                  setSelectedDraft(draft);
                  resetDraftForm(draft);
                }}
              />
            ))}
          </div>

          {/* Draft detail - sticky panel */}
          {selectedDraft && (
            <div className="bauhaus-card h-fit lg:sticky lg:top-8 max-h-[calc(100vh-120px)] flex flex-col">
              {/* Sticky header */}
              <div className="flex items-start justify-between mb-4 flex-shrink-0">
                <span
                  className={cn(
                    'inline-block px-2 py-1 text-xs font-medium uppercase',
                    statusLabels[selectedDraft.status].color
                  )}
                >
                  {statusLabels[selectedDraft.status].label}
                </span>
                <span className="text-xs text-bauhaus-gray">ID: {selectedDraft.id}</span>
              </div>

              <h2 className="text-xl font-bold mb-4 flex-shrink-0">Draft Claim Details</h2>

              {/* Scrollable content */}
              <div className="overflow-auto flex-1 min-h-0">
                <div className="space-y-1 mb-6">
                  <DetailRow
                    label="Payment"
                    value={
                      <span className="flex items-center gap-2">
                        {formatCurrency(selectedDraft.payment.amount, selectedDraft.payment.currency)}
                        {selectedDraft.payment.source === 'override' && (
                          <span className="text-xs px-1.5 py-0.5 bg-green-100 text-green-700">Override</span>
                        )}
                      </span>
                    }
                  />
                  {selectedDraft.payment.context && (
                    <DetailRow label="Context" value={truncate(selectedDraft.payment.context, 120)} />
                  )}
                  {selectedDraft.treatmentDate && (
                    <DetailRow label="Treatment Date" value={formatDate(selectedDraft.treatmentDate)} />
                  )}
                  {selectedDocument?.filename && (
                    <DetailRow
                      label="Attachment"
                      value={
                        selectedDocument.attachmentPath ? (
                          <a
                            href={getDocumentFileUrl(selectedDocument.id)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-bauhaus-blue hover:underline inline-flex items-center gap-1"
                          >
                            {selectedDocument.filename}
                            <ExternalLink size={14} />
                          </a>
                        ) : (
                          selectedDocument.filename
                        )
                      }
                    />
                  )}
                  {selectedDocument?.subject && (
                    <DetailRow label="Email Subject" value={selectedDocument.subject} />
                  )}
                </div>

                {selectedDraft.status === 'pending' ? (
                  <>
                    <div className="border-t-2 border-bauhaus-black pt-4 mb-4">
                      <h3 className="font-bold mb-3">Acceptance Details</h3>

                      <div className="mb-3">
                        <label className="block text-sm text-bauhaus-gray mb-1">Illness</label>
                        <select
                          value={selectedIllnessId}
                          onChange={(e) => setSelectedIllnessId(e.target.value)}
                          className="w-full p-2 border-2 border-bauhaus-black focus:outline-none focus:ring-2 focus:ring-bauhaus-blue"
                        >
                          <option value="">Select an illness...</option>
                          {illnesses.map((illness) => {
                            const patient = patients.find((p) => p.id === illness.patientId);
                            const patientLabel = patient ? ` - ${patient.name}` : '';
                            return (
                              <option key={illness.id} value={illness.id}>
                                {illness.name} ({illness.type}){patientLabel}
                              </option>
                            );
                          })}
                        </select>
                      </div>

                      {selectedIllness && (
                        <p className="text-xs text-bauhaus-gray mb-3">
                          Selected patient: {selectedPatient?.name ?? 'Unknown'}
                        </p>
                      )}

                      <div className="mb-3">
                        <label className="block text-sm text-bauhaus-gray mb-1">Doctor Notes</label>
                        <textarea
                          value={doctorNotes}
                          onChange={(e) => setDoctorNotes(e.target.value)}
                          className="w-full p-3 border-2 border-bauhaus-black focus:outline-none focus:ring-2 focus:ring-bauhaus-blue"
                          rows={3}
                          placeholder="Add doctor notes or claim context..."
                        />
                      </div>

                      <div className="mb-3">
                        <label className="block text-sm text-bauhaus-gray mb-1">Treatment Date Source</label>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setDateMode('calendar')}
                            className={cn(
                              'flex-1 px-3 py-2 border-2 text-sm font-medium',
                              dateMode === 'calendar'
                                ? 'bg-bauhaus-black text-white border-bauhaus-black'
                                : 'border-bauhaus-black hover:bg-bauhaus-lightgray'
                            )}
                          >
                            Calendar Events
                          </button>
                          <button
                            onClick={() => setDateMode('manual')}
                            className={cn(
                              'flex-1 px-3 py-2 border-2 text-sm font-medium',
                              dateMode === 'manual'
                                ? 'bg-bauhaus-black text-white border-bauhaus-black'
                                : 'border-bauhaus-black hover:bg-bauhaus-lightgray'
                            )}
                          >
                            Manual Date
                          </button>
                        </div>
                      </div>

                      {dateMode === 'manual' ? (
                        <div className="mb-3">
                          <label className="block text-sm text-bauhaus-gray mb-1">Treatment Date</label>
                          <input
                            type="date"
                            value={manualDate}
                            onChange={(e) => setManualDate(e.target.value)}
                            className="w-full p-2 border-2 border-bauhaus-black focus:outline-none focus:ring-2 focus:ring-bauhaus-blue"
                          />
                        </div>
                      ) : (
                        <div className="mb-3">
                          <label className="block text-sm text-bauhaus-gray mb-2">Calendar Events</label>
                          <div className="max-h-40 overflow-auto border border-bauhaus-lightgray">
                            {calendarDocs.length === 0 ? (
                              <div className="p-3 text-sm text-bauhaus-gray">No calendar documents available</div>
                            ) : (
                              <ul className="divide-y divide-bauhaus-lightgray">
                                {calendarDocs.map((doc) => (
                                  <li key={doc.id} className="p-3 flex items-start gap-3">
                                    <input
                                      type="checkbox"
                                      checked={selectedCalendarIds.includes(doc.id)}
                                      onChange={() => toggleCalendarId(doc.id)}
                                      className="mt-1"
                                    />
                                    <div>
                                      <p className="font-medium">
                                        {doc.calendarSummary || doc.subject || 'Calendar Event'}
                                      </p>
                                      <p className="text-xs text-bauhaus-gray">
                                        {doc.calendarStart ? formatDate(doc.calendarStart) : doc.date ? formatDate(doc.date) : 'No date'}
                                      </p>
                                    </div>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="flex gap-3 flex-shrink-0">
                      <button
                        onClick={handleAccept}
                        disabled={processing !== null}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-bauhaus-blue text-white font-medium hover:bg-bauhaus-blue/90 transition-colors disabled:opacity-60"
                      >
                        <Check size={18} />
                        Accept Draft
                      </button>
                      <button
                        onClick={handleReject}
                        disabled={processing !== null}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-bauhaus-red text-white font-medium hover:bg-bauhaus-red/90 transition-colors disabled:opacity-60"
                      >
                        <X size={18} />
                        Reject
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="border-t-2 border-bauhaus-black pt-4">
                    {selectedDraft.status === 'accepted' && (
                      <>
                        <DetailRow label="Illness" value={selectedIllness?.name ?? selectedDraft.illnessId ?? 'Unknown'} />
                        {selectedDraft.doctorNotes && (
                          <DetailRow label="Doctor Notes" value={selectedDraft.doctorNotes} />
                        )}
                      </>
                    )}
                    {selectedDraft.status === 'rejected' && (
                      <p className="text-sm text-bauhaus-gray">This draft claim was rejected.</p>
                    )}
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

function DraftCard({
  draft,
  document,
  selected,
  onClick,
}: {
  draft: DraftClaim;
  document?: MedicalDocument;
  selected: boolean;
  onClick: () => void;
}) {
  const hasFile = document?.attachmentPath;
  const filename = document?.filename || document?.subject || 'Attachment';

  return (
    <div
      onClick={onClick}
      className={cn('bauhaus-card cursor-pointer', selected && 'ring-2 ring-bauhaus-blue')}
    >
      <div className="flex items-start justify-between mb-3">
        <span
          className={cn(
            'inline-block px-2 py-1 text-xs font-medium uppercase',
            statusLabels[draft.status].color
          )}
        >
          {statusLabels[draft.status].label}
        </span>
        <span className="text-xs text-bauhaus-gray">
          {draft.generatedAt ? formatDate(draft.generatedAt) : 'No date'}
        </span>
      </div>
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm">
          <FileText size={16} className="text-bauhaus-gray flex-shrink-0" />
          {hasFile && document ? (
            <a
              href={getDocumentFileUrl(document.id)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-bauhaus-blue hover:underline truncate inline-flex items-center gap-1"
              onClick={(e) => e.stopPropagation()}
            >
              {filename}
              <ExternalLink size={12} />
            </a>
          ) : (
            <span className="truncate">{filename}</span>
          )}
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Calendar size={16} className="text-bauhaus-gray flex-shrink-0" />
          <span>
            {draft.treatmentDate
              ? formatDate(draft.treatmentDate)
              : document?.date
              ? formatDate(document.date)
              : 'No date'}
          </span>
        </div>
        <div className="flex items-center gap-2 text-sm flex-wrap">
          <span className="font-bold">
            {formatCurrency(draft.payment.amount, draft.payment.currency)}
          </span>
          {draft.payment.source === 'override' ? (
            <span className="text-xs px-1.5 py-0.5 bg-green-100 text-green-700">Override</span>
          ) : draft.payment.confidence ? (
            <span className="text-xs text-bauhaus-gray">
              ({draft.payment.confidence}% confidence)
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

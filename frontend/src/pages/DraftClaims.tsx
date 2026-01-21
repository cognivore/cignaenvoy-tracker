import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ExternalLink, FilePlus, FileText, RefreshCw, X, Archive, RotateCcw, Upload, Trash2 } from 'lucide-react';
import { cn, formatCurrency, formatDate, truncate } from '@/lib/utils';
import {
  FilterTabs,
  type FilterTabItem,
  DetailRow,
  EmptyState,
  LoadingSpinner,
  UnseenDivider,
} from '@/components';
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
import { useUnseenList } from '@/lib/useUnseenList';
import { useUnseenDivider } from '@/lib/useUnseenDivider';

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

const PAYMENT_PROOF_KEYWORDS = [
  'proof of payment',
  'payment received',
  'payment confirmation',
  'paid',
  'bank transfer',
  'transfer',
  'sent',
  'transaction',
  'monzo',
];

function buildProofText(doc: MedicalDocument): string {
  return [
    doc.subject,
    doc.bodySnippet,
    doc.ocrText,
    doc.filename,
    doc.fromAddress,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function hasProofKeywords(doc: MedicalDocument): boolean {
  const text = buildProofText(doc);
  return PAYMENT_PROOF_KEYWORDS.some((keyword) => text.includes(keyword));
}

function getDocumentAmounts(doc: MedicalDocument): Array<{ value: number; currency: string }> {
  if (doc.paymentOverride) {
    return [{ value: doc.paymentOverride.amount, currency: doc.paymentOverride.currency }];
  }
  return doc.detectedAmounts.map((amount) => ({
    value: amount.value,
    currency: amount.currency,
  }));
}

function matchesPaymentAmount(doc: MedicalDocument, payment: DraftClaim['payment']): boolean {
  if (!payment.amount || payment.amount <= 0) return false;
  return getDocumentAmounts(doc).some(
    (amount) =>
      amount.currency === payment.currency &&
      Math.abs(amount.value - payment.amount) < 0.01
  );
}

function isPaymentProofCandidate(doc: MedicalDocument): boolean {
  if (doc.archivedAt) return false;
  if (doc.sourceType === 'calendar') return false;
  return doc.classification === 'receipt' || hasProofKeywords(doc);
}

function dedupeDocuments(docs: MedicalDocument[]): MedicalDocument[] {
  const seen = new Set<string>();
  return docs.filter((doc) => {
    if (seen.has(doc.id)) return false;
    seen.add(doc.id);
    return true;
  });
}

function buildPaymentProofCandidates(
  draft: DraftClaim,
  documents: MedicalDocument[]
): MedicalDocument[] {
  const primaryDocument = documents.find((doc) => doc.id === draft.primaryDocumentId);
  const forcedDocs = documents.filter((doc) =>
    (draft.paymentProofDocumentIds ?? []).includes(doc.id)
  );

  const scored = documents
    .filter((doc) => doc.id !== draft.primaryDocumentId)
    .filter(isPaymentProofCandidate)
    .map((doc) => {
      const amountMatch = matchesPaymentAmount(doc, draft.payment);
      const sameEmail =
        !!primaryDocument?.emailId && doc.emailId === primaryDocument.emailId;
      const score =
        (amountMatch ? 4 : 0) +
        (doc.classification === 'receipt' ? 2 : 0) +
        (hasProofKeywords(doc) ? 1 : 0) +
        (sameEmail ? 1 : 0);
      return { doc, score, amountMatch };
    })
    .filter((item) => item.score > 0);

  const preferred = scored.some((item) => item.amountMatch)
    ? scored.filter((item) => item.amountMatch)
    : scored;

  const sorted = preferred
    .sort((a, b) => b.score - a.score)
    .map((item) => item.doc)
    .slice(0, 20);

  return dedupeDocuments([...forcedDocs, ...sorted]);
}

export default function DraftClaims() {
  const {
    items: drafts,
    loading,
    unseenIds,
    refresh: refreshDrafts,
    markAllSeen,
    applyLocalUpdate,
    upsertItem,
    removeItem,
  } = useUnseenList<DraftClaim>({
    fetcher: async () => {
      const all = await api.getDraftClaims();
      return all.filter((draft) => !draft.archivedAt);
    },
    cacheKey: 'draft-claims',
  });

  const [documents, setDocuments] = useState<MedicalDocument[]>([]);
  const [illnesses, setIllnesses] = useState<Illness[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedDraft, setSelectedDraft] = useState<DraftClaim | null>(null);
  const [filter, setFilter] = useState<DraftFilter>('pending');
  const [processing, setProcessing] = useState<string | null>(null);
  const dividerRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const [selectedIllnessId, setSelectedIllnessId] = useState('');
  const [doctorNotes, setDoctorNotes] = useState('');
  const [dateMode, setDateMode] = useState<DateMode>('calendar');
  const [manualDate, setManualDate] = useState('');
  const [selectedCalendarIds, setSelectedCalendarIds] = useState<string[]>([]);
  const [selectedProofIds, setSelectedProofIds] = useState<string[]>([]);
  const [paymentProofNote, setPaymentProofNote] = useState('');
  const [uploadingProof, setUploadingProof] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const loadSupportingData = async () => {
      try {
        const [docs, illnessesData, patientsData] = await Promise.all([
          api.getDocuments(),
          api.getIllnesses(),
          api.getPatients(),
        ]);
        setDocuments(docs);
        setIllnesses(illnessesData);
        setPatients(patientsData);
      } catch (err) {
        console.error('Failed to load draft claim references:', err);
      }
    };

    loadSupportingData();
    const interval = setInterval(loadSupportingData, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!selectedDraft) return;
    const updated = drafts.find((draft) => draft.id === selectedDraft.id);
    if (updated && updated !== selectedDraft) {
      setSelectedDraft(updated);
    }
  }, [drafts, selectedDraft]);

  function resetDraftForm(draft: DraftClaim | null) {
    if (!draft) {
      setSelectedIllnessId('');
      setDoctorNotes('');
      setDateMode('calendar');
      setManualDate('');
      setSelectedCalendarIds([]);
      setSelectedProofIds([]);
      setPaymentProofNote('');
      return;
    }

    setSelectedIllnessId(draft.illnessId ?? '');
    setDoctorNotes(draft.doctorNotes ?? '');
    setSelectedCalendarIds(draft.calendarDocumentIds ?? []);
    setSelectedProofIds(draft.paymentProofDocumentIds ?? []);
    setPaymentProofNote(draft.paymentProofText ?? '');

    if (draft.treatmentDateSource === 'manual') {
      setDateMode('manual');
      setManualDate(draft.treatmentDate ? draft.treatmentDate.slice(0, 10) : '');
    } else {
      setDateMode('calendar');
      setManualDate('');
    }
  }

  // Save draft changes
  async function handleSaveDraft() {
    if (!selectedDraft || selectedDraft.status !== 'pending') return;

    setSaving(true);
    try {
      const updated = await api.updateDraftClaim(selectedDraft.id, {
        illnessId: selectedIllnessId || undefined,
        doctorNotes: doctorNotes.trim() || undefined,
        calendarDocumentIds: selectedCalendarIds.length > 0 ? selectedCalendarIds : undefined,
        paymentProofDocumentIds: selectedProofIds.length > 0 ? selectedProofIds : undefined,
        paymentProofText: paymentProofNote.trim() || undefined,
      });
      upsertItem(updated);
      setSelectedDraft(updated);
    } catch (err) {
      console.error('Save failed:', err);
      alert(`Save failed: ${err}`);
    } finally {
      setSaving(false);
    }
  }

  const calendarDocs = useMemo(
    () => documents.filter((doc) => doc.sourceType === 'calendar'),
    [documents]
  );

  const paymentProofCandidates = useMemo(() => {
    if (!selectedDraft) return [];
    return buildPaymentProofCandidates(selectedDraft, documents);
  }, [documents, selectedDraft]);

  const activeProofIds =
    selectedDraft?.status === 'pending'
      ? selectedProofIds
      : selectedDraft?.paymentProofDocumentIds ?? [];

  const activeProofDocs = useMemo(
    () => documents.filter((doc) => activeProofIds.includes(doc.id)),
    [documents, activeProofIds]
  );

  const filteredDrafts = useMemo(() => {
    const base = filter === 'all' ? drafts : drafts.filter((draft) => draft.status === filter);
    // Sort by generatedAt descending (most recent first)
    return [...base].sort((a, b) =>
      new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime()
    );
  }, [drafts, filter]);

  const draftSections = useMemo(() => {
    const unseenDrafts = filteredDrafts.filter((draft) => unseenIds.has(draft.id));
    const seenDrafts = filteredDrafts.filter((draft) => !unseenIds.has(draft.id));
    return {
      unseenDrafts,
      seenDrafts,
      hasVisibleUnseen: unseenDrafts.length > 0,
    };
  }, [filteredDrafts, unseenIds]);

  useUnseenDivider({
    dividerRef,
    onSeen: markAllSeen,
    active: draftSections.hasVisibleUnseen,
    deps: [filteredDrafts, filter],
    containerRef: listRef,
  });

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
  const proofText =
    selectedDraft?.status === 'pending'
      ? paymentProofNote.trim()
      : selectedDraft?.paymentProofText ?? '';
  const proofProvided = activeProofIds.length > 0 || !!proofText;
  const proofSummary = proofProvided
    ? activeProofIds.length > 0
      ? `${activeProofIds.length} document${activeProofIds.length === 1 ? '' : 's'}${
          proofText ? ' + note' : ''
        }`
      : 'Note provided'
    : 'Missing';

  async function handleGenerate(range: DraftClaimRange) {
    setProcessing(range);
    try {
      const result = await api.generateDraftClaims(range);
      applyLocalUpdate((prev) => [...result.drafts, ...prev]);
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

    const trimmedProofNote = paymentProofNote.trim();
    if (selectedProofIds.length === 0 && !trimmedProofNote) {
      alert('Proof of payment is required');
      return;
    }

    setProcessing('accept');
    try {
      const updated = await api.acceptDraftClaim(selectedDraft.id, {
        illnessId: selectedIllnessId,
        doctorNotes: doctorNotes.trim(),
        ...(dateMode === 'manual' && manualDate ? { treatmentDate: manualDate } : {}),
        ...(dateMode === 'calendar' ? { calendarDocumentIds: selectedCalendarIds } : {}),
        paymentProofDocumentIds: selectedProofIds,
        ...(trimmedProofNote ? { paymentProofText: trimmedProofNote } : {}),
      });

      upsertItem(updated);
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
      upsertItem(updated);
      setSelectedDraft(updated);
      resetDraftForm(updated);
    } catch (err) {
      console.error('Failed to reject draft claim:', err);
      alert(`Error: ${err}`);
    } finally {
      setProcessing(null);
    }
  }

  async function handleMarkPending() {
    if (!selectedDraft) return;
    setProcessing('pending');
    try {
      const updated = await api.markDraftClaimPending(selectedDraft.id);
      upsertItem(updated);
      setSelectedDraft(updated);
      resetDraftForm(updated);
    } catch (err) {
      console.error('Failed to mark draft claim pending:', err);
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

  async function handleArchive() {
    if (!selectedDraft) return;
    setProcessing('archiving');
    try {
      await api.setDraftClaimArchived(selectedDraft.id, true);
      removeItem(selectedDraft.id);
      setSelectedDraft(null);
    } catch (err) {
      console.error('Failed to archive draft claim:', err);
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

  function toggleProofId(id: string) {
    setSelectedProofIds((prev) =>
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
            onClick={refreshDrafts}
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
          <div
            ref={listRef}
            className="space-y-4 max-h-[calc(100vh-280px)] overflow-auto pr-2"
          >
            {draftSections.unseenDrafts.map((draft) => (
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
            <UnseenDivider
              ref={dividerRef}
              visible={draftSections.hasVisibleUnseen}
              label="Unseen"
            />
            {draftSections.seenDrafts.map((draft) => (
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
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'inline-block px-2 py-1 text-xs font-medium uppercase',
                      statusLabels[selectedDraft.status].color
                    )}
                  >
                    {statusLabels[selectedDraft.status].label}
                  </span>
                  {selectedDraft.status === 'pending' && (
                    <button
                      onClick={handleSaveDraft}
                      disabled={saving || processing !== null}
                      className={cn(
                        'px-2 py-1 text-xs font-medium bg-bauhaus-blue text-white hover:bg-bauhaus-blue/90 transition-colors',
                        (saving || processing !== null) && 'opacity-60 cursor-not-allowed'
                      )}
                    >
                      {saving ? 'Saving...' : 'Save'}
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-bauhaus-gray">ID: {selectedDraft.id}</span>
                  <button
                    onClick={handleArchive}
                    disabled={processing === 'archiving'}
                    className={cn(
                      'p-2 border border-bauhaus-red text-bauhaus-red hover:bg-bauhaus-lightgray transition-colors',
                      processing === 'archiving' && 'opacity-60 cursor-not-allowed'
                    )}
                    title="Archive"
                  >
                    <Archive size={16} />
                  </button>
                </div>
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
                  <DetailRow
                    label="Payment Proof"
                    value={
                      <span className={cn(
                        selectedDraft.status === 'pending' && !proofProvided && 'text-bauhaus-red'
                      )}>
                        {proofSummary}
                      </span>
                    }
                  />
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
                        <label className="block text-sm text-bauhaus-gray mb-2">
                          Proof of Payment (required)
                        </label>

                        {/* Existing proof candidates */}
                        {paymentProofCandidates.length > 0 && (
                          <div className="max-h-32 overflow-auto border border-bauhaus-lightgray mb-2">
                            <ul className="divide-y divide-bauhaus-lightgray">
                              {paymentProofCandidates.map((doc) => (
                                <li key={doc.id} className="p-2 flex items-start gap-2">
                                  <input
                                    type="checkbox"
                                    checked={selectedProofIds.includes(doc.id)}
                                    onChange={() => toggleProofId(doc.id)}
                                    className="mt-1"
                                  />
                                  <div className="min-w-0 flex-1">
                                    <p className="text-sm font-medium flex items-center gap-1 truncate">
                                      {doc.attachmentPath ? (
                                        <a
                                          href={getDocumentFileUrl(doc.id)}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-bauhaus-blue hover:underline inline-flex items-center gap-1"
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          {doc.filename || doc.subject || 'Payment proof'}
                                          <ExternalLink size={12} />
                                        </a>
                                      ) : (
                                        doc.filename || doc.subject || 'Payment proof'
                                      )}
                                    </p>
                                    <p className="text-xs text-bauhaus-gray">
                                      {doc.date ? formatDate(doc.date) : 'No date'}
                                    </p>
                                  </div>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Selected uploaded proofs */}
                        {selectedProofIds.filter(id => !paymentProofCandidates.some(c => c.id === id)).length > 0 && (
                          <div className="mb-2 space-y-1">
                            <p className="text-xs text-bauhaus-gray">Uploaded proofs:</p>
                            {selectedProofIds
                              .filter(id => !paymentProofCandidates.some(c => c.id === id))
                              .map(id => {
                                const doc = documents.find(d => d.id === id);
                                return (
                                  <div key={id} className="flex items-center gap-2 p-2 bg-emerald-50 border border-emerald-200">
                                    <FileText size={14} className="text-emerald-600 flex-shrink-0" />
                                    {doc?.attachmentPath ? (
                                      <a
                                        href={getDocumentFileUrl(id)}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-sm text-emerald-700 hover:underline flex-1 truncate"
                                      >
                                        {doc.filename || 'Uploaded proof'}
                                      </a>
                                    ) : (
                                      <span className="text-sm text-emerald-700 flex-1 truncate">
                                        {doc?.filename || 'Uploaded proof'}
                                      </span>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => toggleProofId(id)}
                                      className="p-1 hover:bg-emerald-100 text-emerald-600"
                                      title="Remove"
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  </div>
                                );
                              })}
                          </div>
                        )}

                        {/* File upload area */}
                        <div className="mt-2">
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*,application/pdf"
                            className="hidden"
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;

                              setUploadingProof(true);
                              try {
                                const result = await api.uploadProofFile(file);
                                setSelectedProofIds(prev => [...prev, result.id]);
                                // Refresh documents to include the new upload
                                const docs = await api.getDocuments();
                                setDocuments(docs);
                              } catch (err) {
                                console.error('Failed to upload proof:', err);
                                alert(`Upload failed: ${err}`);
                              } finally {
                                setUploadingProof(false);
                                if (fileInputRef.current) {
                                  fileInputRef.current.value = '';
                                }
                              }
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={uploadingProof}
                            className={cn(
                              'w-full flex items-center justify-center gap-2 p-3 border-2 border-dashed border-bauhaus-gray text-bauhaus-gray hover:border-bauhaus-blue hover:text-bauhaus-blue transition-colors',
                              uploadingProof && 'opacity-60 cursor-not-allowed'
                            )}
                          >
                            <Upload size={18} />
                            {uploadingProof ? 'Uploading...' : 'Upload screenshot or PDF'}
                          </button>
                          <p className="text-xs text-bauhaus-gray mt-1">
                            Supports images (PNG, JPG) and PDF files
                          </p>
                        </div>

                        {/* Optional note */}
                        <div className="mt-2">
                          <input
                            type="text"
                            value={paymentProofNote}
                            onChange={(e) => setPaymentProofNote(e.target.value)}
                            className="w-full p-2 border border-bauhaus-lightgray focus:outline-none focus:ring-1 focus:ring-bauhaus-blue text-sm"
                            placeholder="Optional: transaction ref or note..."
                          />
                        </div>
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
                        <DetailRow label="Payment Proof" value={proofSummary} />
                        {activeProofDocs.length > 0 && (
                          <div className="pt-2">
                            <p className="text-xs text-bauhaus-gray mb-1">Proof attachments</p>
                            <ul className="space-y-1">
                              {activeProofDocs.map((doc) => (
                                <li key={doc.id}>
                                  {doc.attachmentPath ? (
                                    <a
                                      href={getDocumentFileUrl(doc.id)}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-sm text-bauhaus-blue hover:underline inline-flex items-center gap-1"
                                    >
                                      {doc.filename || doc.subject || 'Attachment'}
                                      <ExternalLink size={12} />
                                    </a>
                                  ) : (
                                    <span className="text-sm">
                                      {doc.filename || doc.subject || 'Attachment'}
                                    </span>
                                  )}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {selectedDraft.paymentProofText && (
                          <div className="pt-2">
                            <p className="text-xs text-bauhaus-gray mb-1">Proof note</p>
                            <p className="text-sm">{selectedDraft.paymentProofText}</p>
                          </div>
                        )}
                      </>
                    )}
                    {selectedDraft.status === 'rejected' && (
                      <p className="text-sm text-bauhaus-gray">This draft claim was rejected.</p>
                    )}
                    <div className="mt-4">
                      <button
                        onClick={handleMarkPending}
                        disabled={processing !== null}
                        className="flex items-center gap-2 px-3 py-2 border-2 border-bauhaus-black font-medium hover:bg-bauhaus-lightgray transition-colors disabled:opacity-60"
                      >
                        <RotateCcw size={16} />
                        {processing === 'pending' ? 'Marking...' : 'Mark as Pending'}
                      </button>
                    </div>
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

const classificationLabels: Record<string, { label: string; color: string }> = {
  medical_bill: { label: 'Bill', color: 'bg-amber-100 text-amber-800' },
  receipt: { label: 'Receipt', color: 'bg-emerald-100 text-emerald-800' },
  appointment: { label: 'Appt', color: 'bg-sky-100 text-sky-800' },
  prescription: { label: 'Rx', color: 'bg-violet-100 text-violet-800' },
  other: { label: 'Other', color: 'bg-gray-100 text-gray-700' },
};

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
  const filename = document?.filename || 'Attachment';
  const subject = document?.subject;
  const fromAddress = document?.fromAddress;
  const classification = document?.classification || 'other';
  const classStyle = classificationLabels[classification] || classificationLabels.other;

  // Check if proof is provided
  const hasProofDocs = (draft.paymentProofDocumentIds?.length ?? 0) > 0;
  const hasProofText = !!draft.paymentProofText;
  const hasProof = hasProofDocs || hasProofText;

  // Document count
  const docCount = draft.documentIds?.length ?? 1;

  // Extract sender name from email address (e.g., "info@vitality360.co.uk" -> "vitality360")
  const senderName = fromAddress
    ? fromAddress.includes('@')
      ? fromAddress.split('@')[1]?.split('.')[0] || fromAddress
      : fromAddress
    : null;

  return (
    <div
      onClick={onClick}
      className={cn('bauhaus-card cursor-pointer', selected && 'ring-2 ring-bauhaus-blue')}
    >
      {/* Header row: status + classification + date */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={cn(
              'inline-block px-2 py-0.5 text-xs font-medium uppercase',
              statusLabels[draft.status].color
            )}
          >
            {statusLabels[draft.status].label}
          </span>
          <span
            className={cn(
              'inline-block px-1.5 py-0.5 text-xs font-medium',
              classStyle.color
            )}
          >
            {classStyle.label}
          </span>
        </div>
        <span className="text-xs text-bauhaus-gray flex-shrink-0">
          {draft.generatedAt ? formatDate(draft.generatedAt) : 'No date'}
        </span>
      </div>

      {/* Sender */}
      {senderName && (
        <div className="text-sm font-medium text-bauhaus-gray mb-1 truncate">
          {senderName}
        </div>
      )}

      {/* Subject / filename */}
      <div className="mb-2">
        {subject ? (
          <p className="font-medium text-sm truncate" title={subject}>
            {subject}
          </p>
        ) : (
          <div className="flex items-center gap-2 text-sm">
            <FileText size={14} className="text-bauhaus-gray flex-shrink-0" />
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
        )}
      </div>

      {/* Bottom row: date, amount, proof status, doc count */}
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-3">
          <span className="text-bauhaus-gray">
            {draft.treatmentDate
              ? formatDate(draft.treatmentDate)
              : document?.date
              ? formatDate(document.date)
              : 'No date'}
          </span>
          <span className="font-bold">
            {formatCurrency(draft.payment.amount, draft.payment.currency)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* Proof indicator */}
          {draft.status === 'pending' && (
            <span
              className={cn(
                'text-xs px-1.5 py-0.5 font-medium',
                hasProof
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-red-100 text-red-700'
              )}
              title={hasProof ? 'Proof attached' : 'No proof of payment'}
            >
              {hasProof ? '✓ Proof' : '! No proof'}
            </span>
          )}
          {/* Doc count */}
          {docCount > 1 && (
            <span className="text-xs text-bauhaus-gray" title={`${docCount} documents attached`}>
              {docCount} docs
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ExternalLink, FilePlus, FileText, RefreshCw, X, Archive, RotateCcw, Upload, Trash2, ChevronDown } from 'lucide-react';
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
  type Claim,
  type DraftClaim,
  type DraftClaimRange,
  type DraftClaimStatus,
  type ClaimType,
  type Illness,
  type MedicalDocument,
  type Patient,
  type ScrapedClaim,
  type DraftClaimMatchCandidate,
} from '@/lib/api';
import { useUnseenList } from '@/lib/useUnseenList';
import { useUnseenDivider } from '@/lib/useUnseenDivider';
import { useCachedFetch } from '@/lib/useCachedFetch';

type DraftFilter = DraftClaimStatus | 'all';
type DateMode = 'calendar' | 'manual';

const statusLabels: Record<DraftClaimStatus, { label: string; color: string }> = {
  pending: { label: 'Pending', color: 'bg-bauhaus-yellow text-bauhaus-black' },
  accepted: { label: 'Accepted', color: 'bg-bauhaus-blue text-white' },
  rejected: { label: 'Rejected', color: 'bg-bauhaus-red text-white' },
  submitted: { label: 'Submitted', color: 'bg-bauhaus-green text-white' },
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
    fetcher: api.getActiveDraftClaims,
    cacheKey: 'draft-claims',
  });

  const { data: documentsCached, refresh: refreshDocuments } = useCachedFetch<MedicalDocument[]>({
    key: 'documents-active',
    fetcher: api.getActiveDocuments,
    pollIntervalMs: 120_000,
  });
  const documents = documentsCached ?? [];

  const { data: illnessesCached } = useCachedFetch<Illness[]>({
    key: 'illnesses-active',
    fetcher: api.getActiveIllnesses,
    pollIntervalMs: 300_000,
  });
  const illnesses = illnessesCached ?? [];

  const { data: patientsCached } = useCachedFetch<Patient[]>({
    key: 'patients-active',
    fetcher: api.getActivePatients,
    pollIntervalMs: 300_000,
  });
  const patients = patientsCached ?? [];

  const { data: scrapedClaimsCached } = useCachedFetch<ScrapedClaim[]>({
    key: 'scraped-claims-active',
    fetcher: api.getActiveScrapedClaims,
    pollIntervalMs: 120_000,
  });
  const scrapedClaims = scrapedClaimsCached ?? [];

  const { data: matchCandidatesCached, refresh: refreshMatches } = useCachedFetch<DraftClaimMatchCandidate[]>({
    key: 'draft-claim-matches',
    fetcher: api.getDraftClaimMatches,
    pollIntervalMs: 120_000,
  });
  const matchCandidates = matchCandidatesCached ?? [];

  const [selectedDraft, setSelectedDraft] = useState<DraftClaim | null>(null);
  const [linkedClaim, setLinkedClaim] = useState<Claim | null>(null);
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
  const [claimType, setClaimType] = useState<ClaimType>('Medical');
  const [claimCountry, setClaimCountry] = useState('');
  const [symptomInputs, setSymptomInputs] = useState<string[]>(['', '', '']);
  const [providerName, setProviderName] = useState('');
  const [providerAddress, setProviderAddress] = useState('');
  const [providerCountry, setProviderCountry] = useState('');
  const [uploadingProof, setUploadingProof] = useState(false);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [saving, setSaving] = useState(false);
  const [documentsExpanded, setDocumentsExpanded] = useState(false);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);

  const [linking, setLinking] = useState(false);

  useEffect(() => {
    if (!selectedDraft) return;
    const updated = drafts.find((draft) => draft.id === selectedDraft.id);
    if (updated && updated !== selectedDraft) {
      setSelectedDraft(updated);
    }
  }, [drafts, selectedDraft]);

  useEffect(() => {
    setDocumentsExpanded(false);
  }, [selectedDraft?.id]);

  useEffect(() => {
    if (selectedDraft?.status === 'submitted') {
      api.getClaimByDraftId(selectedDraft.id)
        .then(setLinkedClaim)
        .catch(() => setLinkedClaim(null));
    } else {
      setLinkedClaim(null);
    }
  }, [selectedDraft?.id, selectedDraft?.status]);

  function resetDraftForm(draft: DraftClaim | null) {
    if (!draft) {
      setSelectedIllnessId('');
      setDoctorNotes('');
      setDateMode('calendar');
      setManualDate('');
      setSelectedCalendarIds([]);
      setSelectedProofIds([]);
      setSelectedDocumentIds([]);
      setPaymentProofNote('');
      setClaimType('Medical');
      setClaimCountry('');
      setSymptomInputs(['', '', '']);
      setProviderName('');
      setProviderAddress('');
      setProviderCountry('');
      return;
    }

    const submission = draft.submission ?? {};
    const illness = illnesses.find((item) => item.id === draft.illnessId);
    const patient = illness ? patients.find((item) => item.id === illness.patientId) : undefined;
    const providerAccount =
      illness?.relevantAccounts?.find((account) => account.role === 'provider') ??
      illness?.relevantAccounts?.[0];
    const symptomDefaults =
      submission.symptoms?.map((symptom) => symptom.name).filter(Boolean) ?? [];
    // Use defaultSymptoms from illness, or fall back to cignaSymptom/cignaDescription
    const illnessDefaultSymptoms = illness?.defaultSymptoms?.map((s) => s.name).filter(Boolean) ?? [];
    const legacySymptoms = [illness?.cignaSymptom?.trim(), illness?.cignaDescription?.trim()].filter(Boolean);
    const fallbackSymptoms =
      symptomDefaults.length > 0
        ? symptomDefaults
        : illnessDefaultSymptoms.length > 0
          ? illnessDefaultSymptoms
          : legacySymptoms;

    setSelectedIllnessId(draft.illnessId ?? '');
    setDoctorNotes(submission.progressReport ?? draft.doctorNotes ?? '');
    setSelectedCalendarIds(draft.calendarDocumentIds ?? []);
    setSelectedProofIds(draft.paymentProofDocumentIds ?? []);
    setSelectedDocumentIds(draft.documentIds ?? []);
    setPaymentProofNote(draft.paymentProofText ?? '');
    setClaimType(submission.claimType ?? 'Medical');
    setClaimCountry(submission.country ?? '');
    setSymptomInputs([
      fallbackSymptoms[0] ?? '',
      fallbackSymptoms[1] ?? '',
      fallbackSymptoms[2] ?? '',
    ]);
    setProviderName(submission.providerName ?? providerAccount?.name ?? providerAccount?.email ?? '');
    setProviderAddress(submission.providerAddress ?? '');
    setProviderCountry(
      submission.providerCountry ??
      submission.country ??
      patient?.workLocation ??
      patient?.citizenship ??
      ''
    );

    if (draft.treatmentDateSource === 'manual') {
      setDateMode('manual');
      setManualDate(draft.treatmentDate ? draft.treatmentDate.slice(0, 10) : '');
    } else {
      setDateMode('calendar');
      setManualDate('');
    }
  }

  function buildDraftUpdateInput(overrides?: {
    illnessId?: string;
    doctorNotes?: string;
    documentIds?: string[];
    calendarDocumentIds?: string[];
    paymentProofDocumentIds?: string[];
    paymentProofText?: string;
    submission?: DraftClaim['submission'];
  }) {
    const symptoms = symptomInputs
      .map((symptom) => symptom.trim())
      .filter(Boolean)
      .slice(0, 3)
      .map((symptom) => ({
        name: symptom,
        description: symptom,
      }));

    return {
      illnessId: selectedIllnessId,
      doctorNotes,
      documentIds: selectedDocumentIds,
      calendarDocumentIds: selectedCalendarIds,
      paymentProofDocumentIds: selectedProofIds,
      paymentProofText: paymentProofNote,
      submission: {
        claimType,
        country: claimCountry.trim(),
        symptoms,
        providerName,
        providerAddress,
        providerCountry,
        progressReport: doctorNotes,
      },
      ...overrides,
    };
  }

  function requireClaimCountry() {
    const trimmed = claimCountry.trim();
    if (!trimmed) {
      alert('Country of treatment is required');
      return null;
    }
    return trimmed;
  }

  // Save draft changes (works for pending and accepted drafts)
  async function handleSaveDraft() {
    if (!selectedDraft || selectedDraft.status === 'rejected') return;
    if (!requireClaimCountry()) {
      return;
    }

    setSaving(true);
    try {
      const updated = await api.updateDraftClaim(
        selectedDraft.id,
        buildDraftUpdateInput()
      );
      upsertItem(updated);
      setSelectedDraft(updated);
    } catch (err) {
      console.error('Save failed:', err);
      alert(`Save failed: ${err}`);
    } finally {
      setSaving(false);
    }
  }

  const attachProofFile = useCallback(
    async (file: File) => {
      if (!selectedDraft || selectedDraft.status === 'rejected') return;

      setUploadingProof(true);
      try {
        const result = await api.uploadProofFile(file);
        const nextProofIds = Array.from(
          new Set([...selectedProofIds, result.id])
        );

        setSelectedProofIds(nextProofIds);
        await refreshDocuments();

        const updated = await api.updateDraftClaim(
          selectedDraft.id,
          buildDraftUpdateInput({ paymentProofDocumentIds: nextProofIds })
        );
        upsertItem(updated);
        setSelectedDraft(updated);
      } catch (err) {
        console.error('Failed to upload proof:', err);
        alert(`Upload failed: ${err}`);
      } finally {
        setUploadingProof(false);
      }
    },
    [
      selectedDraft,
      selectedProofIds,
      selectedIllnessId,
      doctorNotes,
      selectedCalendarIds,
      paymentProofNote,
      upsertItem,
    ]
  );

  const attachAttachmentFile = useCallback(
    async (file: File) => {
      if (!selectedDraft || selectedDraft.status === 'rejected') return;

      setUploadingAttachment(true);
      try {
        const result = await api.uploadAttachmentFile(file);
        const nextDocIds = Array.from(new Set([...selectedDocumentIds, result.id]));
        setSelectedDocumentIds(nextDocIds);

        await refreshDocuments();

        const updated = await api.updateDraftClaim(
          selectedDraft.id,
          buildDraftUpdateInput({ documentIds: nextDocIds })
        );
        upsertItem(updated);
        setSelectedDraft(updated);
      } catch (err) {
        console.error('Failed to upload attachment:', err);
        alert(`Upload failed: ${err}`);
      } finally {
        setUploadingAttachment(false);
      }
    },
    [selectedDraft, selectedDocumentIds, upsertItem]
  );

  useEffect(() => {
    if (!selectedDraft || selectedDraft.status === 'rejected') return;

    const handlePaste = (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) return;

      const fileItem = Array.from(items).find(
        (item) =>
          item.kind === 'file' &&
          (item.type.startsWith('image/') || item.type === 'application/pdf')
      );
      if (!fileItem) return;

      const file = fileItem.getAsFile();
      if (!file) return;

      event.preventDefault();
      void attachProofFile(file);
    };

    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [selectedDraft?.id, selectedDraft?.status, attachProofFile]);

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
    submitted: drafts.filter((draft) => draft.status === 'submitted').length,
  };

  const filterItems: FilterTabItem<DraftFilter>[] = [
    { key: 'pending', label: 'Pending', count: counts.pending },
    { key: 'accepted', label: 'Accepted', count: counts.accepted },
    { key: 'submitted', label: 'Submitted', count: counts.submitted },
    { key: 'rejected', label: 'Rejected', count: counts.rejected },
    { key: 'all', label: 'All', count: drafts.length },
  ];

  const selectedDocument = selectedDraft
    ? documents.find((doc) => doc.id === selectedDraft.primaryDocumentId)
    : undefined;
  const documentsById = useMemo(() => new Map(documents.map((doc) => [doc.id, doc])), [
    documents,
  ]);
  const draftDocumentIds = selectedDraft?.documentIds ?? [];
  const draftProofIds = selectedDraft?.paymentProofDocumentIds ?? [];
  const allDocumentIds = useMemo(() => {
    const seen = new Set<string>();
    for (const id of draftDocumentIds) seen.add(id);
    for (const id of draftProofIds) seen.add(id);
    return Array.from(seen);
  }, [draftDocumentIds, draftProofIds]);

  // Currently attached supporting documents (excluding primary and proofs)
  // These may include documents from different email threads that were previously attached
  const attachedSupportingDocs = useMemo(() => {
    if (!selectedDraft) return [];
    const primaryId = selectedDraft.primaryDocumentId;
    const proofIds = new Set(selectedDraft.paymentProofDocumentIds ?? []);
    return selectedDocumentIds
      .filter((id) => id !== primaryId && !proofIds.has(id))
      .map((id) => documentsById.get(id))
      .filter((doc): doc is NonNullable<typeof doc> => !!doc);
  }, [selectedDraft, selectedDocumentIds, documentsById]);

  // Documents from the same email thread that can be added (not already attached)
  const sameThreadCandidates = useMemo(() => {
    if (!selectedDraft?.primaryDocumentId) return [];
    const primaryDoc = documentsById.get(selectedDraft.primaryDocumentId);
    if (!primaryDoc?.emailId) return [];

    return documents.filter(
      (doc) =>
        !doc.archivedAt &&
        doc.emailId === primaryDoc.emailId &&
        doc.sourceType !== 'calendar' &&
        doc.id !== selectedDraft.primaryDocumentId &&
        !selectedDocumentIds.includes(doc.id)
    );
  }, [documents, documentsById, selectedDraft?.primaryDocumentId, selectedDocumentIds]);

  // For form state (pending drafts)
  const selectedIllness = illnesses.find((illness) => illness.id === selectedIllnessId);
  const selectedPatient = selectedIllness
    ? patients.find((patient) => patient.id === selectedIllness.patientId)
    : undefined;

  // For accepted/rejected drafts, look up from draft data directly
  const draftIllness = selectedDraft?.illnessId
    ? illnesses.find((illness) => illness.id === selectedDraft.illnessId)
    : undefined;
  const draftPatient = draftIllness
    ? patients.find((patient) => patient.id === draftIllness.patientId)
    : undefined;

  // Helper to get patient name for a draft
  const getPatientNameForDraft = useCallback((draft: DraftClaim): string | undefined => {
    if (!draft.illnessId) return undefined;
    const illness = illnesses.find((i) => i.id === draft.illnessId);
    if (!illness) return undefined;
    const patient = patients.find((p) => p.id === illness.patientId);
    return patient?.name;
  }, [illnesses, patients]);
  // Get potential matches for the selected draft (from scraped claims)
  const draftMatchCandidate = useMemo(() => {
    if (!selectedDraft) return null;
    return matchCandidates.find(m => m.draftClaim.id === selectedDraft.id) ?? null;
  }, [matchCandidates, selectedDraft?.id]);

  // Get all scraped claims that could potentially match this draft (for manual linking)
  const potentialScrapedMatches = useMemo(() => {
    if (!selectedDraft || selectedDraft.status !== 'accepted') return [];
    // Filter scraped claims that aren't already linked to another draft
    return scrapedClaims.filter(sc => !sc.archivedAt);
  }, [scrapedClaims, selectedDraft?.id, selectedDraft?.status]);

  const draftCountry =
    selectedDraft?.submission?.country?.trim() ??
    (selectedDraft?.status === 'pending' ? claimCountry.trim() : '');
  const proofText =
    selectedDraft?.status === 'pending'
      ? paymentProofNote.trim()
      : selectedDraft?.paymentProofText ?? '';
  const proofProvided = activeProofIds.length > 0 || !!proofText;
  const proofSummary = proofProvided
    ? activeProofIds.length > 0
      ? `${activeProofIds.length} document${activeProofIds.length === 1 ? '' : 's'}${proofText ? ' + note' : ''
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
    if (!requireClaimCountry()) {
      return;
    }
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

  async function handleSubmitClaim() {
    if (!selectedDraft) return;
    if (!requireClaimCountry()) {
      return;
    }
    setProcessing('submit');
    try {
      const claim = await api.submitDraftClaim(selectedDraft.id);
      alert(`Submission started. Claim ID: ${claim.id}`);
    } catch (err) {
      console.error('Failed to submit claim:', err);
      alert(`Error: ${err}`);
    } finally {
      setProcessing(null);
    }
  }

  async function handleLinkToScrapedClaim(scrapedClaimId: string) {
    if (!selectedDraft) return;
    setLinking(true);
    try {
      const result = await api.acceptDraftClaimMatch(selectedDraft.id, scrapedClaimId);
      // Update the draft in local state - it's now "submitted"
      upsertItem(result.draft);
      setSelectedDraft(result.draft);
      alert(`Draft linked to Cigna claim ${result.cignaClaimNumber} (Submission #${result.submissionNumber})`);
      refreshMatches();
    } catch (err) {
      console.error('Failed to link draft to scraped claim:', err);
      alert(`Error: ${err}`);
    } finally {
      setLinking(false);
    }
  }

  async function handleAutoLink() {
    setProcessing('autolink');
    try {
      const result = await api.autoLinkDraftClaims();
      if (result.linked > 0) {
        alert(`Auto-linked ${result.linked} draft claims to Cigna submissions`);
        refreshDrafts();
        refreshMatches();
      } else {
        alert('No drafts could be auto-linked (no matching submission numbers found)');
      }
    } catch (err) {
      console.error('Failed to auto-link:', err);
      alert(`Error: ${err}`);
    } finally {
      setProcessing(null);
    }
  }

  function renderDocumentGroup(title: string, ids: string[]) {
    if (ids.length === 0) return null;
    return (
      <div>
        <p className="text-xs text-bauhaus-gray mb-1">{title}</p>
        <ul className="space-y-1">
          {ids.map((id) => {
            const doc = documentsById.get(id);
            const label = doc?.filename || doc?.subject || 'Document';
            return (
              <li key={id} className="flex items-center justify-between gap-2 text-sm">
                {doc?.attachmentPath ? (
                  <a
                    href={getDocumentFileUrl(id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-bauhaus-blue hover:underline inline-flex items-center gap-1 truncate"
                  >
                    {label}
                    <ExternalLink size={12} />
                  </a>
                ) : (
                  <span className="truncate">{label}</span>
                )}
                <span className="text-xs text-bauhaus-gray">
                  {doc?.date ? formatDate(doc.date) : 'No date'}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    );
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

  function toggleDocumentId(id: string) {
    // Don't allow removing the primary document
    if (id === selectedDraft?.primaryDocumentId) return;
    setSelectedDocumentIds((prev) =>
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
            onClick={handleAutoLink}
            disabled={processing !== null}
            className="flex items-center gap-2 px-4 py-2 bg-bauhaus-green text-white font-medium hover:bg-bauhaus-green/90 transition-colors disabled:opacity-60"
            title="Auto-link accepted drafts to Cigna claims by submission number"
          >
            <Check size={18} />
            {processing === 'autolink' ? 'Linking...' : 'Auto-Link Cigna'}
          </button>
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
                patientName={getPatientNameForDraft(draft)}
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
                patientName={getPatientNameForDraft(draft)}
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
                      selectedDraft.status === 'pending' ? (
                        <button
                          type="button"
                          onClick={() => setDocumentsExpanded((prev) => !prev)}
                          className={cn(
                            'inline-flex items-center gap-2 text-sm font-medium',
                            !proofProvided && 'text-bauhaus-red'
                          )}
                        >
                          {proofSummary}
                          <ChevronDown
                            size={14}
                            className={cn(
                              'transition-transform',
                              documentsExpanded && 'rotate-180'
                            )}
                          />
                        </button>
                      ) : (
                        <span>{proofSummary}</span>
                      )
                    }
                  />
                  {selectedDraft.treatmentDate && (
                    <DetailRow label="Treatment Date" value={formatDate(selectedDraft.treatmentDate)} />
                  )}
                  {draftCountry && (
                    <DetailRow label="Country of Treatment" value={draftCountry} />
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
                    <div className="mb-4">
                      <button
                        type="button"
                        onClick={() => setDocumentsExpanded((prev) => !prev)}
                        className="w-full flex items-center justify-between text-sm font-medium border-b border-bauhaus-lightgray pb-2"
                      >
                        <span>Documents</span>
                        <span className="flex items-center gap-2 text-xs text-bauhaus-gray">
                          {allDocumentIds.length} docs
                          <ChevronDown
                            size={16}
                            className={cn(
                              'transition-transform',
                              documentsExpanded && 'rotate-180'
                            )}
                          />
                        </span>
                      </button>
                      {documentsExpanded && (
                        <div className="mt-3 space-y-4">
                          {/* Primary document (read-only) */}
                          {selectedDraft.primaryDocumentId && (
                            <div>
                              <p className="text-xs text-bauhaus-gray mb-1">Primary document (required)</p>
                              <ul className="space-y-1">
                                {(() => {
                                  const doc = documentsById.get(selectedDraft.primaryDocumentId);
                                  const label = doc?.filename || doc?.subject || 'Document';
                                  return (
                                    <li className="flex items-center justify-between gap-2 text-sm p-2 bg-bauhaus-lightgray">
                                      {doc?.attachmentPath ? (
                                        <a
                                          href={getDocumentFileUrl(selectedDraft.primaryDocumentId)}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-bauhaus-blue hover:underline inline-flex items-center gap-1 truncate"
                                        >
                                          {label}
                                          <ExternalLink size={12} />
                                        </a>
                                      ) : (
                                        <span className="truncate">{label}</span>
                                      )}
                                      <span className="text-xs text-bauhaus-gray">
                                        {doc?.date ? formatDate(doc.date) : 'No date'}
                                      </span>
                                    </li>
                                  );
                                })()}
                              </ul>
                            </div>
                          )}

                          {/* Currently attached supporting documents */}
                          {attachedSupportingDocs.length > 0 && (
                            <div>
                              <p className="text-xs text-bauhaus-gray mb-1">
                                Attached supporting documents (uncheck to remove)
                              </p>
                              <ul className="max-h-32 overflow-auto border border-bauhaus-lightgray divide-y divide-bauhaus-lightgray">
                                {attachedSupportingDocs.map((doc) => {
                                  const primaryDoc = documentsById.get(selectedDraft.primaryDocumentId);
                                  const isDifferentThread = primaryDoc?.emailId && doc.emailId !== primaryDoc.emailId;
                                  return (
                                    <li key={doc.id} className={cn('p-2 flex items-start gap-2', isDifferentThread && 'bg-amber-50')}>
                                      <input
                                        type="checkbox"
                                        checked={true}
                                        onChange={() => toggleDocumentId(doc.id)}
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
                                              {doc.filename || doc.subject || 'Document'}
                                              <ExternalLink size={12} />
                                            </a>
                                          ) : (
                                            doc.filename || doc.subject || 'Document'
                                          )}
                                          {isDifferentThread && (
                                            <span className="text-xs px-1 bg-amber-200 text-amber-800">Different thread</span>
                                          )}
                                        </p>
                                        <p className="text-xs text-bauhaus-gray">
                                          {doc.date ? formatDate(doc.date) : 'No date'}
                                        </p>
                                      </div>
                                    </li>
                                  );
                                })}
                              </ul>
                            </div>
                          )}

                          {/* Same-thread documents that can be added */}
                          {sameThreadCandidates.length > 0 && (
                            <div>
                              <p className="text-xs text-bauhaus-gray mb-1">
                                Add from same email thread
                              </p>
                              <ul className="max-h-32 overflow-auto border border-bauhaus-lightgray divide-y divide-bauhaus-lightgray">
                                {sameThreadCandidates.map((doc) => (
                                  <li key={doc.id} className="p-2 flex items-start gap-2">
                                    <input
                                      type="checkbox"
                                      checked={false}
                                      onChange={() => toggleDocumentId(doc.id)}
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
                                            {doc.filename || doc.subject || 'Document'}
                                            <ExternalLink size={12} />
                                          </a>
                                        ) : (
                                          doc.filename || doc.subject || 'Document'
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

                          {/* Upload new attachment */}
                          <div>
                            <input
                              ref={attachmentInputRef}
                              type="file"
                              accept="image/*,application/pdf"
                              className="hidden"
                              onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                await attachAttachmentFile(file);
                                if (attachmentInputRef.current) {
                                  attachmentInputRef.current.value = '';
                                }
                              }}
                            />
                            <button
                              type="button"
                              onClick={() => attachmentInputRef.current?.click()}
                              disabled={uploadingAttachment}
                              className={cn(
                                'w-full flex items-center justify-center gap-2 p-2 border border-dashed border-bauhaus-gray text-bauhaus-gray hover:border-bauhaus-blue hover:text-bauhaus-blue transition-colors text-sm',
                                uploadingAttachment && 'opacity-60 cursor-not-allowed'
                              )}
                            >
                              <Upload size={14} />
                              {uploadingAttachment ? 'Uploading...' : 'Upload attachment'}
                            </button>
                          </div>

                          {/* Proof documents (reference - editing happens in proof section) */}
                          {selectedProofIds.length > 0 && renderDocumentGroup('Proof documents', selectedProofIds)}
                        </div>
                      )}
                    </div>
                    <div className="border-t-2 border-bauhaus-black pt-4 mb-4">
                      <h3 className="font-bold mb-3">Claim Details</h3>

                      <div className="mb-3">
                        <label className="block text-sm text-bauhaus-gray mb-1">Claim Type</label>
                        <select
                          value={claimType}
                          onChange={(e) => setClaimType(e.target.value as ClaimType)}
                          className="w-full p-2 border-2 border-bauhaus-black focus:outline-none focus:ring-2 focus:ring-bauhaus-blue"
                        >
                          <option value="Medical">Medical</option>
                          <option value="Vision">Vision</option>
                          <option value="Dental">Dental</option>
                        </select>
                      </div>

                      <div className="mb-3">
                        <label className="block text-sm text-bauhaus-gray mb-1">
                          Country of Treatment *
                        </label>
                        <input
                          type="text"
                          value={claimCountry}
                          onChange={(e) => setClaimCountry(e.target.value)}
                          className="w-full p-2 border-2 border-bauhaus-black focus:outline-none focus:ring-2 focus:ring-bauhaus-blue"
                          placeholder="Country where care was received"
                          required
                          aria-invalid={!claimCountry.trim()}
                        />
                        {!claimCountry.trim() && (
                          <p className="text-xs text-red-600 mt-1">
                            Country of treatment is required.
                          </p>
                        )}
                      </div>

                      <div className="mb-3">
                        <label className="block text-sm text-bauhaus-gray mb-2">
                          Symptoms / Diagnosis (up to 3)
                        </label>
                        <div className="space-y-2">
                          {symptomInputs.map((value, index) => (
                            <input
                              key={`symptom-${index}`}
                              type="text"
                              value={value}
                              onChange={(e) => {
                                const next = [...symptomInputs];
                                next[index] = e.target.value;
                                setSymptomInputs(next);
                              }}
                              className="w-full p-2 border-2 border-bauhaus-black focus:outline-none focus:ring-2 focus:ring-bauhaus-blue"
                              placeholder={`Symptom ${index + 1}`}
                            />
                          ))}
                        </div>
                      </div>

                      <div className="mb-3">
                        <label className="block text-sm text-bauhaus-gray mb-1">Provider Name</label>
                        <input
                          type="text"
                          value={providerName}
                          onChange={(e) => setProviderName(e.target.value)}
                          className="w-full p-2 border-2 border-bauhaus-black focus:outline-none focus:ring-2 focus:ring-bauhaus-blue"
                          placeholder="Provider or clinic name"
                        />
                      </div>

                      <div className="mb-3">
                        <label className="block text-sm text-bauhaus-gray mb-1">Provider Address</label>
                        <textarea
                          value={providerAddress}
                          onChange={(e) => setProviderAddress(e.target.value)}
                          className="w-full p-2 border-2 border-bauhaus-black focus:outline-none focus:ring-2 focus:ring-bauhaus-blue"
                          rows={2}
                          placeholder="Street, city, postcode"
                        />
                      </div>

                      <div className="mb-3">
                        <label className="block text-sm text-bauhaus-gray mb-1">Provider Country</label>
                        <input
                          type="text"
                          value={providerCountry}
                          onChange={(e) => setProviderCountry(e.target.value)}
                          className="w-full p-2 border-2 border-bauhaus-black focus:outline-none focus:ring-2 focus:ring-bauhaus-blue"
                          placeholder="Country of provider"
                        />
                      </div>

                      <div className="mb-3">
                        <label className="block text-sm text-bauhaus-gray mb-1">
                          Progress Report (Doctor Notes)
                        </label>
                        <textarea
                          value={doctorNotes}
                          onChange={(e) => setDoctorNotes(e.target.value)}
                          className="w-full p-3 border-2 border-bauhaus-black focus:outline-none focus:ring-2 focus:ring-bauhaus-blue"
                          rows={4}
                          placeholder="Summary of treatment and progress..."
                        />
                      </div>
                    </div>
                    <div className="border-t-2 border-bauhaus-black pt-4 mb-4">
                      <h3 className="font-bold mb-3">Acceptance Details</h3>

                      <div className="mb-3">
                        <label className="block text-sm text-bauhaus-gray mb-1">Illness</label>
                        <select
                          value={selectedIllnessId}
                          onChange={(e) => {
                            const newIllnessId = e.target.value;
                            setSelectedIllnessId(newIllnessId);

                            // Auto-fill symptoms from the selected illness
                            if (newIllnessId) {
                              const illness = illnesses.find((i) => i.id === newIllnessId);
                              if (illness) {
                                // Only auto-fill if current symptoms are empty
                                const currentSymptoms = symptomInputs.filter(Boolean);
                                if (currentSymptoms.length === 0) {
                                  const defaultSymptoms = illness.defaultSymptoms?.map((s) => s.name) ?? [];
                                  const legacySymptoms = [illness.cignaSymptom, illness.cignaDescription].filter(Boolean);
                                  const symptoms = defaultSymptoms.length > 0 ? defaultSymptoms : legacySymptoms;
                                  setSymptomInputs([
                                    symptoms[0] ?? '',
                                    symptoms[1] ?? '',
                                    symptoms[2] ?? '',
                                  ]);
                                }
                              }
                            }
                          }}
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
                              await attachProofFile(file);
                              if (fileInputRef.current) {
                                fileInputRef.current.value = '';
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
                            Supports images (PNG, JPG) and PDF files. Paste to attach.
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
                ) : selectedDraft.status === 'accepted' ? (
                  /* Accepted drafts - editable until promoted to Claim */
                  <div className="border-t-2 border-bauhaus-black pt-4">
                    <DetailRow label="Patient" value={draftPatient?.name ?? 'Unknown'} />
                    <DetailRow label="Illness" value={draftIllness?.name ?? selectedDraft.illnessId ?? 'Unknown'} />
                    <DetailRow
                      label="Country of Treatment"
                      value={selectedDraft.submission?.country ?? 'Unknown'}
                    />
                    {selectedDraft.doctorNotes && (
                      <DetailRow label="Doctor Notes" value={selectedDraft.doctorNotes} />
                    )}

                    {/* Editable documents section */}
                    <div className="mt-4 mb-4">
                      <button
                        type="button"
                        onClick={() => setDocumentsExpanded((prev) => !prev)}
                        className="w-full flex items-center justify-between text-sm font-medium border-b border-bauhaus-lightgray pb-2"
                      >
                        <span>Attached Documents</span>
                        <span className="flex items-center gap-2 text-xs text-bauhaus-gray">
                          {selectedDocumentIds.length} docs
                          <ChevronDown
                            size={16}
                            className={cn(
                              'transition-transform',
                              documentsExpanded && 'rotate-180'
                            )}
                          />
                        </span>
                      </button>
                      {documentsExpanded && (
                        <div className="mt-3 space-y-4">
                          {/* Primary document (read-only) */}
                          {selectedDraft.primaryDocumentId && (
                            <div>
                              <p className="text-xs text-bauhaus-gray mb-1">Primary document (required)</p>
                              <div className="p-2 bg-bauhaus-lightgray text-sm">
                                {(() => {
                                  const doc = documentsById.get(selectedDraft.primaryDocumentId);
                                  return doc?.attachmentPath ? (
                                    <a
                                      href={getDocumentFileUrl(selectedDraft.primaryDocumentId)}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-bauhaus-blue hover:underline inline-flex items-center gap-1"
                                    >
                                      {doc.filename || doc.subject || 'Document'}
                                      <ExternalLink size={12} />
                                    </a>
                                  ) : (
                                    <span>{doc?.filename || doc?.subject || 'Document'}</span>
                                  );
                                })()}
                              </div>
                            </div>
                          )}

                          {/* Currently attached supporting documents */}
                          {attachedSupportingDocs.length > 0 && (
                            <div>
                              <p className="text-xs text-bauhaus-gray mb-1">
                                Attached supporting documents (uncheck to remove)
                              </p>
                              <ul className="max-h-32 overflow-auto border border-bauhaus-lightgray divide-y divide-bauhaus-lightgray">
                                {attachedSupportingDocs.map((doc) => {
                                  const primaryDoc = documentsById.get(selectedDraft.primaryDocumentId);
                                  const isDifferentThread = primaryDoc?.emailId && doc.emailId !== primaryDoc.emailId;
                                  return (
                                    <li key={doc.id} className={cn('p-2 flex items-start gap-2', isDifferentThread && 'bg-amber-50')}>
                                      <input
                                        type="checkbox"
                                        checked={true}
                                        onChange={() => toggleDocumentId(doc.id)}
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
                                              {doc.filename || doc.subject || 'Document'}
                                              <ExternalLink size={12} />
                                            </a>
                                          ) : (
                                            doc.filename || doc.subject || 'Document'
                                          )}
                                          {isDifferentThread && (
                                            <span className="text-xs px-1 bg-amber-200 text-amber-800">Different thread</span>
                                          )}
                                        </p>
                                        <p className="text-xs text-bauhaus-gray">
                                          {doc.date ? formatDate(doc.date) : 'No date'}
                                        </p>
                                      </div>
                                    </li>
                                  );
                                })}
                              </ul>
                            </div>
                          )}

                          {/* Same-thread documents that can be added */}
                          {sameThreadCandidates.length > 0 && (
                            <div>
                              <p className="text-xs text-bauhaus-gray mb-1">
                                Add from same email thread
                              </p>
                              <ul className="max-h-32 overflow-auto border border-bauhaus-lightgray divide-y divide-bauhaus-lightgray">
                                {sameThreadCandidates.map((doc) => (
                                  <li key={doc.id} className="p-2 flex items-start gap-2">
                                    <input
                                      type="checkbox"
                                      checked={false}
                                      onChange={() => toggleDocumentId(doc.id)}
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
                                            {doc.filename || doc.subject || 'Document'}
                                            <ExternalLink size={12} />
                                          </a>
                                        ) : (
                                          doc.filename || doc.subject || 'Document'
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

                          {/* Upload new attachment */}
                          <div>
                            <input
                              ref={attachmentInputRef}
                              type="file"
                              accept="image/*,application/pdf"
                              className="hidden"
                              onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                await attachAttachmentFile(file);
                                if (attachmentInputRef.current) {
                                  attachmentInputRef.current.value = '';
                                }
                              }}
                            />
                            <button
                              type="button"
                              onClick={() => attachmentInputRef.current?.click()}
                              disabled={uploadingAttachment}
                              className={cn(
                                'w-full flex items-center justify-center gap-2 p-2 border border-dashed border-bauhaus-gray text-bauhaus-gray hover:border-bauhaus-blue hover:text-bauhaus-blue transition-colors text-sm',
                                uploadingAttachment && 'opacity-60 cursor-not-allowed'
                              )}
                            >
                              <Upload size={14} />
                              {uploadingAttachment ? 'Uploading...' : 'Upload attachment'}
                            </button>
                          </div>

                          {/* Proof documents */}
                          {selectedProofIds.length > 0 && (
                            <div>
                              <p className="text-xs text-bauhaus-gray mb-1">Payment proofs</p>
                              <ul className="space-y-1">
                                {selectedProofIds.map((id) => {
                                  const doc = documentsById.get(id);
                                  return (
                                    <li key={id} className="flex items-center gap-2 text-sm p-2 bg-emerald-50 border border-emerald-200">
                                      {doc?.attachmentPath ? (
                                        <a
                                          href={getDocumentFileUrl(id)}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-emerald-700 hover:underline inline-flex items-center gap-1 truncate"
                                        >
                                          {doc.filename || doc.subject || 'Proof'}
                                          <ExternalLink size={12} />
                                        </a>
                                      ) : (
                                        <span className="truncate">{doc?.filename || doc?.subject || 'Proof'}</span>
                                      )}
                                    </li>
                                  );
                                })}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Save button */}
                    <button
                      onClick={handleSaveDraft}
                      disabled={saving || processing !== null}
                      className={cn(
                        'w-full mb-4 px-4 py-2 text-sm font-medium bg-bauhaus-black text-white hover:bg-bauhaus-gray transition-colors',
                        (saving || processing !== null) && 'opacity-60 cursor-not-allowed'
                      )}
                    >
                      {saving ? 'Saving...' : 'Save Changes'}
                    </button>

                    {/* CIGNA MATCHING SECTION - Link to existing Cigna claims */}
                    <div className="border-t-2 border-bauhaus-blue pt-4 mt-4 mb-4">
                      <h3 className="font-bold mb-3 flex items-center gap-2 text-bauhaus-blue">
                        <Check size={18} />
                        Link to Cigna Claim
                      </h3>

                      {draftMatchCandidate ? (
                        /* Best match found automatically */
                        <div className="mb-3">
                          <div className="p-3 bg-bauhaus-green/10 border border-bauhaus-green mb-2">
                            <p className="text-xs font-medium text-bauhaus-green uppercase tracking-wide mb-2">
                              Match Found ({draftMatchCandidate.match.confidence} confidence)
                            </p>
                            <p className="font-medium">
                              Cigna #{draftMatchCandidate.scrapedClaim.cignaClaimNumber}
                            </p>
                            <p className="text-sm text-bauhaus-gray">
                              Submission #{draftMatchCandidate.scrapedClaim.submissionNumber}
                            </p>
                            <p className="text-sm">
                              {draftMatchCandidate.scrapedClaim.memberName} • {formatCurrency(draftMatchCandidate.scrapedClaim.claimAmount, draftMatchCandidate.scrapedClaim.claimCurrency)}
                            </p>
                            <p className="text-xs text-bauhaus-gray">
                              Treatment: {formatDate(draftMatchCandidate.scrapedClaim.treatmentDate)}
                            </p>
                            {draftMatchCandidate.match.matchMethod === 'heuristic' && (
                              <p className="text-xs text-bauhaus-gray mt-1">
                                Matched by: {draftMatchCandidate.match.matchDetails.amountMatch ? '✓ Amount' : ''} {draftMatchCandidate.match.matchDetails.patientMatch ? '✓ Patient' : ''} {draftMatchCandidate.match.matchDetails.treatmentDateMatch ? '✓ Date' : ''}
                              </p>
                            )}
                          </div>
                          <button
                            onClick={() => handleLinkToScrapedClaim(draftMatchCandidate.scrapedClaim.id)}
                            disabled={linking}
                            className={cn(
                              'w-full flex items-center justify-center gap-2 px-4 py-3 bg-bauhaus-green text-white font-medium hover:bg-bauhaus-green/90 transition-colors',
                              linking && 'opacity-60 cursor-not-allowed'
                            )}
                          >
                            <Check size={18} />
                            {linking ? 'Linking...' : 'Confirm & Mark as Submitted'}
                          </button>
                        </div>
                      ) : potentialScrapedMatches.length > 0 ? (
                        /* No auto-match, show manual selection */
                        <div className="mb-3">
                          <p className="text-xs text-bauhaus-gray mb-2">
                            No automatic match found. Select a Cigna claim to link:
                          </p>
                          <div className="max-h-40 overflow-auto border border-bauhaus-lightgray divide-y divide-bauhaus-lightgray">
                            {potentialScrapedMatches.slice(0, 10).map((sc) => (
                              <div
                                key={sc.id}
                                className="p-2 hover:bg-bauhaus-lightgray cursor-pointer"
                                onClick={() => handleLinkToScrapedClaim(sc.id)}
                              >
                                <div className="flex items-center justify-between">
                                  <span className="font-medium">#{sc.cignaClaimNumber}</span>
                                  <span className="font-bold text-sm">{formatCurrency(sc.claimAmount, sc.claimCurrency)}</span>
                                </div>
                                <div className="flex items-center justify-between text-xs text-bauhaus-gray">
                                  <span>{sc.memberName}</span>
                                  <span>{formatDate(sc.treatmentDate)}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        /* No scraped claims available */
                        <p className="text-sm text-bauhaus-gray mb-3">
                          No Cigna claims available to link. Run a scrape first.
                        </p>
                      )}

                      <p className="text-xs text-bauhaus-gray">
                        Linking marks this draft as "Submitted" with the Cigna claim ID.
                      </p>
                    </div>

                    {/* OR: Start new submission */}
                    <div className="border-t border-bauhaus-lightgray pt-4">
                      <p className="text-xs text-bauhaus-gray mb-2">
                        <strong>Or</strong> start a new submission to Cigna (opens browser):
                      </p>
                      <button
                        onClick={handleSubmitClaim}
                        disabled={processing !== null}
                        className={cn(
                          'w-full flex items-center justify-center gap-2 px-4 py-3 bg-bauhaus-blue text-white font-medium hover:bg-bauhaus-blue/90 transition-colors',
                          processing !== null && 'opacity-60 cursor-not-allowed'
                        )}
                      >
                        {processing === 'submit' ? 'Opening browser...' : 'Start Cigna Submission'}
                      </button>
                    </div>
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
                ) : selectedDraft.status === 'submitted' ? (
                  /* Submitted drafts - read-only with Cigna submission info */
                  <div className="border-t-2 border-bauhaus-green pt-4 space-y-1">
                    {/* Cigna Submission Info - highlighted */}
                    <div className="mb-4 p-3 bg-bauhaus-green/10 border border-bauhaus-green">
                      <p className="text-xs font-medium text-bauhaus-green uppercase tracking-wide mb-2">
                        Linked to Cigna
                      </p>
                      {/* Show from draft first (direct link), then fall back to linkedClaim */}
                      <DetailRow
                        label="Submission ID"
                        value={
                          selectedDraft.submissionNumber ? (
                            <span className="font-mono font-bold text-bauhaus-green">
                              {selectedDraft.submissionNumber}
                            </span>
                          ) : linkedClaim?.submissionNumber ? (
                            <span className="font-mono font-bold text-bauhaus-green">
                              {linkedClaim.submissionNumber}
                            </span>
                          ) : (
                            <span className="text-bauhaus-gray">Not available</span>
                          )
                        }
                      />
                      {(selectedDraft.cignaClaimNumber || linkedClaim?.cignaClaimId) && (
                        <DetailRow
                          label="Cigna Claim ID"
                          value={<span className="font-mono">{selectedDraft.cignaClaimNumber || linkedClaim?.cignaClaimId}</span>}
                        />
                      )}
                      {selectedDraft.linkedAt && (
                        <DetailRow label="Linked At" value={formatDate(selectedDraft.linkedAt)} />
                      )}
                      {linkedClaim?.submittedAt && (
                        <DetailRow label="Submitted At" value={formatDate(linkedClaim.submittedAt)} />
                      )}
                      {linkedClaim?.submissionUrl && (
                        <DetailRow
                          label="View on Cigna"
                          value={
                            <a
                              href={linkedClaim.submissionUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-bauhaus-blue hover:underline inline-flex items-center gap-1"
                            >
                              Open
                              <ExternalLink size={12} />
                            </a>
                          }
                        />
                      )}
                    </div>

                    {/* Claim Details */}
                    <DetailRow label="Patient" value={draftPatient?.name ?? 'Unknown'} />
                    <DetailRow label="Illness" value={draftIllness?.name ?? selectedDraft.illnessId ?? 'Unknown'} />
                    <DetailRow label="Amount" value={formatCurrency(selectedDraft.payment.amount, selectedDraft.payment.currency)} />
                    <DetailRow
                      label="Country of Treatment"
                      value={selectedDraft.submission?.country ?? 'Unknown'}
                    />
                    <DetailRow label="Treatment Date" value={selectedDraft.treatmentDate ? formatDate(selectedDraft.treatmentDate) : 'Unknown'} />
                    <DetailRow label="Claim Type" value={selectedDraft.submission?.claimType ?? 'Medical'} />

                    {selectedDraft.submission?.symptoms && selectedDraft.submission.symptoms.length > 0 && (
                      <DetailRow
                        label="Symptoms"
                        value={selectedDraft.submission.symptoms.map((s) => s.name).filter(Boolean).join(', ')}
                      />
                    )}

                    {selectedDraft.submission?.providerName && (
                      <DetailRow label="Provider" value={selectedDraft.submission.providerName} />
                    )}
                    {selectedDraft.submission?.providerAddress && (
                      <DetailRow label="Provider Address" value={selectedDraft.submission.providerAddress} />
                    )}

                    {selectedDraft.doctorNotes && (
                      <div className="mt-4">
                        <p className="text-xs text-bauhaus-gray mb-1">Doctor Notes / Progress Report</p>
                        <p className="text-sm whitespace-pre-wrap bg-bauhaus-lightgray/50 p-2 max-h-32 overflow-auto">
                          {selectedDraft.doctorNotes}
                        </p>
                      </div>
                    )}

                    {/* Documents (read-only) */}
                    <div className="mt-4">
                      <p className="text-xs text-bauhaus-gray mb-2">Attached Documents</p>
                      <ul className="space-y-1">
                        {selectedDraft.documentIds?.map((docId) => {
                          const doc = documentsById.get(docId);
                          return (
                            <li key={docId} className="text-sm p-2 bg-bauhaus-lightgray/30 flex items-center gap-2">
                              <FileText size={14} className="text-bauhaus-gray" />
                              {doc?.attachmentPath ? (
                                <a
                                  href={getDocumentFileUrl(docId)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-bauhaus-blue hover:underline inline-flex items-center gap-1"
                                >
                                  {doc.filename || doc.subject || 'Document'}
                                  <ExternalLink size={12} />
                                </a>
                              ) : (
                                <span>{doc?.filename || doc?.subject || 'Document'}</span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>

                    {/* Payment Proofs (read-only) */}
                    {selectedDraft.paymentProofDocumentIds && selectedDraft.paymentProofDocumentIds.length > 0 && (
                      <div className="mt-4">
                        <p className="text-xs text-bauhaus-gray mb-2">Payment Proofs</p>
                        <ul className="space-y-1">
                          {selectedDraft.paymentProofDocumentIds.map((docId) => {
                            const doc = documentsById.get(docId);
                            return (
                              <li key={docId} className="text-sm p-2 bg-emerald-50 border border-emerald-200 flex items-center gap-2">
                                <FileText size={14} className="text-emerald-600" />
                                {doc?.attachmentPath ? (
                                  <a
                                    href={getDocumentFileUrl(docId)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-emerald-700 hover:underline inline-flex items-center gap-1"
                                  >
                                    {doc.filename || doc.subject || 'Proof'}
                                    <ExternalLink size={12} />
                                  </a>
                                ) : (
                                  <span>{doc?.filename || doc?.subject || 'Proof'}</span>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}
                  </div>
                ) : (
                  /* Rejected drafts - read-only */
                  <div className="border-t-2 border-bauhaus-black pt-4">
                    <p className="text-sm text-bauhaus-gray">This draft claim was rejected.</p>
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
  patientName,
}: {
  draft: DraftClaim;
  document?: MedicalDocument;
  selected: boolean;
  onClick: () => void;
  patientName?: string;
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
      {/* Header row: status + classification + patient + date */}
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
          {patientName && (
            <span className="px-1.5 py-0.5 text-xs font-medium bg-bauhaus-black text-white">
              {patientName}
            </span>
          )}
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

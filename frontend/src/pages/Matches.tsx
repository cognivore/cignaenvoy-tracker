import { useState, useEffect, useCallback, useMemo } from 'react';
import { Check, X, FileText, ArrowRight, RefreshCw, AlertCircle, Sparkles, ExternalLink, Plus, Calendar, Mail, Users } from 'lucide-react';
import { cn, formatCurrency, formatDate, getScoreClass } from '@/lib/utils';
import { FilterTabs, type FilterTabItem, LoadingSpinner } from '@/components';
import {
  api,
  getDocumentFileUrl,
  type DocumentClaimAssignment,
  type ScrapedClaim,
  type MedicalDocument,
  type Patient,
  type Illness,
  type RelevantAccount,
  type CreateIllnessInput,
} from '@/lib/api';

interface EnrichedAssignment extends DocumentClaimAssignment {
  document?: MedicalDocument;
  claim?: ScrapedClaim;
}

export default function Matches() {
  const [assignments, setAssignments] = useState<EnrichedAssignment[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [illnesses, setIllnesses] = useState<Illness[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'candidate' | 'confirmed' | 'rejected' | 'all'>('candidate');
  const [selectedMatch, setSelectedMatch] = useState<EnrichedAssignment | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [draftScope, setDraftScope] = useState<'all' | 'drafts'>('all');
  const [acceptedDraftDocumentIds, setAcceptedDraftDocumentIds] = useState<string[]>([]);

  // Illness selection state
  const [selectedPatientId, setSelectedPatientId] = useState<string>('');
  const [selectedIllnessId, setSelectedIllnessId] = useState<string>('');
  const [showNewIllnessForm, setShowNewIllnessForm] = useState(false);
  const [newIllnessName, setNewIllnessName] = useState('');
  const [newIllnessType, setNewIllnessType] = useState<'acute' | 'chronic'>('acute');
  const [newIllnessIcdCode, setNewIllnessIcdCode] = useState('');

  // Account preview state
  const [previewAccounts, setPreviewAccounts] = useState<RelevantAccount[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);

  // Matching state
  const [runningMatching, setRunningMatching] = useState(false);

  useEffect(() => {
    loadAssignments();
  }, []);

  // Load account preview when a match is selected
  const loadAccountPreview = useCallback(async (assignmentId: string) => {
    setLoadingAccounts(true);
    try {
      const result = await api.previewAccounts(assignmentId);
      setPreviewAccounts(result.accounts);
    } catch (err) {
      console.error('Failed to load account preview:', err);
      setPreviewAccounts([]);
    } finally {
      setLoadingAccounts(false);
    }
  }, []);

  // Load illnesses when patient is selected
  useEffect(() => {
    if (selectedPatientId) {
      api.getPatientIllnesses(selectedPatientId).then(setIllnesses).catch(console.error);
    } else {
      setIllnesses([]);
    }
    setSelectedIllnessId('');
    setShowNewIllnessForm(false);
  }, [selectedPatientId]);

  async function loadAssignments() {
    setLoading(true);
    try {
      const [assignmentsList, claimsList, docsList, patientsList, draftClaims] = await Promise.all([
        api.getAssignments(),
        api.getClaims(),
        api.getDocuments(),
        api.getPatients(),
        api.getDraftClaims(),
      ]);

      // Enrich assignments with document and claim data
      const enriched = assignmentsList.map(a => ({
        ...a,
        document: docsList.find(d => d.id === a.documentId),
        claim: claimsList.find(c => c.id === a.claimId),
      }));

      setAssignments(enriched);
      setPatients(patientsList);

      const acceptedDraftDocs = new Set(
        draftClaims
          .filter((draft) => draft.status === 'accepted')
          .flatMap((draft) => draft.documentIds)
      );
      setAcceptedDraftDocumentIds(Array.from(acceptedDraftDocs));
    } catch (err) {
      console.error('Failed to load assignments:', err);
    } finally {
      setLoading(false);
    }
  }

  const scopedAssignments = draftScope === 'drafts'
    ? assignments.filter(a => acceptedDraftDocumentIds.includes(a.documentId))
    : assignments;

  const filteredAssignments = useMemo(() => {
    const base = filter === 'all'
      ? scopedAssignments
      : scopedAssignments.filter(a => a.status === filter);
    // Sort by matchScore descending, then by createdAt descending
    return [...base].sort((a, b) => {
      if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [scopedAssignments, filter]);

  const counts = {
    candidate: scopedAssignments.filter(a => a.status === 'candidate').length,
    confirmed: scopedAssignments.filter(a => a.status === 'confirmed').length,
    rejected: scopedAssignments.filter(a => a.status === 'rejected').length,
  };

  const draftMatchCount = assignments.filter(a =>
    acceptedDraftDocumentIds.includes(a.documentId)
  ).length;

  type MatchFilter = 'candidate' | 'confirmed' | 'rejected' | 'all';
  const filterItems: FilterTabItem<MatchFilter>[] = useMemo(() => [
    { key: 'candidate', label: 'Pending Review', count: counts.candidate, color: 'bg-bauhaus-yellow' },
    { key: 'confirmed', label: 'Confirmed', count: counts.confirmed, color: 'bg-bauhaus-blue' },
    { key: 'rejected', label: 'Rejected', count: counts.rejected, color: 'bg-bauhaus-red' },
    { key: 'all', label: 'All', count: scopedAssignments.length, color: 'bg-bauhaus-gray' },
  ], [counts, scopedAssignments.length]);

  async function handleCreateIllness() {
    if (!selectedPatientId || !newIllnessName) return;

    try {
      const input: CreateIllnessInput = {
        patientId: selectedPatientId,
        name: newIllnessName,
        type: newIllnessType,
        ...(newIllnessIcdCode && { icdCode: newIllnessIcdCode }),
      };
      const illness = await api.createIllness(input);
      setIllnesses(prev => [...prev, illness]);
      setSelectedIllnessId(illness.id);
      setShowNewIllnessForm(false);
      setNewIllnessName('');
      setNewIllnessIcdCode('');
    } catch (err) {
      console.error('Failed to create illness:', err);
      alert(`Error: ${err}`);
    }
  }

  async function handleConfirm(id: string) {
    if (!selectedIllnessId) {
      alert('Please select an illness before confirming');
      return;
    }

    try {
      await api.confirmAssignment(id, selectedIllnessId, reviewNotes || undefined);
      setAssignments(prev => prev.map(a =>
        a.id === id
          ? { ...a, status: 'confirmed' as const, illnessId: selectedIllnessId, confirmedAt: new Date().toISOString(), reviewNotes }
          : a
      ));
      setSelectedMatch(null);
      setReviewNotes('');
      setSelectedPatientId('');
      setSelectedIllnessId('');
      setPreviewAccounts([]);
    } catch (err) {
      console.error('Failed to confirm:', err);
      alert(`Error: ${err}`);
    }
  }

  async function handleReject(id: string) {
    try {
      await api.rejectAssignment(id, reviewNotes || undefined);
      setAssignments(prev => prev.map(a =>
        a.id === id
          ? { ...a, status: 'rejected' as const, reviewNotes }
          : a
      ));
      setSelectedMatch(null);
      setReviewNotes('');
      setSelectedPatientId('');
      setSelectedIllnessId('');
      setPreviewAccounts([]);
    } catch (err) {
      console.error('Failed to reject:', err);
      alert(`Error: ${err}`);
    }
  }

  // Handle match selection
  function handleSelectMatch(match: EnrichedAssignment) {
    setSelectedMatch(match);
    setReviewNotes(match.reviewNotes || '');
    setSelectedPatientId('');
    setSelectedIllnessId('');
    setShowNewIllnessForm(false);
    setPreviewAccounts([]);

    // Load account preview for candidates
    if (match.status === 'candidate') {
      loadAccountPreview(match.id);
    }
  }

  // Handle running auto-matching
  async function handleRunMatching() {
    setRunningMatching(true);
    try {
      const result = await api.runMatching();
      console.log(`Created ${result.created} match candidates`);
      // Reload assignments to show new matches
      await loadAssignments();
    } catch (err) {
      console.error('Failed to run matching:', err);
      alert(`Error running matching: ${err}`);
    } finally {
      setRunningMatching(false);
    }
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold bauhaus-accent">Match Review</h1>
          <p className="text-bauhaus-gray mt-1">
            Review and confirm document-to-claim matches
          </p>
        </div>
        <button
          onClick={loadAssignments}
          className="flex items-center gap-2 px-4 py-2 bg-bauhaus-black text-white font-medium hover:bg-bauhaus-gray transition-colors"
        >
          <RefreshCw size={18} />
          Refresh
        </button>
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        <button
          onClick={() => setDraftScope('all')}
          className={cn(
            'px-4 py-2 font-medium transition-colors flex items-center gap-2 border-2',
            draftScope === 'all'
              ? 'bg-bauhaus-black text-white border-bauhaus-black'
              : 'bg-white border-bauhaus-black hover:bg-bauhaus-lightgray'
          )}
        >
          All Matches
          <span className={cn(
            'text-xs px-1.5 py-0.5 rounded-full',
            draftScope === 'all' ? 'bg-white text-bauhaus-black' : 'bg-bauhaus-lightgray'
          )}>
            {assignments.length}
          </span>
        </button>
        <button
          onClick={() => setDraftScope('drafts')}
          className={cn(
            'px-4 py-2 font-medium transition-colors flex items-center gap-2 border-2',
            draftScope === 'drafts'
              ? 'bg-bauhaus-black text-white border-bauhaus-black'
              : 'bg-white border-bauhaus-black hover:bg-bauhaus-lightgray'
          )}
        >
          Draft Matches
          <span className={cn(
            'text-xs px-1.5 py-0.5 rounded-full',
            draftScope === 'drafts' ? 'bg-white text-bauhaus-black' : 'bg-bauhaus-lightgray'
          )}>
            {draftMatchCount}
          </span>
        </button>
      </div>

      {/* Filter tabs */}
      <div className="mb-6">
        <FilterTabs items={filterItems} active={filter} onChange={setFilter} />
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : filteredAssignments.length === 0 ? (
        <EmptyState filter={filter} onRunMatching={handleRunMatching} isRunning={runningMatching} />
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* Matches list */}
          <div className="space-y-4">
            {filteredAssignments.map((match) => (
              <MatchCard
                key={match.id}
                match={match}
                selected={selectedMatch?.id === match.id}
                onClick={() => handleSelectMatch(match)}
              />
            ))}
          </div>

          {/* Match detail / Review panel */}
          {selectedMatch && (
            <div className="bauhaus-card h-fit sticky top-8">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold">Review Match</h2>
                <div className="flex items-center gap-2">
                  <div className={cn(
                    'w-3 h-3 rounded-full',
                    selectedMatch.status === 'candidate' && 'bg-bauhaus-yellow',
                    selectedMatch.status === 'confirmed' && 'bg-bauhaus-blue',
                    selectedMatch.status === 'rejected' && 'bg-bauhaus-red',
                  )} />
                  <span className="text-sm font-medium capitalize">
                    {selectedMatch.status}
                  </span>
                </div>
              </div>

              {/* Score */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-bauhaus-gray">Match Score</span>
                  <span className="font-bold text-2xl">{Math.round(selectedMatch.matchScore)}%</span>
                </div>
                <div className="score-bar">
                  <div
                    className={cn('score-bar-fill', getScoreClass(selectedMatch.matchScore))}
                    style={{ width: `${Math.round(selectedMatch.matchScore)}%` }}
                  />
                </div>
              </div>

              {/* Side by side comparison */}
              <div className="grid grid-cols-2 gap-4 mb-6">
                {/* Document */}
                <div className="p-4 bg-bauhaus-lightgray/50 border border-bauhaus-lightgray">
                  <div className="flex items-center gap-2 mb-3">
                    {selectedMatch.document?.sourceType === 'calendar' ? (
                      <Calendar size={16} className="text-purple-600" />
                    ) : (
                      <FileText size={16} className="text-bauhaus-gray" />
                    )}
                    <span className="text-sm font-medium uppercase text-bauhaus-gray">
                      {selectedMatch.document?.sourceType === 'calendar' ? 'Calendar Event' : 'Document'}
                    </span>
                  </div>
                  {selectedMatch.document ? (
                    <>
                      {selectedMatch.document.sourceType === 'calendar' ? (
                        // Calendar event display
                        <>
                          <p className="font-medium truncate">
                            {selectedMatch.document.calendarSummary || selectedMatch.document.subject}
                          </p>
                          {selectedMatch.document.calendarLocation && (
                            <p className="text-sm text-bauhaus-gray truncate">
                              {selectedMatch.document.calendarLocation}
                            </p>
                          )}
                          {selectedMatch.document.calendarStart && (
                            <p className="text-sm text-bauhaus-gray">
                              {formatDate(selectedMatch.document.calendarStart)}
                              {selectedMatch.document.calendarAllDay && ' (All day)'}
                            </p>
                          )}
                          {selectedMatch.document.calendarOrganizer?.displayName && (
                            <p className="text-xs text-bauhaus-gray mt-1">
                              Organizer: {selectedMatch.document.calendarOrganizer.displayName}
                            </p>
                          )}
                        </>
                      ) : selectedMatch.document.attachmentPath ? (
                        <a
                          href={getDocumentFileUrl(selectedMatch.document.id)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-bauhaus-blue hover:underline truncate block"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {selectedMatch.document.filename || selectedMatch.document.subject}
                          <ExternalLink size={14} className="inline ml-1" />
                        </a>
                      ) : (
                        <p className="font-medium truncate">
                          {selectedMatch.document.filename || selectedMatch.document.subject}
                        </p>
                      )}
                      {selectedMatch.document.sourceType !== 'calendar' && selectedMatch.document.date && (
                        <p className="text-sm text-bauhaus-gray">
                          {formatDate(selectedMatch.document.date)}
                        </p>
                      )}
                      {selectedMatch.document.detectedAmounts[0] && (
                        <p className="font-bold text-bauhaus-blue mt-2">
                          {formatCurrency(
                            selectedMatch.document.detectedAmounts[0].value,
                            selectedMatch.document.detectedAmounts[0].currency
                          )}
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-bauhaus-gray">Document not found</p>
                  )}
                </div>

                {/* Claim */}
                <div className="p-4 bg-bauhaus-lightgray/50 border border-bauhaus-lightgray">
                  <div className="flex items-center gap-2 mb-3">
                    <FileText size={16} className="text-bauhaus-gray" />
                    <span className="text-sm font-medium uppercase text-bauhaus-gray">Claim</span>
                  </div>
                  {selectedMatch.claim ? (
                    <>
                      <p className="font-medium">
                        #{selectedMatch.claim.cignaClaimNumber}
                      </p>
                      <p className="text-sm text-bauhaus-gray">
                        Submitted: {formatDate(selectedMatch.claim.submissionDate)}
                      </p>
                      {/* Treatment dates from line items */}
                      {selectedMatch.claim.lineItems && selectedMatch.claim.lineItems.length > 0 && (
                        <div className="text-sm mt-2">
                          <span className="text-bauhaus-gray">Treatments:</span>
                          <ul className="mt-1 space-y-1">
                            {selectedMatch.claim.lineItems.map((item, idx) => (
                              <li key={idx} className="text-xs">
                                <span className="font-medium">{formatDate(item.treatmentDate)}</span>
                                <span className="text-bauhaus-gray"> — {item.treatmentDescription}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <p className="font-bold text-bauhaus-blue mt-2">
                        {formatCurrency(
                          selectedMatch.claim.claimAmount,
                          selectedMatch.claim.claimCurrency
                        )}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-bauhaus-gray">Claim not found</p>
                  )}
                </div>
              </div>

              {/* Match reasons */}
              <div className="mb-6">
                <h3 className="font-bold mb-2 flex items-center gap-2">
                  <Sparkles size={16} />
                  Match Reasons
                </h3>
                <div className="p-3 bg-bauhaus-lightgray/50 border border-bauhaus-lightgray">
                  <p className="text-sm">{selectedMatch.matchReason}</p>
                </div>
              </div>

              {/* Amount details */}
              {selectedMatch.amountMatchDetails && (
                <div className="mb-6">
                  <h3 className="font-bold mb-2">Amount Comparison</h3>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-bauhaus-gray">Document</p>
                      <p className="font-medium">
                        {formatCurrency(
                          selectedMatch.amountMatchDetails.documentAmount,
                          selectedMatch.amountMatchDetails.documentCurrency
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-bauhaus-gray">Claim</p>
                      <p className="font-medium">
                        {formatCurrency(
                          selectedMatch.amountMatchDetails.claimAmount,
                          selectedMatch.amountMatchDetails.claimCurrency
                        )}
                      </p>
                    </div>
                  </div>
                  <p className="text-sm text-bauhaus-gray mt-2">
                    Difference: {(selectedMatch.amountMatchDetails.differencePercent * 100).toFixed(1)}%
                  </p>
                </div>
              )}

              {/* Illness Selection - Required for confirmation */}
              {selectedMatch.status === 'candidate' && (
                <div className="mb-6">
                  <h3 className="font-bold mb-2 flex items-center gap-2">
                    <Users size={16} />
                    Link to Illness (Required)
                  </h3>

                  {/* Patient selector */}
                  <div className="mb-3">
                    <label className="block text-sm text-bauhaus-gray mb-1">Patient</label>
                    <select
                      value={selectedPatientId}
                      onChange={(e) => setSelectedPatientId(e.target.value)}
                      className="w-full p-2 border-2 border-bauhaus-black focus:outline-none focus:ring-2 focus:ring-bauhaus-blue"
                    >
                      <option value="">Select a patient...</option>
                      {patients.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.relationship})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Illness selector */}
                  {selectedPatientId && (
                    <div className="mb-3">
                      <label className="block text-sm text-bauhaus-gray mb-1">Illness / Condition</label>
                      {illnesses.length > 0 && !showNewIllnessForm && (
                        <select
                          value={selectedIllnessId}
                          onChange={(e) => setSelectedIllnessId(e.target.value)}
                          className="w-full p-2 border-2 border-bauhaus-black focus:outline-none focus:ring-2 focus:ring-bauhaus-blue mb-2"
                        >
                          <option value="">Select an illness...</option>
                          {illnesses.map(i => (
                            <option key={i.id} value={i.id}>
                              {i.name} ({i.type}) {i.icdCode ? `- ${i.icdCode}` : ''}
                            </option>
                          ))}
                        </select>
                      )}
                      {!showNewIllnessForm && (
                        <button
                          onClick={() => setShowNewIllnessForm(true)}
                          className="flex items-center gap-1 text-sm text-bauhaus-blue hover:underline"
                        >
                          <Plus size={14} />
                          Register new illness
                        </button>
                      )}
                    </div>
                  )}

                  {/* New illness form */}
                  {showNewIllnessForm && (
                    <div className="p-3 bg-bauhaus-lightgray/50 border border-bauhaus-lightgray mb-3">
                      <h4 className="font-medium mb-2">Register New Illness</h4>
                      <div className="space-y-2">
                        <input
                          type="text"
                          value={newIllnessName}
                          onChange={(e) => setNewIllnessName(e.target.value)}
                          placeholder="Illness name (e.g., Anxiety)"
                          className="w-full p-2 border border-bauhaus-gray text-sm"
                        />
                        <select
                          value={newIllnessType}
                          onChange={(e) => setNewIllnessType(e.target.value as 'acute' | 'chronic')}
                          className="w-full p-2 border border-bauhaus-gray text-sm"
                        >
                          <option value="acute">Acute (temporary)</option>
                          <option value="chronic">Chronic (ongoing)</option>
                        </select>
                        <input
                          type="text"
                          value={newIllnessIcdCode}
                          onChange={(e) => setNewIllnessIcdCode(e.target.value)}
                          placeholder="ICD Code (optional)"
                          className="w-full p-2 border border-bauhaus-gray text-sm"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={handleCreateIllness}
                            disabled={!newIllnessName}
                            className="flex-1 px-3 py-2 bg-bauhaus-blue text-white text-sm font-medium disabled:opacity-50"
                          >
                            Create
                          </button>
                          <button
                            onClick={() => {
                              setShowNewIllnessForm(false);
                              setNewIllnessName('');
                              setNewIllnessIcdCode('');
                            }}
                            className="px-3 py-2 border border-bauhaus-gray text-sm"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Account Preview */}
              {selectedMatch.status === 'candidate' && (
                <div className="mb-6">
                  <h3 className="font-bold mb-2 flex items-center gap-2">
                    <Mail size={16} />
                    Accounts to Extract
                  </h3>
                  <div className="p-3 bg-bauhaus-lightgray/50 border border-bauhaus-lightgray">
                    {loadingAccounts ? (
                      <p className="text-sm text-bauhaus-gray">Loading...</p>
                    ) : previewAccounts.length === 0 ? (
                      <p className="text-sm text-bauhaus-gray">No accounts will be extracted from this document</p>
                    ) : (
                      <ul className="space-y-1">
                        {previewAccounts.map((account, idx) => (
                          <li key={idx} className="text-sm flex items-center gap-2">
                            <span className={cn(
                              'px-1.5 py-0.5 text-xs font-medium rounded',
                              account.role === 'provider' && 'bg-bauhaus-blue/20 text-bauhaus-blue',
                              account.role === 'pharmacy' && 'bg-green-100 text-green-700',
                              account.role === 'lab' && 'bg-purple-100 text-purple-700',
                              account.role === 'insurance' && 'bg-orange-100 text-orange-700',
                              (!account.role || account.role === 'other') && 'bg-gray-100 text-gray-600'
                            )}>
                              {account.role || 'other'}
                            </span>
                            <span className="font-medium">{account.email}</span>
                            {account.name && (
                              <span className="text-bauhaus-gray">({account.name})</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="text-xs text-bauhaus-gray mt-2">
                      These accounts will be added to the illness's relevant accounts on confirmation
                    </p>
                  </div>
                </div>
              )}

              {/* Review notes */}
              {selectedMatch.status === 'candidate' && (
                <div className="mb-6">
                  <label className="block font-bold mb-2">Review Notes</label>
                  <textarea
                    value={reviewNotes}
                    onChange={(e) => setReviewNotes(e.target.value)}
                    className="w-full p-3 border-2 border-bauhaus-black focus:outline-none focus:ring-2 focus:ring-bauhaus-blue"
                    rows={2}
                    placeholder="Add notes about this match..."
                  />
                </div>
              )}

              {/* Actions */}
              {selectedMatch.status === 'candidate' && (
                <div className="flex gap-3">
                  <button
                    onClick={() => handleConfirm(selectedMatch.id)}
                    disabled={!selectedIllnessId}
                    className={cn(
                      "flex-1 flex items-center justify-center gap-2 px-4 py-3 text-white font-medium transition-colors",
                      selectedIllnessId
                        ? "bg-bauhaus-blue hover:bg-bauhaus-blue/90"
                        : "bg-bauhaus-gray cursor-not-allowed"
                    )}
                  >
                    <Check size={18} />
                    {selectedIllnessId ? 'Confirm Match' : 'Select Illness First'}
                  </button>
                  <button
                    onClick={() => handleReject(selectedMatch.id)}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-bauhaus-red text-white font-medium hover:bg-bauhaus-red/90 transition-colors"
                  >
                    <X size={18} />
                    Reject
                  </button>
                </div>
              )}

              {selectedMatch.status !== 'candidate' && selectedMatch.reviewNotes && (
                <div className="p-3 bg-bauhaus-lightgray/50 border border-bauhaus-lightgray">
                  <p className="text-sm font-medium mb-1">Review Notes</p>
                  <p className="text-sm">{selectedMatch.reviewNotes}</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MatchCard({
  match,
  selected,
  onClick,
}: {
  match: EnrichedAssignment;
  selected: boolean;
  onClick: () => void;
}) {
  const isCalendar = match.document?.sourceType === 'calendar';

  return (
    <div
      onClick={onClick}
      className={cn(
        'bauhaus-card cursor-pointer',
        selected && 'ring-2 ring-bauhaus-blue'
      )}
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className={cn(
            'w-2 h-2 rounded-full',
            match.status === 'candidate' && 'bg-bauhaus-yellow',
            match.status === 'confirmed' && 'bg-bauhaus-blue',
            match.status === 'rejected' && 'bg-bauhaus-red',
          )} />
          <span className="text-sm font-medium capitalize">{match.status}</span>
          {isCalendar && (
            <span className="flex items-center gap-1 text-xs px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded">
              <Calendar size={12} />
              Calendar
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className={cn(
            'text-lg font-bold',
            match.matchScore >= 80 && 'text-bauhaus-blue',
            match.matchScore >= 60 && match.matchScore < 80 && 'text-bauhaus-yellow',
            match.matchScore < 60 && 'text-bauhaus-red',
          )}>
            {Math.round(match.matchScore)}%
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          {match.document?.attachmentPath ? (
            <a
              href={getDocumentFileUrl(match.document.id)}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium truncate block text-bauhaus-blue hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {match.document?.filename || match.document?.subject || 'Document'}
            </a>
          ) : (
            <p className="font-medium truncate">
              {isCalendar
                ? match.document?.calendarSummary || match.document?.subject || 'Calendar Event'
                : match.document?.filename || match.document?.subject || 'Document'}
            </p>
          )}
          <p className="text-sm text-bauhaus-gray truncate">
            {isCalendar
              ? (match.document?.calendarLocation || match.document?.calendarOrganizer?.displayName || match.document?.calendarOrganizer?.email)
              : match.document?.fromAddress}
          </p>
          {isCalendar && match.document?.calendarStart && (
            <p className="text-xs text-bauhaus-gray">
              {formatDate(match.document.calendarStart)}
            </p>
          )}
        </div>
        <ArrowRight size={20} className="text-bauhaus-gray flex-shrink-0" />
        <div className="flex-1 min-w-0 text-right">
          <p className="font-medium">
            #{match.claim?.cignaClaimNumber || 'Unknown'}
          </p>
          <p className="text-sm text-bauhaus-gray">
            {match.claim && formatCurrency(match.claim.claimAmount, match.claim.claimCurrency)}
          </p>
          {match.claim?.submissionDate && (
            <p className="text-xs text-bauhaus-gray">
              Submitted {formatDate(match.claim.submissionDate)}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyState({
  filter,
  onRunMatching,
  isRunning
}: {
  filter: string;
  onRunMatching: () => void;
  isRunning: boolean;
}) {
  const messages: Record<string, { title: string; description: string }> = {
    candidate: {
      title: 'No Pending Reviews',
      description: 'Run auto-matching to find document-claim matches',
    },
    confirmed: {
      title: 'No Confirmed Matches',
      description: 'Confirmed matches will appear here',
    },
    rejected: {
      title: 'No Rejected Matches',
      description: 'Rejected matches will appear here',
    },
    all: {
      title: 'No Matches Yet',
      description: 'Run auto-matching to find document-claim matches',
    },
  };

  const { title, description } = messages[filter] || messages.all;

  return (
    <div className="bauhaus-card text-center py-16">
      <div className="w-16 h-16 bg-bauhaus-lightgray rounded-full mx-auto mb-4 flex items-center justify-center">
        <AlertCircle size={32} className="text-bauhaus-gray" />
      </div>
      <h2 className="text-xl font-bold mb-2">{title}</h2>
      <p className="text-bauhaus-gray mb-6">{description}</p>
      {(filter === 'candidate' || filter === 'all') && (
        <button
          onClick={onRunMatching}
          disabled={isRunning}
          className={cn(
            "px-6 py-3 text-white font-medium transition-colors",
            isRunning
              ? "bg-bauhaus-gray cursor-wait"
              : "bg-bauhaus-blue hover:bg-bauhaus-blue/90"
          )}
        >
          {isRunning ? 'Running...' : 'Run Auto-Matching'}
        </button>
      )}
    </div>
  );
}

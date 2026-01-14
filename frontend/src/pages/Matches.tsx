import { useState, useEffect } from 'react';
import { Check, X, FileText, ArrowRight, RefreshCw, AlertCircle, Sparkles, ExternalLink } from 'lucide-react';
import { cn, formatCurrency, formatDate, getScoreClass } from '@/lib/utils';
import {
  api,
  getDocumentFileUrl,
  type DocumentClaimAssignment,
  type ScrapedClaim,
  type MedicalDocument
} from '@/lib/api';

interface EnrichedAssignment extends DocumentClaimAssignment {
  document?: MedicalDocument;
  claim?: ScrapedClaim;
}

export default function Matches() {
  const [assignments, setAssignments] = useState<EnrichedAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'candidate' | 'confirmed' | 'rejected' | 'all'>('candidate');
  const [selectedMatch, setSelectedMatch] = useState<EnrichedAssignment | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');

  useEffect(() => {
    loadAssignments();
  }, []);

  async function loadAssignments() {
    setLoading(true);
    try {
      const [assignmentsList, claimsList, docsList] = await Promise.all([
        api.getAssignments(),
        api.getClaims(),
        api.getDocuments(),
      ]);

      // Enrich assignments with document and claim data
      const enriched = assignmentsList.map(a => ({
        ...a,
        document: docsList.find(d => d.id === a.documentId),
        claim: claimsList.find(c => c.id === a.claimId),
      }));

      setAssignments(enriched);
    } catch (err) {
      console.error('Failed to load assignments:', err);
    } finally {
      setLoading(false);
    }
  }

  const filteredAssignments = filter === 'all'
    ? assignments
    : assignments.filter(a => a.status === filter);

  const counts = {
    candidate: assignments.filter(a => a.status === 'candidate').length,
    confirmed: assignments.filter(a => a.status === 'confirmed').length,
    rejected: assignments.filter(a => a.status === 'rejected').length,
  };

  async function handleConfirm(id: string) {
    try {
      await api.confirmAssignment(id, reviewNotes || undefined);
      setAssignments(prev => prev.map(a =>
        a.id === id
          ? { ...a, status: 'confirmed' as const, confirmedAt: new Date().toISOString(), reviewNotes }
          : a
      ));
      setSelectedMatch(null);
      setReviewNotes('');
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
    } catch (err) {
      console.error('Failed to reject:', err);
      alert(`Error: ${err}`);
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

      {/* Filter tabs */}
      <div className="flex gap-2 mb-6">
        <FilterTab
          active={filter === 'candidate'}
          onClick={() => setFilter('candidate')}
          count={counts.candidate}
          color="bg-bauhaus-yellow"
        >
          Pending Review
        </FilterTab>
        <FilterTab
          active={filter === 'confirmed'}
          onClick={() => setFilter('confirmed')}
          count={counts.confirmed}
          color="bg-bauhaus-blue"
        >
          Confirmed
        </FilterTab>
        <FilterTab
          active={filter === 'rejected'}
          onClick={() => setFilter('rejected')}
          count={counts.rejected}
          color="bg-bauhaus-red"
        >
          Rejected
        </FilterTab>
        <FilterTab
          active={filter === 'all'}
          onClick={() => setFilter('all')}
          count={assignments.length}
          color="bg-bauhaus-gray"
        >
          All
        </FilterTab>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-4 border-bauhaus-blue border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filteredAssignments.length === 0 ? (
        <EmptyState filter={filter} />
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* Matches list */}
          <div className="space-y-4">
            {filteredAssignments.map((match) => (
              <MatchCard
                key={match.id}
                match={match}
                selected={selectedMatch?.id === match.id}
                onClick={() => {
                  setSelectedMatch(match);
                  setReviewNotes(match.reviewNotes || '');
                }}
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
                  <span className="font-bold text-2xl">{selectedMatch.matchScore}%</span>
                </div>
                <div className="score-bar">
                  <div
                    className={cn('score-bar-fill', getScoreClass(selectedMatch.matchScore))}
                    style={{ width: `${selectedMatch.matchScore}%` }}
                  />
                </div>
              </div>

              {/* Side by side comparison */}
              <div className="grid grid-cols-2 gap-4 mb-6">
                {/* Document */}
                <div className="p-4 bg-bauhaus-lightgray/50 border border-bauhaus-lightgray">
                  <div className="flex items-center gap-2 mb-3">
                    <FileText size={16} className="text-bauhaus-gray" />
                    <span className="text-sm font-medium uppercase text-bauhaus-gray">Document</span>
                  </div>
                  {selectedMatch.document ? (
                    <>
                      {selectedMatch.document.attachmentPath ? (
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
                      {selectedMatch.document.date && (
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

              {/* Review notes */}
              {selectedMatch.status === 'candidate' && (
                <div className="mb-6">
                  <label className="block font-bold mb-2">Review Notes</label>
                  <textarea
                    value={reviewNotes}
                    onChange={(e) => setReviewNotes(e.target.value)}
                    className="w-full p-3 border-2 border-bauhaus-black focus:outline-none focus:ring-2 focus:ring-bauhaus-blue"
                    rows={3}
                    placeholder="Add notes about this match..."
                  />
                </div>
              )}

              {/* Actions */}
              {selectedMatch.status === 'candidate' && (
                <div className="flex gap-3">
                  <button
                    onClick={() => handleConfirm(selectedMatch.id)}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-bauhaus-blue text-white font-medium hover:bg-bauhaus-blue/90 transition-colors"
                  >
                    <Check size={18} />
                    Confirm Match
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

function FilterTab({
  active,
  onClick,
  count,
  color,
  children,
}: {
  active: boolean;
  onClick: () => void;
  count: number;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-4 py-2 font-medium transition-colors flex items-center gap-2',
        active
          ? 'bg-bauhaus-black text-white'
          : 'bg-white border-2 border-bauhaus-black hover:bg-bauhaus-lightgray'
      )}
    >
      <span className={cn('w-2 h-2 rounded-full', color)} />
      {children}
      <span className={cn(
        'text-xs px-1.5 py-0.5 rounded-full',
        active ? 'bg-white text-bauhaus-black' : 'bg-bauhaus-lightgray'
      )}>
        {count}
      </span>
    </button>
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
        </div>
        <div className="flex items-center gap-2">
          <span className={cn(
            'text-lg font-bold',
            match.matchScore >= 80 && 'text-bauhaus-blue',
            match.matchScore >= 60 && match.matchScore < 80 && 'text-bauhaus-yellow',
            match.matchScore < 60 && 'text-bauhaus-red',
          )}>
            {match.matchScore}%
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
              {match.document?.filename || match.document?.subject || 'Document'}
            </p>
          )}
          <p className="text-sm text-bauhaus-gray truncate">
            {match.document?.fromAddress}
          </p>
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

function EmptyState({ filter }: { filter: string }) {
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
      {filter === 'candidate' && (
        <button className="px-6 py-3 bg-bauhaus-blue text-white font-medium hover:bg-bauhaus-blue/90 transition-colors">
          Run Auto-Matching
        </button>
      )}
    </div>
  );
}

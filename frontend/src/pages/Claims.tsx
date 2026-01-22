import { useState, useEffect, useMemo, useRef } from 'react';
import { Calendar, DollarSign, User, FileText, RefreshCw, Archive, ExternalLink, Send } from 'lucide-react';
import { cn, formatCurrency, formatDate } from '@/lib/utils';
import { DetailRow, EmptyState, LoadingSpinner, UnseenDivider, FilterTabs } from '@/components';
import { api, type Claim, type ScrapedClaim, type Patient } from '@/lib/api';
import { useUnseenList } from '@/lib/useUnseenList';
import { useUnseenDivider } from '@/lib/useUnseenDivider';

type ClaimFilter = 'all' | 'scraped' | 'submitted';

/** Unified claim view combining scraped and submitted claims */
interface UnifiedClaim {
  id: string;
  source: 'scraped' | 'submitted';
  status: string;
  memberName?: string;
  patientId?: string;
  cignaClaimId?: string;
  submissionNumber?: string;
  treatmentDate?: string;
  submittedAt?: string;
  totalAmount: number;
  currency: string;
  archivedAt?: string;
  // Keep original for details
  scraped?: ScrapedClaim;
  submitted?: Claim;
}

function unifyScrapedClaim(sc: ScrapedClaim): UnifiedClaim {
  return {
    id: sc.id,
    source: 'scraped',
    status: sc.status,
    memberName: sc.memberName,
    cignaClaimId: sc.cignaClaimNumber,
    submissionNumber: sc.submissionNumber,
    treatmentDate: sc.treatmentDate,
    submittedAt: sc.submissionDate,
    totalAmount: sc.claimAmount,
    currency: sc.claimCurrency,
    archivedAt: sc.archivedAt,
    scraped: sc,
  };
}

function unifySubmittedClaim(c: Claim): UnifiedClaim {
  return {
    id: c.id,
    source: 'submitted',
    status: c.status,
    patientId: c.patientId,
    cignaClaimId: c.cignaClaimId,
    submissionNumber: c.submissionNumber,
    submittedAt: c.submittedAt,
    totalAmount: c.totalAmount,
    currency: c.currency,
    archivedAt: c.archivedAt,
    submitted: c,
  };
}

export default function Claims() {
  const [filter, setFilter] = useState<ClaimFilter>('all');

  const {
    items: claims,
    loading,
    unseenIds,
    refresh: refreshClaims,
    markAllSeen,
    removeItem,
  } = useUnseenList<UnifiedClaim>({
    fetcher: async () => {
      const [scraped, submitted] = await Promise.all([
        api.getScrapedClaims(),
        api.getClaims(),
      ]);
      const unified: UnifiedClaim[] = [
        ...scraped.filter((sc) => !sc.archivedAt).map(unifyScrapedClaim),
        ...submitted.filter((c) => !c.archivedAt).map(unifySubmittedClaim),
      ];
      // Sort by most recent submission date
      unified.sort((a, b) => {
        const dateA = a.submittedAt ? new Date(a.submittedAt).getTime() : 0;
        const dateB = b.submittedAt ? new Date(b.submittedAt).getTime() : 0;
        return dateB - dateA;
      });
      return unified;
    },
    cacheKey: 'claims',
  });

  const [selectedClaim, setSelectedClaim] = useState<UnifiedClaim | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [patients, setPatients] = useState<Patient[]>([]);
  const dividerRef = useRef<HTMLDivElement | null>(null);

  async function handleArchive() {
    if (!selectedClaim) return;
    setArchiving(true);
    try {
      if (selectedClaim.source === 'scraped') {
        await api.setScrapedClaimArchived(selectedClaim.id, true);
      } else {
        await api.setClaimArchived(selectedClaim.id, true);
      }
      removeItem(selectedClaim.id);
      setSelectedClaim(null);
    } catch (err) {
      console.error('Failed to archive claim:', err);
      alert(`Error: ${err}`);
    } finally {
      setArchiving(false);
    }
  }

  useEffect(() => {
    if (!selectedClaim) return;
    const updated = claims.find((claim) => claim.id === selectedClaim.id);
    if (updated && updated !== selectedClaim) {
      setSelectedClaim(updated);
    }
  }, [claims, selectedClaim]);

  useEffect(() => {
    const loadPatients = async () => {
      try {
        const data = await api.getPatients();
        setPatients(data);
      } catch (err) {
        console.error('Failed to load patients:', err);
      }
    };
    loadPatients();
  }, []);

  const statusColors: Record<string, string> = {
    draft: 'bg-bauhaus-gray text-white',
    ready: 'bg-bauhaus-black text-white',
    submitted: 'bg-bauhaus-blue text-white',
    processing: 'bg-bauhaus-yellow text-bauhaus-black',
    approved: 'bg-bauhaus-green text-white',
    rejected: 'bg-bauhaus-red text-white',
    paid: 'bg-emerald-600 text-white',
    processed: 'bg-bauhaus-green text-white',
    pending: 'bg-bauhaus-yellow text-bauhaus-black',
  };

  // Filter claims by source
  const filteredClaims = useMemo(
    () =>
      claims.filter((claim) => {
        if (filter === 'all') return true;
        return claim.source === filter;
      }),
    [claims, filter]
  );

  // Sort claims by submission date descending
  const sortedClaims = useMemo(
    () =>
      [...filteredClaims].sort((a, b) => {
        const aDate = a.submittedAt ? new Date(a.submittedAt).getTime() : 0;
        const bDate = b.submittedAt ? new Date(b.submittedAt).getTime() : 0;
        return bDate - aDate;
      }),
    [filteredClaims]
  );

  const claimSections = useMemo(() => {
    const unseenClaims = sortedClaims.filter((claim) => unseenIds.has(claim.id));
    const seenClaims = sortedClaims.filter((claim) => !unseenIds.has(claim.id));
    return {
      unseenClaims,
      seenClaims,
      hasVisibleUnseen: unseenClaims.length > 0,
    };
  }, [sortedClaims, unseenIds]);

  const filterCounts = useMemo(() => {
    const all = claims.length;
    const scraped = claims.filter((c) => c.source === 'scraped').length;
    const submitted = claims.filter((c) => c.source === 'submitted').length;
    return { all, scraped, submitted };
  }, [claims]);

  const renderClaimCard = (claim: UnifiedClaim) => {
    const patientName = claim.patientId
      ? patients.find((patient) => patient.id === claim.patientId)?.name ?? 'Unknown'
      : claim.memberName ?? 'Unknown';
    const dateLabel = claim.submittedAt ? formatDate(claim.submittedAt) : 'No date';
    return (
    <div
      key={claim.id}
      onClick={() => setSelectedClaim(claim)}
      className={cn(
        'bauhaus-card cursor-pointer',
        selectedClaim?.id === claim.id && 'ring-2 ring-bauhaus-blue'
      )}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'inline-block px-2 py-1 text-xs font-medium uppercase',
              statusColors[claim.status] ?? 'bg-bauhaus-gray text-white'
            )}
          >
            {claim.status}
          </span>
          <span
            className={cn(
              'inline-block px-2 py-1 text-xs font-medium uppercase',
              claim.source === 'scraped' ? 'bg-bauhaus-blue/10 text-bauhaus-blue' : 'bg-bauhaus-green/10 text-bauhaus-green'
            )}
          >
            {claim.source === 'scraped' ? 'Cigna' : 'Sent'}
          </span>
        </div>
        {claim.cignaClaimId && (
          <p className="text-sm text-bauhaus-gray">#{claim.cignaClaimId}</p>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm">
          <User size={16} className="text-bauhaus-gray" />
          <span>{patientName}</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Calendar size={16} className="text-bauhaus-gray" />
          <span>{dateLabel}</span>
        </div>
        <div className="flex items-center gap-2">
          <DollarSign size={16} className="text-bauhaus-gray" />
          <span className="font-bold text-lg">
            {formatCurrency(claim.totalAmount, claim.currency)}
          </span>
        </div>
      </div>
    </div>
    );
  };

  useUnseenDivider({
    dividerRef,
    onSeen: markAllSeen,
    active: claimSections.hasVisibleUnseen,
    deps: [sortedClaims],
  });

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold bauhaus-accent">Claims</h1>
        <button
          onClick={refreshClaims}
          className="flex items-center gap-2 px-4 py-2 bg-bauhaus-black text-white font-medium hover:bg-bauhaus-gray transition-colors"
        >
          <RefreshCw size={18} />
          Refresh
        </button>
      </div>

      <FilterTabs<ClaimFilter>
        active={filter}
        onChange={setFilter}
        items={[
          { key: 'all', label: 'All', count: filterCounts.all },
          { key: 'scraped', label: 'From Cigna', count: filterCounts.scraped },
          { key: 'submitted', label: 'Submitted', count: filterCounts.submitted },
        ]}
      />

      {loading ? (
        <LoadingSpinner />
      ) : sortedClaims.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No Claims"
          message={filter === 'all' ? "Scraped and submitted claims will appear here" : `No ${filter} claims found`}
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Claims list */}
          <div className="space-y-4">
            {claimSections.unseenClaims.map(renderClaimCard)}
            <UnseenDivider
              ref={dividerRef}
              visible={claimSections.hasVisibleUnseen}
              label="Unseen"
            />
            {claimSections.seenClaims.map(renderClaimCard)}
          </div>

          {/* Claim detail */}
          {selectedClaim && (
            <div className="bauhaus-card h-fit sticky top-8">
              <div className="flex items-start justify-between mb-4">
                <h2 className="text-xl font-bold">Claim Details</h2>
                <button
                  onClick={handleArchive}
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

              <div className="space-y-1 mb-6">
                <DetailRow
                  label="Source"
                  value={
                    <span className={cn(
                      'inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium uppercase',
                      selectedClaim.source === 'scraped' ? 'bg-bauhaus-blue/10 text-bauhaus-blue' : 'bg-bauhaus-green/10 text-bauhaus-green'
                    )}>
                      {selectedClaim.source === 'scraped' ? 'From Cigna' : (
                        <>
                          <Send size={10} />
                          Submitted
                        </>
                      )}
                    </span>
                  }
                />
                {selectedClaim.cignaClaimId && (
                  <DetailRow label="Cigna Claim ID" value={selectedClaim.cignaClaimId} />
                )}
                {selectedClaim.submissionNumber && (
                  <DetailRow label="Submission #" value={selectedClaim.submissionNumber} />
                )}
                <DetailRow
                  label="Patient"
                  value={
                    selectedClaim.patientId
                      ? patients.find((patient) => patient.id === selectedClaim.patientId)?.name ?? selectedClaim.patientId
                      : selectedClaim.memberName ?? 'Unknown'
                  }
                />
                {selectedClaim.submitted?.claimType && (
                  <DetailRow label="Claim Type" value={selectedClaim.submitted.claimType} />
                )}
                {selectedClaim.submitted?.country && (
                  <DetailRow label="Country" value={selectedClaim.submitted.country} />
                )}
                {selectedClaim.treatmentDate && (
                  <DetailRow label="Treatment Date" value={formatDate(selectedClaim.treatmentDate)} />
                )}
                {selectedClaim.submittedAt && (
                  <DetailRow label="Submitted At" value={formatDate(selectedClaim.submittedAt)} />
                )}
                <DetailRow
                  label="Claim Amount"
                  value={formatCurrency(selectedClaim.totalAmount, selectedClaim.currency)}
                />
                {selectedClaim.scraped?.amountPaid !== undefined && (
                  <DetailRow
                    label="Amount Paid"
                    value={formatCurrency(
                      selectedClaim.scraped.amountPaid,
                      selectedClaim.scraped.paymentCurrency ?? selectedClaim.currency
                    )}
                  />
                )}
                {selectedClaim.submitted?.approvedAmount !== undefined && (
                  <DetailRow
                    label="Approved Amount"
                    value={formatCurrency(selectedClaim.submitted.approvedAmount, selectedClaim.currency)}
                  />
                )}
                {selectedClaim.submitted?.submissionUrl && (
                  <DetailRow
                    label="Submission URL"
                    value={
                      <a
                        href={selectedClaim.submitted.submissionUrl}
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
                {selectedClaim.submitted?.claimUrl && (
                  <DetailRow
                    label="Claim URL"
                    value={
                      <a
                        href={selectedClaim.submitted.claimUrl}
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
                {/* Scraped claim line items */}
                {selectedClaim.scraped?.lineItems && selectedClaim.scraped.lineItems.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-bauhaus-lightgray">
                    <h3 className="text-sm font-bold mb-2">Line Items</h3>
                    <div className="space-y-2">
                      {selectedClaim.scraped.lineItems.map((item, idx) => (
                        <div key={idx} className="text-sm p-2 bg-bauhaus-lightgray/30">
                          <div className="flex justify-between">
                            <span>{item.treatmentDescription}</span>
                            <span className="font-medium">
                              {formatCurrency(item.claimAmount, item.claimCurrency)}
                            </span>
                          </div>
                          {item.treatmentDate && (
                            <div className="text-xs text-bauhaus-gray">
                              {formatDate(item.treatmentDate)}
                            </div>
                          )}
                          {item.amountPaid !== undefined && (
                            <div className="text-xs text-bauhaus-green">
                              Paid: {formatCurrency(item.amountPaid, item.paymentCurrency ?? item.claimCurrency)}
                            </div>
                          )}
                        </div>
                      ))}
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

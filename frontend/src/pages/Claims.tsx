import { useState, useEffect, useMemo, useRef } from 'react';
import { Calendar, DollarSign, User, FileText, RefreshCw } from 'lucide-react';
import { cn, formatCurrency, formatDate } from '@/lib/utils';
import { DetailRow, EmptyState, LoadingSpinner, UnseenDivider } from '@/components';
import { api, type ScrapedClaim } from '@/lib/api';
import { useUnseenList } from '@/lib/useUnseenList';
import { useUnseenDivider } from '@/lib/useUnseenDivider';

export default function Claims() {
  const {
    items: claims,
    loading,
    unseenIds,
    hasUnseen,
    refresh: refreshClaims,
    markAllSeen,
  } = useUnseenList<ScrapedClaim>({
    fetcher: api.getClaims,
    cacheKey: 'claims',
  });

  const [selectedClaim, setSelectedClaim] = useState<ScrapedClaim | null>(null);
  const dividerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!selectedClaim) return;
    const updated = claims.find((claim) => claim.id === selectedClaim.id);
    if (updated && updated !== selectedClaim) {
      setSelectedClaim(updated);
    }
  }, [claims, selectedClaim]);

  const statusColors = {
    processed: 'bg-bauhaus-blue text-white',
    pending: 'bg-bauhaus-yellow text-bauhaus-black',
    rejected: 'bg-bauhaus-red text-white',
  };

  // Sort claims by treatment date descending (most recent first)
  const sortedClaims = useMemo(() =>
    [...claims].sort((a, b) =>
      new Date(b.treatmentDate).getTime() - new Date(a.treatmentDate).getTime()
    ),
    [claims]
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

  const renderClaimCard = (claim: ScrapedClaim) => (
    <div
      key={claim.id}
      onClick={() => setSelectedClaim(claim)}
      className={cn(
        'bauhaus-card cursor-pointer',
        selectedClaim?.id === claim.id && 'ring-2 ring-bauhaus-blue'
      )}
    >
      <div className="flex items-start justify-between mb-4">
        <span
          className={cn(
            'inline-block px-2 py-1 text-xs font-medium uppercase',
            statusColors[claim.status]
          )}
        >
          {claim.status}
        </span>
        <p className="text-sm text-bauhaus-gray">#{claim.cignaClaimNumber}</p>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm">
          <User size={16} className="text-bauhaus-gray" />
          <span>{claim.memberName}</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Calendar size={16} className="text-bauhaus-gray" />
          <span>{formatDate(claim.treatmentDate)}</span>
        </div>
        <div className="flex items-center gap-2">
          <DollarSign size={16} className="text-bauhaus-gray" />
          <span className="font-bold text-lg">
            {formatCurrency(claim.claimAmount, claim.claimCurrency)}
          </span>
          {claim.amountPaid && (
            <span className="text-sm text-bauhaus-gray">
              (Paid: {formatCurrency(claim.amountPaid, claim.paymentCurrency || claim.claimCurrency)})
            </span>
          )}
        </div>
      </div>
    </div>
  );

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

      {loading ? (
        <LoadingSpinner />
      ) : sortedClaims.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No Claims Yet"
          message="Scrape claims from Cigna Envoy to get started"
          action={{ label: 'Scrape Claims', onClick: () => {} }}
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
              <h2 className="text-xl font-bold mb-4">Claim #{selectedClaim.cignaClaimNumber}</h2>

              <div className="space-y-1 mb-6">
                <DetailRow label="Submission #" value={selectedClaim.submissionNumber} />
                <DetailRow label="Member" value={selectedClaim.memberName} />
                <DetailRow label="Treatment Date" value={formatDate(selectedClaim.treatmentDate)} />
                <DetailRow label="Submission Date" value={formatDate(selectedClaim.submissionDate)} />
                <DetailRow
                  label="Claim Amount"
                  value={formatCurrency(selectedClaim.claimAmount, selectedClaim.claimCurrency)}
                />
                {selectedClaim.amountPaid && (
                  <DetailRow
                    label="Amount Paid"
                    value={formatCurrency(
                      selectedClaim.amountPaid,
                      selectedClaim.paymentCurrency || selectedClaim.claimCurrency
                    )}
                  />
                )}
              </div>

              {selectedClaim.lineItems.length > 0 && (
                <>
                  <h3 className="font-bold mb-3 flex items-center gap-2">
                    <FileText size={18} />
                    Line Items
                  </h3>
                  <div className="space-y-3">
                    {selectedClaim.lineItems.map((item, idx) => (
                      <div key={idx} className="p-3 bg-bauhaus-lightgray/50 border border-bauhaus-lightgray">
                        <p className="font-medium">{item.treatmentDescription}</p>
                        <div className="flex items-center justify-between mt-2 text-sm">
                          <span className="text-bauhaus-gray">{formatDate(item.treatmentDate)}</span>
                          <span className="font-medium">
                            {formatCurrency(item.claimAmount, item.claimCurrency)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

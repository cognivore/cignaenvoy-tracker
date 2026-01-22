import { useState } from 'react';
import { FileText, RefreshCw, Inbox, DollarSign, Calendar } from 'lucide-react';
import { cn, formatCurrency, formatDate } from '@/lib/utils';
import { EmptyState, LoadingSpinner, DetailRow } from '@/components';
import { api, type Claim } from '@/lib/api';
import { useUnseenList } from '@/lib/useUnseenList';

const statusColors: Record<Claim['status'], string> = {
  draft: 'bg-bauhaus-gray',
  ready: 'bg-bauhaus-black',
  submitted: 'bg-bauhaus-blue',
  processing: 'bg-bauhaus-yellow text-bauhaus-black',
  approved: 'bg-bauhaus-green',
  rejected: 'bg-bauhaus-red',
  paid: 'bg-emerald-600',
};

export default function ArchivedClaims() {
  const {
    items: claims,
    loading,
    refresh,
    removeItem,
  } = useUnseenList<Claim>({
    fetcher: api.getArchivedClaims,
    cacheKey: 'archived-claims',
    sortFn: (a, b) => new Date(b.archivedAt!).getTime() - new Date(a.archivedAt!).getTime(),
  });

  const [selectedClaim, setSelectedClaim] = useState<Claim | null>(null);
  const [unarchiving, setUnarchiving] = useState(false);

  async function handleUnarchive(claim: Claim) {
    setUnarchiving(true);
    try {
      await api.setClaimArchived(claim.id, false);
      removeItem(claim.id);
      if (selectedClaim?.id === claim.id) {
        setSelectedClaim(null);
      }
    } catch (err) {
      console.error('Failed to unarchive claim:', err);
      alert(`Error: ${err}`);
    } finally {
      setUnarchiving(false);
    }
  }

  if (loading && claims.length === 0) {
    return (
      <div className="p-8 flex justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold bauhaus-accent">Archived Claims</h1>
        <button
          onClick={refresh}
          className="bauhaus-button-secondary flex items-center gap-2"
        >
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>

      {claims.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="No archived claims"
          message="Claims you archive will appear here."
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Claims List */}
          <div className="space-y-2 max-h-[calc(100vh-200px)] overflow-y-auto">
            {claims.map((claim) => {
              const isSelected = selectedClaim?.id === claim.id;

              return (
                <div
                  key={claim.id}
                  onClick={() => setSelectedClaim(claim)}
                  className={cn(
                    'bauhaus-card cursor-pointer transition-all flex items-start gap-4',
                    isSelected && 'ring-2 ring-bauhaus-blue'
                  )}
                >
                  <div className="p-2 bg-bauhaus-lightgray rounded">
                    <FileText size={20} className="text-bauhaus-gray" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={cn('px-2 py-0.5 text-xs font-medium text-white rounded', statusColors[claim.status])}>
                        {claim.status.toUpperCase()}
                      </span>
                    </div>
                    <h3 className="font-medium">
                      Claim {claim.cignaClaimId ?? claim.submissionNumber ?? claim.id}
                    </h3>
                    <p className="text-sm text-bauhaus-gray">{claim.claimType}</p>
                    <p className="text-sm font-medium text-bauhaus-blue">
                      {formatCurrency(claim.totalAmount, claim.currency)}
                    </p>
                    <p className="text-xs text-bauhaus-gray mt-1">
                      Archived: {formatDate(claim.archivedAt!)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Detail Panel */}
          {selectedClaim && (
            <div className="bauhaus-card h-fit sticky top-8">
              <div className="flex items-center justify-between mb-4">
                <span className={cn(
                  'px-2 py-1 text-xs font-medium text-white rounded',
                  statusColors[selectedClaim.status]
                )}>
                  {selectedClaim.status.toUpperCase()}
                </span>
                <button
                  onClick={() => handleUnarchive(selectedClaim)}
                  disabled={unarchiving}
                  className="bauhaus-button-secondary flex items-center gap-2 text-sm"
                >
                  <Inbox size={14} />
                  {unarchiving ? 'Restoring...' : 'Restore'}
                </button>
              </div>

              <h2 className="text-xl font-bold mb-4">Claim Details</h2>

              <div className="space-y-3">
                <DetailRow
                  icon={FileText}
                  label="Submission #"
                  value={selectedClaim.submissionNumber ?? '—'}
                />
                <DetailRow
                  label="Patient"
                  value={selectedClaim.patientId}
                />
                <DetailRow
                  icon={Calendar}
                  label="Submitted At"
                  value={selectedClaim.submittedAt ? formatDate(selectedClaim.submittedAt) : '—'}
                />
                <DetailRow
                  icon={DollarSign}
                  label="Claim Amount"
                  value={formatCurrency(selectedClaim.totalAmount, selectedClaim.currency)}
                />
                {selectedClaim.archivedAt && (
                  <div className="pt-3 border-t border-bauhaus-lightgray">
                    <p className="text-sm text-bauhaus-gray">
                      Archived: {formatDate(selectedClaim.archivedAt)}
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

import { useState, useEffect, useMemo, useRef } from 'react';
import { Calendar, DollarSign, User, FileText, RefreshCw, Archive, ExternalLink } from 'lucide-react';
import { cn, formatCurrency, formatDate } from '@/lib/utils';
import { DetailRow, EmptyState, LoadingSpinner, UnseenDivider } from '@/components';
import { api, type Claim, type Patient } from '@/lib/api';
import { useUnseenList } from '@/lib/useUnseenList';
import { useUnseenDivider } from '@/lib/useUnseenDivider';

export default function Claims() {
  const {
    items: claims,
    loading,
    unseenIds,
    refresh: refreshClaims,
    markAllSeen,
    removeItem,
  } = useUnseenList<Claim>({
    fetcher: async () => {
      const all = await api.getClaims();
      return all.filter((claim) => !claim.archivedAt);
    },
    cacheKey: 'claims',
  });

  const [selectedClaim, setSelectedClaim] = useState<Claim | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [patients, setPatients] = useState<Patient[]>([]);
  const dividerRef = useRef<HTMLDivElement | null>(null);

  async function handleArchive() {
    if (!selectedClaim) return;
    setArchiving(true);
    try {
      await api.setClaimArchived(selectedClaim.id, true);
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

  const statusColors: Record<Claim['status'], string> = {
    draft: 'bg-bauhaus-gray text-white',
    ready: 'bg-bauhaus-black text-white',
    submitted: 'bg-bauhaus-blue text-white',
    processing: 'bg-bauhaus-yellow text-bauhaus-black',
    approved: 'bg-bauhaus-green text-white',
    rejected: 'bg-bauhaus-red text-white',
    paid: 'bg-emerald-600 text-white',
  };

  // Sort claims by submission date (fallback to created date) descending
  const sortedClaims = useMemo(
    () =>
      [...claims].sort((a, b) => {
        const aDate = new Date(a.submittedAt ?? a.createdAt).getTime();
        const bDate = new Date(b.submittedAt ?? b.createdAt).getTime();
        return bDate - aDate;
      }),
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

  const renderClaimCard = (claim: Claim) => {
    const patientName =
      patients.find((patient) => patient.id === claim.patientId)?.name ?? 'Unknown';
    const dateLabel = claim.submittedAt ? formatDate(claim.submittedAt) : formatDate(claim.createdAt);
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
        <span
          className={cn(
            'inline-block px-2 py-1 text-xs font-medium uppercase',
            statusColors[claim.status]
          )}
        >
          {claim.status}
        </span>
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

      {loading ? (
        <LoadingSpinner />
      ) : sortedClaims.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No Claims Yet"
          message="Submitted claims will appear here after automation"
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
                {selectedClaim.cignaClaimId && (
                  <DetailRow label="Cigna Claim ID" value={selectedClaim.cignaClaimId} />
                )}
                {selectedClaim.submissionNumber && (
                  <DetailRow label="Submission #" value={selectedClaim.submissionNumber} />
                )}
                <DetailRow
                  label="Patient"
                  value={
                    patients.find((patient) => patient.id === selectedClaim.patientId)?.name ??
                    selectedClaim.patientId
                  }
                />
                <DetailRow label="Claim Type" value={selectedClaim.claimType} />
                <DetailRow label="Country" value={selectedClaim.country} />
                <DetailRow
                  label="Submitted At"
                  value={
                    selectedClaim.submittedAt
                      ? formatDate(selectedClaim.submittedAt)
                      : formatDate(selectedClaim.createdAt)
                  }
                />
                <DetailRow
                  label="Claim Amount"
                  value={formatCurrency(selectedClaim.totalAmount, selectedClaim.currency)}
                />
                {selectedClaim.approvedAmount !== undefined && (
                  <DetailRow
                    label="Approved Amount"
                    value={formatCurrency(selectedClaim.approvedAmount, selectedClaim.currency)}
                  />
                )}
                {selectedClaim.submissionUrl && (
                  <DetailRow
                    label="Submission URL"
                    value={
                      <a
                        href={selectedClaim.submissionUrl}
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
                {selectedClaim.claimUrl && (
                  <DetailRow
                    label="Claim URL"
                    value={
                      <a
                        href={selectedClaim.claimUrl}
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

            </div>
          )}
        </div>
      )}
    </div>
  );
}

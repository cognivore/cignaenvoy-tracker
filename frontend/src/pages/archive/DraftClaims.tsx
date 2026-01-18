import { useState } from 'react';
import { FilePlus, RefreshCw, Inbox, DollarSign, Calendar } from 'lucide-react';
import { cn, formatCurrency, formatDate } from '@/lib/utils';
import { EmptyState, LoadingSpinner, DetailRow } from '@/components';
import { api, type DraftClaim } from '@/lib/api';
import { useUnseenList } from '@/lib/useUnseenList';

const statusColors: Record<string, string> = {
  pending: 'bg-bauhaus-yellow text-bauhaus-black',
  accepted: 'bg-green-600',
  rejected: 'bg-bauhaus-red',
};

export default function ArchivedDraftClaims() {
  const {
    items: drafts,
    loading,
    refresh,
    removeItem,
  } = useUnseenList<DraftClaim>({
    fetcher: api.getArchivedDraftClaims,
    cacheKey: 'archived-draft-claims',
    sortFn: (a, b) => new Date(b.archivedAt!).getTime() - new Date(a.archivedAt!).getTime(),
  });

  const [selectedDraft, setSelectedDraft] = useState<DraftClaim | null>(null);
  const [unarchiving, setUnarchiving] = useState(false);

  async function handleUnarchive(draft: DraftClaim) {
    setUnarchiving(true);
    try {
      await api.setDraftClaimArchived(draft.id, false);
      removeItem(draft.id);
      if (selectedDraft?.id === draft.id) {
        setSelectedDraft(null);
      }
    } catch (err) {
      console.error('Failed to unarchive draft claim:', err);
      alert(`Error: ${err}`);
    } finally {
      setUnarchiving(false);
    }
  }

  if (loading && drafts.length === 0) {
    return (
      <div className="p-8 flex justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold bauhaus-accent">Archived Draft Claims</h1>
        <button
          onClick={refresh}
          className="bauhaus-button-secondary flex items-center gap-2"
        >
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>

      {drafts.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="No archived draft claims"
          message="Draft claims you archive will appear here."
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Drafts List */}
          <div className="space-y-2 max-h-[calc(100vh-200px)] overflow-y-auto">
            {drafts.map((draft) => {
              const isSelected = selectedDraft?.id === draft.id;

              return (
                <div
                  key={draft.id}
                  onClick={() => setSelectedDraft(draft)}
                  className={cn(
                    'bauhaus-card cursor-pointer transition-all flex items-start gap-4',
                    isSelected && 'ring-2 ring-bauhaus-blue'
                  )}
                >
                  <div className="p-2 bg-bauhaus-lightgray rounded">
                    <FilePlus size={20} className="text-bauhaus-gray" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={cn('px-2 py-0.5 text-xs font-medium text-white rounded', statusColors[draft.status])}>
                        {draft.status.toUpperCase()}
                      </span>
                    </div>
                    <h3 className="font-medium">
                      {formatCurrency(draft.payment.amount, draft.payment.currency)}
                    </h3>
                    <p className="text-sm text-bauhaus-gray">
                      {draft.documentIds.length} document{draft.documentIds.length !== 1 ? 's' : ''}
                    </p>
                    <p className="text-xs text-bauhaus-gray mt-1">
                      Archived: {formatDate(draft.archivedAt!)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Detail Panel */}
          {selectedDraft && (
            <div className="bauhaus-card h-fit sticky top-8">
              <div className="flex items-center justify-between mb-4">
                <span className={cn(
                  'px-2 py-1 text-xs font-medium text-white rounded',
                  statusColors[selectedDraft.status]
                )}>
                  {selectedDraft.status.toUpperCase()}
                </span>
                <button
                  onClick={() => handleUnarchive(selectedDraft)}
                  disabled={unarchiving}
                  className="bauhaus-button-secondary flex items-center gap-2 text-sm"
                >
                  <Inbox size={14} />
                  {unarchiving ? 'Restoring...' : 'Restore'}
                </button>
              </div>

              <h2 className="text-xl font-bold mb-4">
                {formatCurrency(selectedDraft.payment.amount, selectedDraft.payment.currency)}
              </h2>

              <div className="space-y-3">
                <DetailRow
                  icon={DollarSign}
                  label="Amount"
                  value={formatCurrency(selectedDraft.payment.amount, selectedDraft.payment.currency)}
                />
                {selectedDraft.payment.source && (
                  <DetailRow
                    label="Source"
                    value={selectedDraft.payment.source === 'override' ? 'Manual Override' : 'Auto-detected'}
                  />
                )}
                {selectedDraft.treatmentDate && (
                  <DetailRow
                    icon={Calendar}
                    label="Treatment Date"
                    value={formatDate(selectedDraft.treatmentDate)}
                  />
                )}
                <DetailRow
                  label="Documents"
                  value={`${selectedDraft.documentIds.length} attached`}
                />
                <DetailRow
                  icon={Calendar}
                  label="Generated"
                  value={formatDate(selectedDraft.generatedAt)}
                />
                {selectedDraft.doctorNotes && (
                  <div className="pt-3 border-t border-bauhaus-lightgray">
                    <p className="text-sm font-medium mb-1">Doctor Notes</p>
                    <p className="text-sm text-bauhaus-gray">{selectedDraft.doctorNotes}</p>
                  </div>
                )}
                {selectedDraft.archivedAt && (
                  <div className="pt-3 border-t border-bauhaus-lightgray">
                    <p className="text-sm text-bauhaus-gray">
                      Archived: {formatDate(selectedDraft.archivedAt)}
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

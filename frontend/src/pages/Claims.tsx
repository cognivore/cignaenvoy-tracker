import { useState, useEffect } from 'react';
import { Calendar, DollarSign, User, FileText, RefreshCw } from 'lucide-react';
import { cn, formatCurrency, formatDate } from '@/lib/utils';
import { api, type ScrapedClaim } from '@/lib/api';

export default function Claims() {
  const [claims, setClaims] = useState<ScrapedClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedClaim, setSelectedClaim] = useState<ScrapedClaim | null>(null);

  useEffect(() => {
    loadClaims();
  }, []);

  async function loadClaims() {
    setLoading(true);
    try {
      const data = await api.getClaims();
      setClaims(data);
    } catch (err) {
      console.error('Failed to load claims:', err);
    } finally {
      setLoading(false);
    }
  }

  const statusColors = {
    processed: 'bg-bauhaus-blue text-white',
    pending: 'bg-bauhaus-yellow text-bauhaus-black',
    rejected: 'bg-bauhaus-red text-white',
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold bauhaus-accent">Claims</h1>
        <button
          onClick={loadClaims}
          className="flex items-center gap-2 px-4 py-2 bg-bauhaus-black text-white font-medium hover:bg-bauhaus-gray transition-colors"
        >
          <RefreshCw size={18} />
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-4 border-bauhaus-blue border-t-transparent rounded-full animate-spin" />
        </div>
      ) : claims.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Claims list */}
          <div className="space-y-4">
            {claims.map((claim) => (
              <div
                key={claim.id}
                onClick={() => setSelectedClaim(claim)}
                className={cn(
                  'bauhaus-card cursor-pointer',
                  selectedClaim?.id === claim.id && 'ring-2 ring-bauhaus-blue'
                )}
              >
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <span className={cn(
                      'inline-block px-2 py-1 text-xs font-medium uppercase',
                      statusColors[claim.status]
                    )}>
                      {claim.status}
                    </span>
                  </div>
                  <p className="text-sm text-bauhaus-gray">
                    #{claim.cignaClaimNumber}
                  </p>
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
            ))}
          </div>

          {/* Claim detail */}
          {selectedClaim && (
            <div className="bauhaus-card h-fit sticky top-8">
              <h2 className="text-xl font-bold mb-4">
                Claim #{selectedClaim.cignaClaimNumber}
              </h2>

              <div className="space-y-4 mb-6">
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
                    value={formatCurrency(selectedClaim.amountPaid, selectedClaim.paymentCurrency || selectedClaim.claimCurrency)}
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

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center py-2 border-b border-bauhaus-lightgray">
      <span className="text-sm text-bauhaus-gray">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="bauhaus-card text-center py-16">
      <div className="w-16 h-16 bg-bauhaus-lightgray rounded-full mx-auto mb-4 flex items-center justify-center">
        <FileText size={32} className="text-bauhaus-gray" />
      </div>
      <h2 className="text-xl font-bold mb-2">No Claims Yet</h2>
      <p className="text-bauhaus-gray mb-6">
        Scrape claims from Cigna Envoy to get started
      </p>
      <button className="px-6 py-3 bg-bauhaus-blue text-white font-medium hover:bg-bauhaus-blue/90 transition-colors">
        Scrape Claims
      </button>
    </div>
  );
}

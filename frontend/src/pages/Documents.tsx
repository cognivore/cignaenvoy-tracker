import { useState, useEffect } from 'react';
import { FileText, Mail, Calendar, Tag, DollarSign, RefreshCw, Eye, Link2, ExternalLink } from 'lucide-react';
import { cn, formatCurrency, formatDate } from '@/lib/utils';
import { api, getDocumentFileUrl, type MedicalDocument } from '@/lib/api';

const classificationLabels: Record<string, { label: string; color: string }> = {
  medical_bill: { label: 'Bill', color: 'bg-bauhaus-red' },
  correspondence: { label: 'Letter', color: 'bg-bauhaus-blue' },
  receipt: { label: 'Receipt', color: 'bg-green-600' },
  prescription: { label: 'Rx', color: 'bg-purple-600' },
  lab_result: { label: 'Lab', color: 'bg-orange-600' },
  insurance_statement: { label: 'Insurance', color: 'bg-bauhaus-yellow text-bauhaus-black' },
  unknown: { label: 'Unknown', color: 'bg-bauhaus-gray' },
};

export default function Documents() {
  const [documents, setDocuments] = useState<MedicalDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDoc, setSelectedDoc] = useState<MedicalDocument | null>(null);
  const [filter, setFilter] = useState<string>('all');
  const [showOcr, setShowOcr] = useState(false);

  useEffect(() => {
    loadDocuments();
  }, []);

  async function loadDocuments() {
    setLoading(true);
    try {
      const data = await api.getDocuments();
      setDocuments(data);
    } catch (err) {
      console.error('Failed to load documents:', err);
    } finally {
      setLoading(false);
    }
  }

  const filteredDocs = filter === 'all'
    ? documents
    : documents.filter(d => d.classification === filter);

  const classificationCounts = documents.reduce((acc, doc) => {
    acc[doc.classification] = (acc[doc.classification] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold bauhaus-accent">Documents</h1>
        <button
          onClick={loadDocuments}
          className="flex items-center gap-2 px-4 py-2 bg-bauhaus-black text-white font-medium hover:bg-bauhaus-gray transition-colors"
        >
          <RefreshCw size={18} />
          Refresh
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-6 flex-wrap">
        <FilterTab
          active={filter === 'all'}
          onClick={() => setFilter('all')}
          count={documents.length}
        >
          All
        </FilterTab>
        {Object.entries(classificationLabels).map(([key, { label }]) => (
          <FilterTab
            key={key}
            active={filter === key}
            onClick={() => setFilter(key)}
            count={classificationCounts[key] || 0}
          >
            {label}
          </FilterTab>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-4 border-bauhaus-blue border-t-transparent rounded-full animate-spin" />
        </div>
      ) : documents.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Documents list */}
          <div className="space-y-4">
            {filteredDocs.map((doc) => (
              <DocumentCard
                key={doc.id}
                document={doc}
                selected={selectedDoc?.id === doc.id}
                onClick={() => setSelectedDoc(doc)}
              />
            ))}
          </div>

          {/* Document detail */}
          {selectedDoc && (
            <div className="bauhaus-card h-fit sticky top-8">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <span className={cn(
                    'inline-block px-2 py-1 text-xs font-medium uppercase text-white',
                    classificationLabels[selectedDoc.classification]?.color
                  )}>
                    {classificationLabels[selectedDoc.classification]?.label}
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowOcr(!showOcr)}
                    className={cn(
                      'p-2 border transition-colors',
                      showOcr ? 'bg-bauhaus-black text-white' : 'hover:bg-bauhaus-lightgray'
                    )}
                    title="View OCR text"
                  >
                    <Eye size={18} />
                  </button>
                  <button
                    className="p-2 border hover:bg-bauhaus-lightgray transition-colors"
                    title="Create manual match"
                  >
                    <Link2 size={18} />
                  </button>
                </div>
              </div>

              <h2 className="text-lg font-bold mb-4">
                {selectedDoc.attachmentPath ? (
                  <a
                    href={getDocumentFileUrl(selectedDoc.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-bauhaus-blue hover:underline inline-flex items-center gap-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {selectedDoc.filename || selectedDoc.subject || 'Untitled Document'}
                    <ExternalLink size={16} />
                  </a>
                ) : (
                  selectedDoc.filename || selectedDoc.subject || 'Untitled Document'
                )}
              </h2>

              <div className="space-y-3 mb-6">
                {selectedDoc.fromAddress && (
                  <DetailRow icon={Mail} label="From" value={selectedDoc.fromAddress} />
                )}
                {selectedDoc.date && (
                  <DetailRow icon={Calendar} label="Date" value={formatDate(selectedDoc.date)} />
                )}
                {selectedDoc.sourceType === 'attachment' && selectedDoc.filename && (
                  <DetailRow icon={FileText} label="File" value={selectedDoc.filename} />
                )}
              </div>

              {/* Detected amounts */}
              {selectedDoc.detectedAmounts.length > 0 && (
                <div className="mb-6">
                  <h3 className="font-bold mb-3 flex items-center gap-2">
                    <DollarSign size={18} />
                    Detected Amounts
                  </h3>
                  <div className="space-y-2">
                    {selectedDoc.detectedAmounts.map((amount, idx) => (
                      <div
                        key={idx}
                        className="p-3 bg-bauhaus-lightgray/50 border border-bauhaus-lightgray flex items-center justify-between"
                      >
                        <div>
                          <span className="font-bold text-lg">
                            {formatCurrency(amount.value, amount.currency)}
                          </span>
                          <span className="text-sm text-bauhaus-gray ml-2">
                            ({amount.confidence}% confidence)
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Medical keywords */}
              {selectedDoc.medicalKeywords.length > 0 && (
                <div className="mb-6">
                  <h3 className="font-bold mb-3 flex items-center gap-2">
                    <Tag size={18} />
                    Keywords
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {selectedDoc.medicalKeywords.map((keyword, idx) => (
                      <span
                        key={idx}
                        className="px-2 py-1 bg-bauhaus-lightgray text-sm"
                      >
                        {keyword}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* OCR text */}
              {showOcr && selectedDoc.ocrText && (
                <div>
                  <h3 className="font-bold mb-3">OCR Text</h3>
                  <div className="p-3 bg-bauhaus-lightgray/50 border border-bauhaus-lightgray max-h-64 overflow-auto">
                    <pre className="text-sm whitespace-pre-wrap font-mono">
                      {selectedDoc.ocrText}
                    </pre>
                  </div>
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
  children
}: {
  active: boolean;
  onClick: () => void;
  count: number;
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

function DocumentCard({
  document,
  selected,
  onClick
}: {
  document: MedicalDocument;
  selected: boolean;
  onClick: () => void;
}) {
  const typeIcon = document.sourceType === 'email' ? Mail : FileText;
  const Icon = typeIcon;
  const hasFile = !!document.attachmentPath;

  return (
    <div
      onClick={onClick}
      className={cn(
        'bauhaus-card cursor-pointer',
        selected && 'ring-2 ring-bauhaus-blue'
      )}
    >
      <div className="flex items-start gap-4">
        <div className={cn(
          'w-10 h-10 flex items-center justify-center',
          classificationLabels[document.classification]?.color,
          'text-white'
        )}>
          <Icon size={20} />
        </div>
        <div className="flex-1 min-w-0">
          {hasFile ? (
            <a
              href={getDocumentFileUrl(document.id)}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium truncate block text-bauhaus-blue hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {document.filename || document.subject || 'Untitled'}
            </a>
          ) : (
            <p className="font-medium truncate">
              {document.filename || document.subject || 'Untitled'}
            </p>
          )}
          {document.fromAddress && (
            <p className="text-sm text-bauhaus-gray truncate">
              {document.fromAddress}
            </p>
          )}
          {document.detectedAmounts.length > 0 && (
            <p className="text-sm font-medium text-bauhaus-blue mt-1">
              {document.detectedAmounts.map(a =>
                formatCurrency(a.value, a.currency)
              ).join(', ')}
            </p>
          )}
        </div>
        <div className="text-right">
          {document.date && (
            <p className="text-xs text-bauhaus-gray">
              {formatDate(document.date)}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function DetailRow({
  icon: Icon,
  label,
  value
}: {
  icon: React.ElementType;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <Icon size={16} className="text-bauhaus-gray flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="text-sm text-bauhaus-gray">{label}: </span>
        <span className="font-medium truncate">{value}</span>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="bauhaus-card text-center py-16">
      <div className="w-16 h-16 bg-bauhaus-lightgray rounded-full mx-auto mb-4 flex items-center justify-center">
        <FileText size={32} className="text-bauhaus-gray" />
      </div>
      <h2 className="text-xl font-bold mb-2">No Documents Yet</h2>
      <p className="text-bauhaus-gray mb-6">
        Process email attachments to find medical documents
      </p>
      <button className="px-6 py-3 bg-bauhaus-blue text-white font-medium hover:bg-bauhaus-blue/90 transition-colors">
        Process Attachments
      </button>
    </div>
  );
}

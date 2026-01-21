import { useState } from 'react';
import { FileText, Mail, Calendar, Tag, RefreshCw, Inbox, ExternalLink } from 'lucide-react';
import { cn, formatDate } from '@/lib/utils';
import { EmptyState, LoadingSpinner } from '@/components';
import { api, getDocumentFileUrl, type MedicalDocument } from '@/lib/api';
import { useUnseenList } from '@/lib/useUnseenList';

const classificationLabels: Record<string, { label: string; color: string }> = {
  medical_bill: { label: 'Bill', color: 'bg-bauhaus-red' },
  correspondence: { label: 'Letter', color: 'bg-bauhaus-blue' },
  receipt: { label: 'Receipt', color: 'bg-green-600' },
  prescription: { label: 'Rx', color: 'bg-purple-600' },
  lab_result: { label: 'Lab', color: 'bg-orange-600' },
  insurance_statement: { label: 'Insurance', color: 'bg-bauhaus-yellow text-bauhaus-black' },
  appointment: { label: 'Appointment', color: 'bg-teal-600' },
  unknown: { label: 'Unknown', color: 'bg-bauhaus-gray' },
};

export default function ArchivedDocuments() {
  const {
    items: documents,
    loading,
    refresh,
    removeItem,
  } = useUnseenList<MedicalDocument>({
    fetcher: async () => {
      const all = await api.getDocuments();
      return all.filter((doc) => !!doc.archivedAt);
    },
    cacheKey: 'archived-documents',
    sortFn: (a, b) => new Date(b.archivedAt!).getTime() - new Date(a.archivedAt!).getTime(),
  });

  const [selectedDoc, setSelectedDoc] = useState<MedicalDocument | null>(null);
  const [unarchiving, setUnarchiving] = useState(false);

  async function handleUnarchive(doc: MedicalDocument) {
    setUnarchiving(true);
    try {
      await api.setDocumentArchived(doc.id, { archived: false });
      removeItem(doc.id);
      if (selectedDoc?.id === doc.id) {
        setSelectedDoc(null);
      }
    } catch (err) {
      console.error('Failed to unarchive document:', err);
      alert(`Error: ${err}`);
    } finally {
      setUnarchiving(false);
    }
  }

  const getIcon = (doc: MedicalDocument) => {
    if (doc.sourceType === 'calendar') return Calendar;
    if (doc.sourceType === 'attachment') return FileText;
    return Mail;
  };

  const getTitle = (doc: MedicalDocument) => {
    if (doc.sourceType === 'calendar') return doc.calendarSummary || 'Calendar Event';
    if (doc.filename) return doc.filename;
    return doc.subject || 'Email';
  };

  if (loading && documents.length === 0) {
    return (
      <div className="p-8 flex justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold bauhaus-accent">Archived Documents</h1>
        <button
          onClick={refresh}
          className="bauhaus-button-secondary flex items-center gap-2"
        >
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>

      {documents.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="No archived documents"
          message="Documents you archive will appear here."
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Document List */}
          <div className="space-y-2 max-h-[calc(100vh-200px)] overflow-y-auto">
            {documents.map((doc) => {
              const Icon = getIcon(doc);
              const classInfo = classificationLabels[doc.classification] || classificationLabels.unknown;
              const isSelected = selectedDoc?.id === doc.id;

              return (
                <div
                  key={doc.id}
                  onClick={() => setSelectedDoc(doc)}
                  className={cn(
                    'bauhaus-card cursor-pointer transition-all flex items-start gap-4',
                    isSelected && 'ring-2 ring-bauhaus-blue'
                  )}
                >
                  <div className="p-2 bg-bauhaus-lightgray rounded">
                    <Icon size={20} className="text-bauhaus-gray" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={cn('px-2 py-0.5 text-xs font-medium text-white rounded', classInfo.color)}>
                        {classInfo.label}
                      </span>
                    </div>
                    <h3 className="font-medium truncate">{getTitle(doc)}</h3>
                    <p className="text-sm text-bauhaus-gray truncate">
                      {doc.fromAddress || doc.calendarOrganizer?.email || 'Unknown sender'}
                    </p>
                    <p className="text-xs text-bauhaus-gray mt-1">
                      Archived: {formatDate(doc.archivedAt!)}
                    </p>
                    {doc.archivedReason && (
                      <p className="text-xs text-bauhaus-gray italic">
                        {doc.archivedReason}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Detail Panel */}
          {selectedDoc && (
            <div className="bauhaus-card h-fit sticky top-8">
              <div className="flex items-center justify-between mb-4">
                <span className={cn(
                  'px-2 py-1 text-xs font-medium text-white rounded',
                  classificationLabels[selectedDoc.classification]?.color || 'bg-bauhaus-gray'
                )}>
                  {classificationLabels[selectedDoc.classification]?.label || 'Unknown'}
                </span>
                <button
                  onClick={() => handleUnarchive(selectedDoc)}
                  disabled={unarchiving}
                  className="bauhaus-button-secondary flex items-center gap-2 text-sm"
                >
                  <Inbox size={14} />
                  {unarchiving ? 'Restoring...' : 'Restore'}
                </button>
              </div>

              <h2 className="text-xl font-bold mb-4">
                {selectedDoc.attachmentPath ? (
                  <a
                    href={getDocumentFileUrl(selectedDoc.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-bauhaus-blue flex items-center gap-2"
                  >
                    {getTitle(selectedDoc)}
                    <ExternalLink size={16} />
                  </a>
                ) : (
                  getTitle(selectedDoc)
                )}
              </h2>

              <div className="space-y-3 text-sm">
                {selectedDoc.fromAddress && (
                  <div className="flex items-center gap-2">
                    <Mail size={14} className="text-bauhaus-gray" />
                    <span>From: {selectedDoc.fromAddress}</span>
                  </div>
                )}
                {selectedDoc.date && (
                  <div className="flex items-center gap-2">
                    <Calendar size={14} className="text-bauhaus-gray" />
                    <span>Date: {formatDate(selectedDoc.date)}</span>
                  </div>
                )}
                {selectedDoc.medicalKeywords.length > 0 && (
                  <div className="flex items-start gap-2">
                    <Tag size={14} className="text-bauhaus-gray mt-0.5" />
                    <div className="flex flex-wrap gap-1">
                      {selectedDoc.medicalKeywords.map((kw) => (
                        <span key={kw} className="px-2 py-0.5 bg-bauhaus-lightgray text-xs rounded">
                          {kw}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {selectedDoc.archivedAt && (
                  <div className="pt-3 border-t border-bauhaus-lightgray">
                    <p className="text-bauhaus-gray">
                      Archived: {formatDate(selectedDoc.archivedAt)}
                    </p>
                    {selectedDoc.archivedReason && (
                      <p className="text-bauhaus-gray italic">{selectedDoc.archivedReason}</p>
                    )}
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

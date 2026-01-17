import { useState, useEffect, useMemo } from 'react';
import { FileText, Mail, Calendar, Tag, DollarSign, RefreshCw, Eye, Link2, ExternalLink, MapPin, Users, Clock, User, Edit2, Check, X } from 'lucide-react';
import { cn, formatCurrency, formatDate } from '@/lib/utils';
import { FilterTabs, type FilterTabItem, EmptyState as SharedEmptyState, LoadingSpinner } from '@/components';
import { api, getDocumentFileUrl, type MedicalDocument } from '@/lib/api';

const CURRENCIES = ['EUR', 'USD', 'GBP', 'HRK', 'CHF'];

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

export default function Documents() {
  const [documents, setDocuments] = useState<MedicalDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDoc, setSelectedDoc] = useState<MedicalDocument | null>(null);
  const [filter, setFilter] = useState<string>('all');
  const [showOcr, setShowOcr] = useState(false);

  // Override editor state
  const [editingOverride, setEditingOverride] = useState(false);
  const [overrideAmount, setOverrideAmount] = useState('');
  const [overrideCurrency, setOverrideCurrency] = useState('EUR');
  const [overrideNote, setOverrideNote] = useState('');
  const [savingOverride, setSavingOverride] = useState(false);

  useEffect(() => {
    loadDocuments();
  }, []);

  // Sync override form when selected doc changes
  useEffect(() => {
    if (selectedDoc?.paymentOverride) {
      setOverrideAmount(selectedDoc.paymentOverride.amount.toString());
      setOverrideCurrency(selectedDoc.paymentOverride.currency);
      setOverrideNote(selectedDoc.paymentOverride.note ?? '');
    } else {
      setOverrideAmount('');
      setOverrideCurrency('EUR');
      setOverrideNote('');
    }
    setEditingOverride(false);
  }, [selectedDoc?.id]);

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

  async function handleSaveOverride() {
    if (!selectedDoc) return;
    const amountValue = parseFloat(overrideAmount);
    if (isNaN(amountValue) || amountValue < 0) {
      alert('Please enter a valid positive amount');
      return;
    }

    setSavingOverride(true);
    try {
      const updated = await api.setPaymentOverride(selectedDoc.id, {
        amount: amountValue,
        currency: overrideCurrency,
        note: overrideNote || undefined,
      });
      setDocuments((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
      setSelectedDoc(updated);
      setEditingOverride(false);
    } catch (err) {
      console.error('Failed to save override:', err);
      alert(`Error: ${err}`);
    } finally {
      setSavingOverride(false);
    }
  }

  async function handleClearOverride() {
    if (!selectedDoc) return;
    if (!confirm('Remove the payment override?')) return;

    setSavingOverride(true);
    try {
      const updated = await api.setPaymentOverride(selectedDoc.id, null);
      setDocuments((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
      setSelectedDoc(updated);
      setOverrideAmount('');
      setOverrideNote('');
      setEditingOverride(false);
    } catch (err) {
      console.error('Failed to clear override:', err);
      alert(`Error: ${err}`);
    } finally {
      setSavingOverride(false);
    }
  }

  const filteredDocs = useMemo(() => {
    if (filter === 'all') return documents;
    if (filter === 'calendar') return documents.filter(d => d.sourceType === 'calendar');
    return documents.filter(d => d.classification === filter);
  }, [documents, filter]);

  const classificationCounts = useMemo(() =>
    documents.reduce((acc, doc) => {
      acc[doc.classification] = (acc[doc.classification] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
    [documents]
  );

  const calendarCount = useMemo(
    () => documents.filter(d => d.sourceType === 'calendar').length,
    [documents]
  );

  const filterItems: FilterTabItem<string>[] = useMemo(() => [
    { key: 'all', label: 'All', count: documents.length },
    { key: 'calendar', label: <><Calendar size={14} /> Calendar</>, count: calendarCount, highlight: true },
    ...Object.entries(classificationLabels).map(([key, { label }]) => ({
      key,
      label,
      count: classificationCounts[key] || 0,
    })),
  ], [documents.length, calendarCount, classificationCounts]);

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
      <div className="mb-6">
        <FilterTabs items={filterItems} active={filter} onChange={setFilter} />
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : documents.length === 0 ? (
        <SharedEmptyState
          icon={FileText}
          title="No Documents Yet"
          message="Process email attachments to find medical documents"
          action={{ label: 'Process Attachments', onClick: () => { } }}
        />
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
            <div className="bauhaus-card h-fit lg:sticky lg:top-8 max-h-[calc(100vh-120px)] flex flex-col">
              <div className="overflow-auto flex-1 min-h-0">
                {selectedDoc.sourceType === 'calendar' ? (
                  <CalendarEventDetail doc={selectedDoc} />
                ) : (
                  <>
                    <div className="sticky top-0 bg-white z-10 pb-3 border-b border-bauhaus-lightgray">
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

                      <h2 className="text-lg font-bold">
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
                    </div>

                    <div className="space-y-3 mb-6 pt-4">
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

                    {/* Payment Override */}
                    {selectedDoc.sourceType === 'attachment' && (
                      <div className="mb-6">
                        <div className="flex items-center justify-between mb-3">
                          <h3 className="font-bold flex items-center gap-2">
                            <DollarSign size={18} />
                            Payment Amount
                          </h3>
                          {!editingOverride && (
                            <button
                              onClick={() => setEditingOverride(true)}
                              className="text-sm text-bauhaus-blue hover:underline flex items-center gap-1"
                            >
                              <Edit2 size={14} />
                              {selectedDoc.paymentOverride ? 'Edit Override' : 'Set Override'}
                            </button>
                          )}
                        </div>

                        {/* Current override or detected amounts display */}
                        {!editingOverride && (
                          <>
                            {selectedDoc.paymentOverride && (
                              <div className="p-3 bg-green-50 border-2 border-green-500 mb-2">
                                <div className="flex items-center justify-between">
                                  <div>
                                    <span className="text-xs uppercase text-green-700 font-medium">Manual Override</span>
                                    <p className="font-bold text-lg text-green-800">
                                      {formatCurrency(selectedDoc.paymentOverride.amount, selectedDoc.paymentOverride.currency)}
                                    </p>
                                    {selectedDoc.paymentOverride.note && (
                                      <p className="text-sm text-green-700 mt-1">{selectedDoc.paymentOverride.note}</p>
                                    )}
                                  </div>
                                  <button
                                    onClick={handleClearOverride}
                                    disabled={savingOverride}
                                    className="p-1 text-red-600 hover:bg-red-50"
                                    title="Remove override"
                                  >
                                    <X size={16} />
                                  </button>
                                </div>
                              </div>
                            )}

                            {selectedDoc.detectedAmounts.length > 0 && (
                              <div className={cn(selectedDoc.paymentOverride && 'opacity-50')}>
                                <p className="text-xs text-bauhaus-gray mb-2">
                                  {selectedDoc.paymentOverride ? 'Original detected amounts (ignored):' : 'Detected amounts:'}
                                </p>
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

                            {!selectedDoc.paymentOverride && selectedDoc.detectedAmounts.length === 0 && (
                              <p className="text-sm text-bauhaus-gray">No amounts detected. Set an override to create draft claims.</p>
                            )}
                          </>
                        )}

                        {/* Override editor */}
                        {editingOverride && (
                          <div className="p-4 border-2 border-bauhaus-blue bg-bauhaus-blue/5">
                            <div className="grid grid-cols-2 gap-3 mb-3">
                              <div>
                                <label className="block text-xs text-bauhaus-gray mb-1">Amount</label>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={overrideAmount}
                                  onChange={(e) => setOverrideAmount(e.target.value)}
                                  className="w-full p-2 border-2 border-bauhaus-black focus:outline-none focus:ring-2 focus:ring-bauhaus-blue"
                                  placeholder="80.00"
                                />
                              </div>
                              <div>
                                <label className="block text-xs text-bauhaus-gray mb-1">Currency</label>
                                <select
                                  value={overrideCurrency}
                                  onChange={(e) => setOverrideCurrency(e.target.value)}
                                  className="w-full p-2 border-2 border-bauhaus-black focus:outline-none focus:ring-2 focus:ring-bauhaus-blue"
                                >
                                  {CURRENCIES.map((c) => (
                                    <option key={c} value={c}>{c}</option>
                                  ))}
                                </select>
                              </div>
                            </div>
                            <div className="mb-3">
                              <label className="block text-xs text-bauhaus-gray mb-1">Note (optional)</label>
                              <input
                                type="text"
                                value={overrideNote}
                                onChange={(e) => setOverrideNote(e.target.value)}
                                className="w-full p-2 border-2 border-bauhaus-black focus:outline-none focus:ring-2 focus:ring-bauhaus-blue"
                                placeholder="e.g., OCR misread amount"
                              />
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={handleSaveOverride}
                                disabled={savingOverride || !overrideAmount}
                                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-bauhaus-blue text-white font-medium hover:bg-bauhaus-blue/90 disabled:opacity-50"
                              >
                                <Check size={16} />
                                {savingOverride ? 'Saving...' : 'Save Override'}
                              </button>
                              <button
                                onClick={() => {
                                  setEditingOverride(false);
                                  // Reset to current values
                                  if (selectedDoc.paymentOverride) {
                                    setOverrideAmount(selectedDoc.paymentOverride.amount.toString());
                                    setOverrideCurrency(selectedDoc.paymentOverride.currency);
                                    setOverrideNote(selectedDoc.paymentOverride.note ?? '');
                                  } else {
                                    setOverrideAmount('');
                                    setOverrideNote('');
                                  }
                                }}
                                disabled={savingOverride}
                                className="px-3 py-2 border-2 border-bauhaus-black font-medium hover:bg-bauhaus-lightgray disabled:opacity-50"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Detected amounts for non-attachment documents */}
                    {selectedDoc.sourceType !== 'attachment' && selectedDoc.detectedAmounts.length > 0 && (
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
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
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
  const isCalendar = document.sourceType === 'calendar';
  const typeIcon = isCalendar ? Calendar : document.sourceType === 'email' ? Mail : FileText;
  const Icon = typeIcon;
  const hasFile = !!document.attachmentPath;

  // For calendar events, use different display logic
  const title = isCalendar
    ? document.calendarSummary || 'Calendar Event'
    : document.filename || document.subject || 'Untitled';

  const subtitle = isCalendar
    ? document.calendarLocation || document.calendarOrganizer?.displayName || document.calendarOrganizer?.email
    : document.fromAddress;

  const displayDate = isCalendar
    ? document.calendarStart
    : document.date;

  return (
    <div
      onClick={onClick}
      className={cn(
        'bauhaus-card cursor-pointer',
        selected && 'ring-2 ring-bauhaus-blue',
        isCalendar && 'border-l-4 border-l-teal-500'
      )}
    >
      <div className="flex items-start gap-4">
        <div className={cn(
          'w-10 h-10 flex items-center justify-center',
          isCalendar ? 'bg-teal-600' : classificationLabels[document.classification]?.color,
          'text-white'
        )}>
          <Icon size={20} />
        </div>
        <div className="flex-1 min-w-0">
          {hasFile && !isCalendar ? (
            <a
              href={getDocumentFileUrl(document.id)}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium truncate block text-bauhaus-blue hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {title}
            </a>
          ) : (
            <p className={cn("font-medium truncate", isCalendar && "text-teal-700")}>
              {title}
            </p>
          )}
          {subtitle && (
            <p className="text-sm text-bauhaus-gray truncate flex items-center gap-1">
              {isCalendar && <MapPin size={12} />}
              {subtitle}
            </p>
          )}
          {/* Show attendees count for calendar events */}
          {isCalendar && document.calendarAttendees && document.calendarAttendees.length > 0 && (
            <p className="text-xs text-bauhaus-gray mt-1 flex items-center gap-1">
              <Users size={12} />
              {document.calendarAttendees.length} attendee{document.calendarAttendees.length > 1 ? 's' : ''}
            </p>
          )}
          {/* Show amounts for non-calendar documents */}
          {!isCalendar && document.detectedAmounts.length > 0 && (
            <p className="text-sm font-medium text-bauhaus-blue mt-1">
              {document.detectedAmounts.map(a =>
                formatCurrency(a.value, a.currency)
              ).join(', ')}
            </p>
          )}
        </div>
        <div className="text-right">
          {displayDate && (
            <p className="text-xs text-bauhaus-gray">
              {formatDate(displayDate)}
            </p>
          )}
          {isCalendar && (
            <span className="text-xs px-1.5 py-0.5 bg-teal-100 text-teal-700 mt-1 inline-block">
              Calendar
            </span>
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

function CalendarEventDetail({ doc }: { doc: MedicalDocument }) {
  return (
    <>
      <div className="sticky top-0 bg-white z-10 pb-3 border-b border-bauhaus-lightgray">
        <div className="flex items-start justify-between mb-4">
          <span className="inline-block px-2 py-1 text-xs font-medium uppercase bg-teal-600 text-white">
            Calendar Event
          </span>
        </div>

        <h2 className="text-lg font-bold text-teal-700">
          {doc.calendarSummary || 'Untitled Event'}
        </h2>
      </div>

      <div className="space-y-3 mb-6 pt-4">
        {doc.calendarStart && (
          <DetailRow
            icon={Clock}
            label="When"
            value={`${formatDate(doc.calendarStart)}${doc.calendarEnd ? ` - ${formatDate(doc.calendarEnd)}` : ''}`}
          />
        )}
        {doc.calendarLocation && (
          <DetailRow icon={MapPin} label="Location" value={doc.calendarLocation} />
        )}
        {doc.calendarOrganizer && (
          <DetailRow
            icon={User}
            label="Organizer"
            value={doc.calendarOrganizer.displayName || doc.calendarOrganizer.email || 'Unknown'}
          />
        )}
        {doc.calendarConferenceUrl && (
          <div className="flex items-center gap-3">
            <ExternalLink size={16} className="text-bauhaus-gray flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="text-sm text-bauhaus-gray">Meeting Link: </span>
              <a
                href={doc.calendarConferenceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-bauhaus-blue hover:underline truncate"
              >
                Join Meeting
              </a>
            </div>
          </div>
        )}
      </div>

      {/* Attendees */}
      {doc.calendarAttendees && doc.calendarAttendees.length > 0 && (
        <div className="mb-6">
          <h3 className="font-bold mb-3 flex items-center gap-2">
            <Users size={18} />
            Attendees ({doc.calendarAttendees.length})
          </h3>
          <div className="space-y-2">
            {doc.calendarAttendees.map((attendee, idx) => (
              <div
                key={idx}
                className="p-2 bg-teal-50 border border-teal-200 flex items-center justify-between"
              >
                <div>
                  <span className="font-medium">{attendee.name || attendee.email}</span>
                  {attendee.name && (
                    <span className="text-sm text-bauhaus-gray ml-2">{attendee.email}</span>
                  )}
                </div>
                {attendee.response && (
                  <span className={cn(
                    'text-xs px-2 py-0.5 rounded',
                    attendee.response === 'accepted' ? 'bg-green-100 text-green-700' :
                      attendee.response === 'declined' ? 'bg-red-100 text-red-700' :
                        'bg-bauhaus-lightgray text-bauhaus-gray'
                  )}>
                    {attendee.response}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Description */}
      {doc.calendarDescription && (
        <div className="mb-6">
          <h3 className="font-bold mb-3">Description</h3>
          <div className="p-3 bg-teal-50 border border-teal-200 max-h-48 overflow-auto">
            <p className="text-sm whitespace-pre-wrap">{doc.calendarDescription}</p>
          </div>
        </div>
      )}

      {/* Medical keywords */}
      {doc.medicalKeywords.length > 0 && (
        <div>
          <h3 className="font-bold mb-3 flex items-center gap-2">
            <Tag size={18} />
            Medical Keywords
          </h3>
          <div className="flex flex-wrap gap-2">
            {doc.medicalKeywords.map((keyword, idx) => (
              <span
                key={idx}
                className="px-2 py-1 bg-teal-100 text-teal-700 text-sm"
              >
                {keyword}
              </span>
            ))}
          </div>
        </div>
      )}
    </>
  );
}


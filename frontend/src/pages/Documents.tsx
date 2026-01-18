import { useState, useEffect, useMemo, useRef } from 'react';
import { FileText, Mail, Calendar, Tag, DollarSign, RefreshCw, Eye, ExternalLink, MapPin, Users, Clock, User, Edit2, Check, X, Archive, Inbox, Trash2 } from 'lucide-react';
import { cn, formatCurrency, formatDate } from '@/lib/utils';
import {
  FilterTabs,
  type FilterTabItem,
  EmptyState as SharedEmptyState,
  LoadingSpinner,
  UnseenDivider,
} from '@/components';
import { api, getDocumentFileUrl, type ArchiveRule, type MedicalDocument } from '@/lib/api';
import { useUnseenList } from '@/lib/useUnseenList';
import { useUnseenDivider } from '@/lib/useUnseenDivider';

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
  const {
    items: documents,
    loading,
    unseenIds,
    refresh: refreshDocuments,
    markAllSeen,
    upsertItem,
  } = useUnseenList<MedicalDocument>({
    fetcher: api.getDocuments,
    cacheKey: 'documents',
  });

  const [selectedDoc, setSelectedDoc] = useState<MedicalDocument | null>(null);
  const [filter, setFilter] = useState<string>('all');
  const [showOcr, setShowOcr] = useState(false);
  const dividerRef = useRef<HTMLDivElement | null>(null);

  // Override editor state
  const [editingOverride, setEditingOverride] = useState(false);
  const [overrideAmount, setOverrideAmount] = useState('');
  const [overrideCurrency, setOverrideCurrency] = useState('EUR');
  const [overrideNote, setOverrideNote] = useState('');
  const [savingOverride, setSavingOverride] = useState(false);
  const [archiving, setArchiving] = useState(false);

  // Archive rules state
  const [archiveRules, setArchiveRules] = useState<ArchiveRule[]>([]);
  const [loadingRules, setLoadingRules] = useState(true);
  const [savingRule, setSavingRule] = useState(false);
  const [ruleName, setRuleName] = useState('');
  const [ruleFrom, setRuleFrom] = useState('');
  const [ruleSubject, setRuleSubject] = useState('');
  const [ruleAttachment, setRuleAttachment] = useState('');
  const [ruleApplyToExisting, setRuleApplyToExisting] = useState(true);
  const [ruleError, setRuleError] = useState<string | null>(null);

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

  useEffect(() => {
    if (!selectedDoc) return;
    const updated = documents.find((doc) => doc.id === selectedDoc.id);
    if (updated && updated !== selectedDoc) {
      setSelectedDoc(updated);
    }
  }, [documents, selectedDoc]);

  useEffect(() => {
    let active = true;

    const loadRules = async () => {
      setLoadingRules(true);
      try {
        const rules = await api.getArchiveRules();
        if (!active) return;
        setArchiveRules(rules);
        setRuleError(null);
      } catch (err) {
        console.error('Failed to load archive rules:', err);
        if (active) {
          setRuleError('Failed to load archive rules');
        }
      } finally {
        if (active) {
          setLoadingRules(false);
        }
      }
    };

    loadRules();
    const interval = setInterval(loadRules, 60000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

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
      upsertItem(updated);
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
      upsertItem(updated);
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

  async function handleArchiveToggle() {
    if (!selectedDoc) return;
    const isArchived = !!selectedDoc.archivedAt;
    const message = isArchived
      ? 'Unarchive this document?'
      : 'Archive this document?';
    if (!confirm(message)) return;

    setArchiving(true);
    try {
      const updated = await api.setDocumentArchived(selectedDoc.id, {
        archived: !isArchived,
        ...(!isArchived && { reason: 'Manual archive' }),
      });
      upsertItem(updated);
      setSelectedDoc(updated);
      refreshDocuments();
    } catch (err) {
      console.error('Failed to update archive status:', err);
      alert(`Error: ${err}`);
    } finally {
      setArchiving(false);
    }
  }

  async function handleCreateArchiveRule() {
    const name = ruleName.trim();
    const fromContains = ruleFrom.trim();
    const subjectContains = ruleSubject.trim();
    const attachmentNameContains = ruleAttachment.trim();

    if (!name) {
      setRuleError('Rule name is required');
      return;
    }
    if (!fromContains && !subjectContains && !attachmentNameContains) {
      setRuleError('Add at least one match condition');
      return;
    }

    setSavingRule(true);
    setRuleError(null);
    try {
      const created = await api.createArchiveRule({
        name,
        enabled: true,
        ...(fromContains && { fromContains }),
        ...(subjectContains && { subjectContains }),
        ...(attachmentNameContains && { attachmentNameContains }),
        applyToExisting: ruleApplyToExisting,
      });
      setArchiveRules((prev) => [created, ...prev]);
      setRuleName('');
      setRuleFrom('');
      setRuleSubject('');
      setRuleAttachment('');
      setRuleApplyToExisting(true);
      refreshDocuments();
    } catch (err) {
      console.error('Failed to create archive rule:', err);
      setRuleError('Failed to create rule');
    } finally {
      setSavingRule(false);
    }
  }

  async function handleToggleRule(rule: ArchiveRule) {
    try {
      const updated = await api.updateArchiveRule(rule.id, {
        enabled: !rule.enabled,
      });
      setArchiveRules((prev) =>
        prev.map((r) => (r.id === updated.id ? updated : r))
      );
    } catch (err) {
      console.error('Failed to update rule:', err);
      alert(`Error: ${err}`);
    }
  }

  async function handleDeleteRule(rule: ArchiveRule) {
    if (!confirm(`Delete rule "${rule.name}"?`)) return;
    try {
      const result = await api.deleteArchiveRule(rule.id);
      if (result.success) {
        setArchiveRules((prev) => prev.filter((r) => r.id !== rule.id));
      }
    } catch (err) {
      console.error('Failed to delete rule:', err);
      alert(`Error: ${err}`);
    }
  }

  function handlePrefillRuleFromSender() {
    if (!selectedDoc?.fromAddress) return;
    setRuleFrom(selectedDoc.fromAddress);
    if (!ruleName.trim()) {
      setRuleName(`Archive ${selectedDoc.fromAddress}`);
    }
  }

  const filteredDocs = useMemo(() => {
    const activeDocuments = documents.filter((doc) => !doc.archivedAt);
    const archivedDocuments = documents.filter((doc) => doc.archivedAt);

    const base = filter === 'archived'
      ? archivedDocuments
      : filter === 'all'
        ? activeDocuments
        : filter === 'calendar'
          ? activeDocuments.filter(d => d.sourceType === 'calendar')
          : activeDocuments.filter(d => d.classification === filter);

    // Sort by date descending (most recent first)
    return [...base].sort((a, b) => {
      const dateA = new Date(a.date ?? a.processedAt).getTime();
      const dateB = new Date(b.date ?? b.processedAt).getTime();
      return dateB - dateA;
    });
  }, [documents, filter]);

  const groupedDocs = useMemo(() => {
    const filteredIds = new Set(filteredDocs.map((doc) => doc.id));
    const restrictToFiltered = filter === 'archived';
    const emailGroups = new Map<string, MedicalDocument[]>();
    const standalone: MedicalDocument[] = [];

    for (const doc of documents) {
      if (doc.emailId && doc.sourceType !== 'calendar') {
        const existing = emailGroups.get(doc.emailId) ?? [];
        existing.push(doc);
        emailGroups.set(doc.emailId, existing);
      } else {
        standalone.push(doc);
      }
    }

    const groups: Array<{ key: string; docs: MedicalDocument[] }> = [];

    for (const [emailId, docs] of emailGroups.entries()) {
      const visibleDocs = restrictToFiltered
        ? docs.filter((doc) => filteredIds.has(doc.id))
        : docs;
      if (visibleDocs.length === 0) continue;
      const sorted = [...visibleDocs].sort((a, b) => {
        const dateA = new Date(
          (a.sourceType === 'calendar' ? a.calendarStart : a.date) ?? a.processedAt
        ).getTime();
        const dateB = new Date(
          (b.sourceType === 'calendar' ? b.calendarStart : b.date) ?? b.processedAt
        ).getTime();
        return dateB - dateA;
      });
      groups.push({ key: emailId, docs: sorted });
    }

    for (const doc of standalone) {
      if (!filteredIds.has(doc.id)) continue;
      groups.push({ key: doc.id, docs: [doc] });
    }

    const groupDate = (docs: MedicalDocument[]) =>
      Math.max(
        ...docs.map((doc) =>
          new Date(
            (doc.sourceType === 'calendar' ? doc.calendarStart : doc.date) ?? doc.processedAt
          ).getTime()
        )
      );

    groups.sort((a, b) => groupDate(b.docs) - groupDate(a.docs));
    return groups;
  }, [documents, filteredDocs, filter]);

  const groupedSections = useMemo(() => {
    const unseenGroups = groupedDocs.filter((group) =>
      group.docs.some((doc) => unseenIds.has(doc.id))
    );
    const seenGroups = groupedDocs.filter(
      (group) => !group.docs.some((doc) => unseenIds.has(doc.id))
    );
    return {
      unseenGroups,
      seenGroups,
      hasVisibleUnseen: unseenGroups.length > 0,
    };
  }, [groupedDocs, unseenIds]);

  useUnseenDivider({
    dividerRef,
    onSeen: markAllSeen,
    active: groupedSections.hasVisibleUnseen,
    deps: [groupedDocs, filter],
  });

  const activeDocuments = useMemo(
    () => documents.filter((doc) => !doc.archivedAt),
    [documents]
  );

  const archivedDocuments = useMemo(
    () => documents.filter((doc) => doc.archivedAt),
    [documents]
  );

  const classificationCounts = useMemo(() =>
    activeDocuments.reduce((acc, doc) => {
      acc[doc.classification] = (acc[doc.classification] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
    [activeDocuments]
  );

  const calendarCount = useMemo(
    () => activeDocuments.filter(d => d.sourceType === 'calendar').length,
    [activeDocuments]
  );

  const filterItems: FilterTabItem<string>[] = useMemo(() => [
    { key: 'all', label: 'All', count: activeDocuments.length },
    { key: 'calendar', label: <><Calendar size={14} /> Calendar</>, count: calendarCount, highlight: true },
    ...Object.entries(classificationLabels).map(([key, { label }]) => ({
      key,
      label,
      count: classificationCounts[key] || 0,
    })),
    { key: 'archived', label: 'Archived', count: archivedDocuments.length },
  ], [activeDocuments.length, calendarCount, classificationCounts, archivedDocuments.length]);

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold bauhaus-accent">Documents</h1>
        <button
          onClick={refreshDocuments}
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
            {groupedSections.unseenGroups.map((group) => {
              if (group.docs.length > 1) {
                return (
                  <DocumentGroupCard
                    key={group.key}
                    documents={group.docs}
                    selectedDoc={selectedDoc}
                    onSelect={setSelectedDoc}
                  />
                );
              }

              const doc = group.docs[0]!;
              return (
                <DocumentCard
                  key={doc.id}
                  document={doc}
                  selected={selectedDoc?.id === doc.id}
                  onClick={() => setSelectedDoc(doc)}
                />
              );
            })}
            <UnseenDivider
              ref={dividerRef}
              visible={groupedSections.hasVisibleUnseen}
              label="Unseen"
            />
            {groupedSections.seenGroups.map((group) => {
              if (group.docs.length > 1) {
                return (
                  <DocumentGroupCard
                    key={group.key}
                    documents={group.docs}
                    selectedDoc={selectedDoc}
                    onSelect={setSelectedDoc}
                  />
                );
              }

              const doc = group.docs[0]!;
              return (
                <DocumentCard
                  key={doc.id}
                  document={doc}
                  selected={selectedDoc?.id === doc.id}
                  onClick={() => setSelectedDoc(doc)}
                />
              );
            })}
          </div>

          {/* Document detail */}
          {selectedDoc && (
            <div className="bauhaus-card h-fit lg:sticky lg:top-8 max-h-[calc(100vh-120px)] flex flex-col">
              <div className="overflow-auto flex-1 min-h-0">
                {selectedDoc.sourceType === 'calendar' ? (
                  <CalendarEventDetail
                    doc={selectedDoc}
                    onArchiveToggle={handleArchiveToggle}
                    archiving={archiving}
                  />
                ) : (
                  <>
                    <div className="sticky top-0 bg-white z-10 pb-3 border-b border-bauhaus-lightgray">
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <span className={cn(
                            'inline-block px-2 py-1 text-xs font-medium uppercase text-white',
                            classificationLabels[selectedDoc.classification]?.color
                          )}>
                            {classificationLabels[selectedDoc.classification]?.label}
                          </span>
                          {selectedDoc.archivedAt && (
                            <span className="inline-block px-2 py-1 text-xs font-medium uppercase bg-bauhaus-gray text-white">
                              Archived
                            </span>
                          )}
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
                            onClick={handleArchiveToggle}
                            disabled={archiving}
                            className={cn(
                              'p-2 border transition-colors',
                              selectedDoc.archivedAt
                                ? 'border-bauhaus-blue text-bauhaus-blue hover:bg-bauhaus-lightgray'
                                : 'border-bauhaus-red text-bauhaus-red hover:bg-bauhaus-lightgray',
                              archiving && 'opacity-60 cursor-not-allowed'
                            )}
                            title={selectedDoc.archivedAt ? 'Unarchive' : 'Archive'}
                          >
                            {selectedDoc.archivedAt ? <Inbox size={18} /> : <Archive size={18} />}
                          </button>
                          {selectedDoc.attachmentPath && (
                            <a
                              href={getDocumentFileUrl(selectedDoc.id)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-2 border hover:bg-bauhaus-lightgray transition-colors"
                              title="Open original file"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <ExternalLink size={18} />
                            </a>
                          )}
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
                      {selectedDoc.archivedAt && (
                        <DetailRow
                          icon={Archive}
                          label="Archived"
                          value={[
                            formatDate(selectedDoc.archivedAt),
                            selectedDoc.archivedReason,
                          ]
                            .filter(Boolean)
                            .join(' • ')}
                        />
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

                    {/* Archive rules */}
                    <div className="mb-6">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <h3 className="font-bold flex items-center gap-2">
                            <Archive size={18} />
                            Archive Rules
                          </h3>
                          <p className="text-xs text-bauhaus-gray">
                            Auto-archive documents by sender, subject, or attachment name.
                          </p>
                        </div>
                        {selectedDoc.fromAddress && (
                          <button
                            onClick={handlePrefillRuleFromSender}
                            className="text-xs text-bauhaus-blue hover:underline"
                          >
                            Use sender
                          </button>
                        )}
                      </div>

                      <div className="space-y-3 mb-4">
                        <div>
                          <label className="block text-xs text-bauhaus-gray mb-1">Rule name</label>
                          <input
                            value={ruleName}
                            onChange={(e) => setRuleName(e.target.value)}
                            className="w-full p-2 border-2 border-bauhaus-black focus:outline-none focus:ring-2 focus:ring-bauhaus-blue"
                            placeholder="Archive Hetzner invoices"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-bauhaus-gray mb-1">From contains</label>
                          <input
                            value={ruleFrom}
                            onChange={(e) => setRuleFrom(e.target.value)}
                            className="w-full p-2 border-2 border-bauhaus-black focus:outline-none focus:ring-2 focus:ring-bauhaus-blue"
                            placeholder="billing@hetzner.com"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-bauhaus-gray mb-1">Subject contains</label>
                          <input
                            value={ruleSubject}
                            onChange={(e) => setRuleSubject(e.target.value)}
                            className="w-full p-2 border-2 border-bauhaus-black focus:outline-none focus:ring-2 focus:ring-bauhaus-blue"
                            placeholder="invoice"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-bauhaus-gray mb-1">Attachment name contains</label>
                          <input
                            value={ruleAttachment}
                            onChange={(e) => setRuleAttachment(e.target.value)}
                            className="w-full p-2 border-2 border-bauhaus-black focus:outline-none focus:ring-2 focus:ring-bauhaus-blue"
                            placeholder="hetzner"
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <label className="text-xs text-bauhaus-gray flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={ruleApplyToExisting}
                              onChange={(e) => setRuleApplyToExisting(e.target.checked)}
                            />
                            Apply to existing documents
                          </label>
                          <button
                            onClick={handleCreateArchiveRule}
                            disabled={savingRule}
                            className="px-3 py-2 text-xs border-2 border-bauhaus-black hover:bg-bauhaus-lightgray disabled:opacity-60"
                          >
                            {savingRule ? 'Saving...' : 'Create Rule'}
                          </button>
                        </div>
                        {ruleError && (
                          <p className="text-xs text-bauhaus-red">{ruleError}</p>
                        )}
                      </div>

                      <div className="space-y-2">
                        {loadingRules ? (
                          <p className="text-xs text-bauhaus-gray">Loading rules...</p>
                        ) : archiveRules.length === 0 ? (
                          <p className="text-xs text-bauhaus-gray">No archive rules yet.</p>
                        ) : (
                          archiveRules.map((rule) => {
                            const conditions = [
                              rule.fromContains && `From contains "${rule.fromContains}"`,
                              rule.subjectContains && `Subject contains "${rule.subjectContains}"`,
                              rule.attachmentNameContains && `Attachment contains "${rule.attachmentNameContains}"`,
                            ]
                              .filter(Boolean)
                              .join(' • ');

                            return (
                              <div
                                key={rule.id}
                                className="p-3 border-2 border-bauhaus-lightgray flex items-start justify-between gap-3"
                              >
                                <div>
                                  <p className="font-medium">{rule.name}</p>
                                  <p className="text-xs text-bauhaus-gray">
                                    {conditions || 'No conditions'}
                                  </p>
                                </div>
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() => handleToggleRule(rule)}
                                    className={cn(
                                      'px-2 py-1 text-xs border',
                                      rule.enabled
                                        ? 'border-bauhaus-blue text-bauhaus-blue'
                                        : 'border-bauhaus-gray text-bauhaus-gray'
                                    )}
                                  >
                                    {rule.enabled ? 'Enabled' : 'Disabled'}
                                  </button>
                                  <button
                                    onClick={() => handleDeleteRule(rule)}
                                    className="p-1 border border-bauhaus-red text-bauhaus-red hover:bg-bauhaus-lightgray"
                                    title="Delete rule"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>

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
  const isArchived = !!document.archivedAt;
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
        isCalendar && 'border-l-4 border-l-teal-500',
        isArchived && 'opacity-70'
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
          {isArchived && (
            <span className="text-xs px-1.5 py-0.5 bg-bauhaus-gray text-white mt-1 inline-block">
              Archived
            </span>
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

function DocumentGroupCard({
  documents,
  selectedDoc,
  onSelect,
}: {
  documents: MedicalDocument[];
  selectedDoc: MedicalDocument | null;
  onSelect: (doc: MedicalDocument) => void;
}) {
  const emailDoc = documents.find((doc) => doc.sourceType === 'email');
  const attachments = documents.filter((doc) => doc.sourceType === 'attachment');
  const primary = emailDoc ?? documents[0]!;
  const groupSelected = documents.some((doc) => doc.id === selectedDoc?.id);
  const groupArchived = documents.every((doc) => doc.archivedAt);

  const title = primary.subject || primary.filename || 'Email';
  const subtitle = primary.fromAddress;
  const displayDate = primary.date ?? primary.processedAt;

  return (
    <div
      onClick={() => onSelect(primary)}
      className={cn(
        'bauhaus-card cursor-pointer',
        groupSelected && 'ring-2 ring-bauhaus-blue',
        groupArchived && 'opacity-70'
      )}
    >
      <div className="flex items-start gap-4">
        <div className={cn(
          'w-10 h-10 flex items-center justify-center',
          emailDoc ? 'bg-bauhaus-red' : classificationLabels[primary.classification]?.color,
          'text-white'
        )}>
          {emailDoc ? <Mail size={20} /> : <FileText size={20} />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium truncate">{title}</p>
          {subtitle && (
            <p className="text-sm text-bauhaus-gray truncate flex items-center gap-1">
              {subtitle}
            </p>
          )}
        </div>
        <div className="text-right">
          {displayDate && (
            <p className="text-xs text-bauhaus-gray">
              {formatDate(displayDate)}
            </p>
          )}
          {groupArchived && (
            <span className="text-xs px-1.5 py-0.5 bg-bauhaus-gray text-white mt-1 inline-block">
              Archived
            </span>
          )}
        </div>
      </div>

      {attachments.length > 0 && (
        <div className="mt-3 pt-3 border-t border-bauhaus-lightgray space-y-2">
          <p className="text-xs uppercase tracking-wide text-bauhaus-gray">
            Attachments
          </p>
          {attachments.map((attachment) => {
            const isSelected = selectedDoc?.id === attachment.id;
            return (
              <div
                key={attachment.id}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(attachment);
                }}
                className={cn(
                  'flex items-start justify-between gap-4 p-2 border border-bauhaus-lightgray hover:bg-bauhaus-lightgray/50',
                  isSelected && 'bg-bauhaus-lightgray/70',
                  attachment.archivedAt && 'opacity-70'
                )}
              >
                <div className="min-w-0">
                  {attachment.attachmentPath ? (
                    <a
                      href={getDocumentFileUrl(attachment.id)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium truncate block text-bauhaus-blue hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {attachment.filename || attachment.subject || 'Attachment'}
                    </a>
                  ) : (
                    <p className="font-medium truncate">
                      {attachment.filename || attachment.subject || 'Attachment'}
                    </p>
                  )}
                  {attachment.detectedAmounts.length > 0 && (
                    <p className="text-sm font-medium text-bauhaus-blue mt-1">
                      {attachment.detectedAmounts.map(a =>
                        formatCurrency(a.value, a.currency)
                      ).join(', ')}
                    </p>
                  )}
                </div>
                <div className="text-right text-xs text-bauhaus-gray">
                  {attachment.date && formatDate(attachment.date)}
                </div>
              </div>
            );
          })}
        </div>
      )}
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

function CalendarEventDetail({
  doc,
  onArchiveToggle,
  archiving,
}: {
  doc: MedicalDocument;
  onArchiveToggle: () => void;
  archiving: boolean;
}) {
  const isArchived = !!doc.archivedAt;

  return (
    <>
      <div className="sticky top-0 bg-white z-10 pb-3 border-b border-bauhaus-lightgray">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className="inline-block px-2 py-1 text-xs font-medium uppercase bg-teal-600 text-white">
              Calendar Event
            </span>
            {isArchived && (
              <span className="inline-block px-2 py-1 text-xs font-medium uppercase bg-bauhaus-gray text-white">
                Archived
              </span>
            )}
          </div>
          <button
            onClick={onArchiveToggle}
            disabled={archiving}
            className={cn(
              'p-2 border transition-colors',
              isArchived
                ? 'border-bauhaus-blue text-bauhaus-blue hover:bg-bauhaus-lightgray'
                : 'border-bauhaus-red text-bauhaus-red hover:bg-bauhaus-lightgray',
              archiving && 'opacity-60 cursor-not-allowed'
            )}
            title={isArchived ? 'Unarchive' : 'Archive'}
          >
            {isArchived ? <Inbox size={18} /> : <Archive size={18} />}
          </button>
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
        {doc.archivedAt && (
          <DetailRow
            icon={Archive}
            label="Archived"
            value={[
              formatDate(doc.archivedAt),
              doc.archivedReason,
            ]
              .filter(Boolean)
              .join(' • ')}
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


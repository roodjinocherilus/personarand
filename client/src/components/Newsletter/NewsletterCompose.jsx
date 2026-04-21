import { useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { api } from '../../lib/api.js';

marked.setOptions({ gfm: true, breaks: true });

const TEMPLATES = [
  { key: 'deep_dive', label: 'Deep Dive', hint: '1500–2000 words, framework essay' },
  { key: 'roundup', label: 'Weekly Roundup', hint: '800–1200 words, repurposed social' },
  { key: 'case_study', label: 'Case Study', hint: '1200–1800 words, real situation' },
  { key: 'bts', label: 'Behind The Scenes', hint: 'Founder reflection, honest' },
];

const STARTER_MD = `# Your headline here

The opening hook. One or two sentences that earn the scroll.

## The framework

Name the framework. Explain its structure in 3–5 bullets.

- Point one
- Point two
- Point three

## Why it matters now

A concrete example. A real situation you've seen. Numbers, names, specifics.

## What to do about it

Actionable implications. What the reader should consider, test, or change on Monday.

— Roodjino
`;

export default function NewsletterCompose({ issueId, onBack }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  // When auto-save fails we surface the error and refuse to clear it until
  // the next successful save. This kills the "I thought it saved" failure
  // mode where the catch block used to swallow errors silently.
  const [autoSaveError, setAutoSaveError] = useState(null);
  const [id, setId] = useState(issueId);
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('');
  const [templateType, setTemplateType] = useState('deep_dive');
  const [markdown, setMarkdown] = useState(STARTER_MD);
  const [contentLinks, setContentLinks] = useState([]);
  const [status, setStatus] = useState('draft');
  const [sentAt, setSentAt] = useState(null);

  // AI state
  const [aiBusy, setAiBusy] = useState(null); // 'expand' | 'subjects' | 'extract'
  const [aiMessage, setAiMessage] = useState(null);
  const [subjectOptions, setSubjectOptions] = useState([]);
  const [extracted, setExtracted] = useState([]);

  // Expand modal
  const [showExpand, setShowExpand] = useState(false);
  const [libraryRows, setLibraryRows] = useState([]);
  const [selectedContentIds, setSelectedContentIds] = useState([]);

  // Send state
  const [testEmail, setTestEmail] = useState('');
  const [sendBusy, setSendBusy] = useState(false);
  const [sendMessage, setSendMessage] = useState(null);

  const firstLoadRef = useRef(true);

  async function loadIssue() {
    setLoading(true);
    setAutoSaveError(null);
    setSavedAt(null);
    try {
      if (issueId) {
        const issue = await api.newsletter.get(issueId);
        setId(issue.id);
        setTitle(issue.title || '');
        setSubject(issue.subject_line || '');
        setTemplateType(issue.template_type || 'deep_dive');
        setMarkdown(issue.content_md || STARTER_MD);
        setContentLinks(issue.content_links || []);
        setStatus(issue.status || 'draft');
        setSentAt(issue.sent_at);
      } else {
        // new issue
        setTitle('');
        setSubject('');
        setTemplateType('deep_dive');
        setMarkdown(STARTER_MD);
        setStatus('draft');
      }
    } finally {
      setLoading(false);
      firstLoadRef.current = true;
    }
  }
  useEffect(() => { loadIssue(); }, [issueId]);

  // Auto-save every 30s for drafts. Debounced: fires 30s after the last edit.
  // On failure we surface the error — session expired, server down, etc. —
  // so the user doesn't close the tab assuming it saved.
  useEffect(() => {
    if (firstLoadRef.current) { firstLoadRef.current = false; return; }
    if (status === 'sent') return;
    const t = setTimeout(async () => {
      try {
        if (!id) {
          const created = await api.newsletter.create({
            title: title || 'Untitled issue',
            subject_line: subject,
            content_md: markdown,
            template_type: templateType,
          });
          setId(created.id);
        } else {
          await api.newsletter.update(id, { title, subject_line: subject, content_md: markdown, template_type: templateType });
        }
        setSavedAt(new Date());
        setAutoSaveError(null);
      } catch (err) {
        console.warn('[newsletter] auto-save failed:', err);
        setAutoSaveError(err?.message || 'Auto-save failed');
      }
    }, 30000);
    return () => clearTimeout(t);
  }, [title, subject, markdown, templateType]);

  async function saveNow() {
    setSaving(true);
    try {
      if (!id) {
        const created = await api.newsletter.create({
          title: title || 'Untitled issue',
          subject_line: subject,
          content_md: markdown,
          template_type: templateType,
        });
        setId(created.id);
      } else {
        await api.newsletter.update(id, { title, subject_line: subject, content_md: markdown, template_type: templateType });
      }
      setSavedAt(new Date());
      // Manual save success also clears any auto-save error state.
      setAutoSaveError(null);
    } catch (err) {
      setAutoSaveError(err?.message || 'Save failed');
      alert(`Save failed: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleSubjectLines() {
    if (markdown.length < 100) { setAiMessage('Write more content first — need at least a paragraph to generate good subjects.'); return; }
    setAiBusy('subjects');
    setAiMessage(null);
    try {
      const { options, parse_error } = await api.newsletter.ai.subjectLines({ markdown, title });
      if (parse_error) setAiMessage(parse_error);
      setSubjectOptions(options || []);
    } catch (err) {
      setAiMessage(`Failed: ${err.message}`);
    } finally {
      setAiBusy(null);
    }
  }

  async function handleExtract() {
    if (markdown.length < 200) { setAiMessage('Newsletter needs more content before extracting social posts.'); return; }
    setAiBusy('extract');
    setAiMessage(null);
    try {
      const { posts, parse_error } = await api.newsletter.ai.extractSocial({ markdown, count: 6 });
      if (parse_error) setAiMessage(parse_error);
      setExtracted(posts || []);
    } catch (err) {
      setAiMessage(`Failed: ${err.message}`);
    } finally {
      setAiBusy(null);
    }
  }

  async function openExpand() {
    setShowExpand(true);
    try {
      const rows = await api.library.list({ sort: 'newest' });
      setLibraryRows(rows || []);
    } catch (err) {
      setAiMessage(`Failed to load library: ${err.message}`);
    }
  }

  async function runExpand() {
    if (selectedContentIds.length === 0) return;
    setAiBusy('expand');
    setAiMessage(null);
    try {
      const { markdown: draft } = await api.newsletter.ai.expandFromSocial({
        content_ids: selectedContentIds,
        template_type: templateType,
      });
      setMarkdown(draft);
      setShowExpand(false);
      setSelectedContentIds([]);
      setAiMessage('Draft written. Edit as needed before saving or sending.');
    } catch (err) {
      setAiMessage(`Failed: ${err.message}`);
    } finally {
      setAiBusy(null);
    }
  }

  async function sendTest() {
    if (!testEmail.includes('@')) { setSendMessage('Enter a valid test email.'); return; }
    if (!id) await saveNow();
    setSendBusy(true);
    setSendMessage(null);
    try {
      const result = await api.newsletter.sendTest(id, testEmail);
      setSendMessage(
        result.configured
          ? `Test sent to ${testEmail}.`
          : `Test logged but NOT actually sent (Resend not configured). Add RESEND_API_KEY to .env.`
      );
    } catch (err) {
      setSendMessage(`Failed: ${err.message}`);
    } finally {
      setSendBusy(false);
    }
  }

  async function sendToAll() {
    if (!id) await saveNow();
    const ov = await api.newsletter.overview().catch(() => null);
    const audience = ov?.total_subscribers || 0;
    if (audience === 0) {
      setSendMessage('No active subscribers. Add some on the Subscribers tab first.');
      return;
    }
    if (!confirm(`Send "${subject || title}" to ${audience} active subscribers now?`)) return;
    setSendBusy(true);
    setSendMessage(null);
    try {
      const result = await api.newsletter.send(id, 'all');
      setSendMessage(result.stub
        ? `Logged send to ${result.total_sent}, but Resend is NOT configured so nothing actually left the server.`
        : `Sent to ${result.total_sent}. Delivered: ${result.delivered}. Opens will populate as subscribers read.`);
      setStatus('sent');
      setSentAt(new Date().toISOString());
    } catch (err) {
      setSendMessage(`Failed: ${err.message}`);
    } finally {
      setSendBusy(false);
    }
  }

  // Sanitize the markdown-rendered HTML before injecting it into the DOM.
  // Without this, pasted markdown containing `<img onerror>`, `<script>`, or
  // `<a href="javascript:...">` would execute on preview.
  // FORBID_TAGS/FORBID_ATTR defaults cover script + event handlers; we also
  // strip `style` to keep previews consistent with the email template.
  const previewHtml = useMemo(() => {
    const raw = marked.parse(markdown || '');
    return DOMPurify.sanitize(raw, {
      USE_PROFILES: { html: true },
      FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick'],
    });
  }, [markdown]);
  const wordCount = markdown.trim() ? markdown.trim().split(/\s+/).length : 0;
  const readingMins = Math.max(1, Math.round(wordCount / 220));

  if (loading) return <div className="text-text-secondary">Loading…</div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button className="btn-ghost" onClick={onBack}>← All issues</button>
        <div className="flex flex-wrap items-center gap-2">
          {autoSaveError ? (
            <span
              className="text-[11px] text-danger inline-flex items-center gap-1.5"
              title={autoSaveError}
            >
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-danger" />
              Not saved — {autoSaveError.length > 60 ? `${autoSaveError.slice(0, 60)}…` : autoSaveError}
            </span>
          ) : savedAt ? (
            <span className="text-[11px] text-success">Saved {savedAt.toLocaleTimeString()}</span>
          ) : null}
          <span className="text-[11px] text-text-secondary">{wordCount} words · {readingMins} min read</span>
          <span className={`pill ${statusPill(status)}`}>{status}</span>
          {status !== 'sent' && (
            <button className="btn" onClick={saveNow} disabled={saving}>
              {saving ? 'Saving…' : autoSaveError ? 'Retry save' : 'Save'}
            </button>
          )}
        </div>
      </div>

      <div className="card-pad grid grid-cols-1 md:grid-cols-[1fr_200px_200px] gap-3 items-end">
        <div>
          <div className="label">Title</div>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. The Architect Problem" disabled={status === 'sent'} />
        </div>
        <div>
          <div className="label">Template</div>
          <select className="input" value={templateType} onChange={(e) => setTemplateType(e.target.value)} disabled={status === 'sent'}>
            {TEMPLATES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <div className="label">Subject line</div>
          <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="What arrives in the inbox" disabled={status === 'sent'} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_300px] gap-4">
        <div className="card-pad">
          <div className="section-title !mb-2">Editor · Markdown</div>
          <textarea
            className="input font-mono text-sm min-h-[560px]"
            value={markdown}
            onChange={(e) => setMarkdown(e.target.value)}
            disabled={status === 'sent'}
          />
        </div>

        <div className="card-pad overflow-auto max-h-[620px]">
          <div className="section-title !mb-2">Preview</div>
          <article
            className="prose-newsletter"
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        </div>

        <aside className="space-y-4">
          <div className="card-pad space-y-2">
            <div className="section-title !mb-1">AI assists</div>
            <button className="btn w-full justify-center" onClick={openExpand} disabled={aiBusy === 'expand' || status === 'sent'}>
              {aiBusy === 'expand' ? 'Expanding…' : 'Expand from social'}
            </button>
            <button className="btn w-full justify-center" onClick={handleSubjectLines} disabled={aiBusy === 'subjects'}>
              {aiBusy === 'subjects' ? 'Generating…' : 'Generate subject lines'}
            </button>
            <button className="btn w-full justify-center" onClick={handleExtract} disabled={aiBusy === 'extract'}>
              {aiBusy === 'extract' ? 'Extracting…' : 'Extract social posts'}
            </button>
            {aiMessage && <div className="text-[11px] text-text-secondary leading-relaxed">{aiMessage}</div>}
          </div>

          {subjectOptions.length > 0 && (
            <div className="card-pad space-y-2">
              <div className="section-title !mb-1">Subject line options</div>
              {subjectOptions.map((o, i) => (
                <div key={i} className="border border-border rounded p-2 hover:border-[#555] cursor-pointer" onClick={() => setSubject(o.subject)}>
                  <div className="flex justify-between text-[10px] text-text-secondary uppercase tracking-wider">
                    <span>{o.style}</span>
                    <span>{o.predicted_open_rate}% predicted</span>
                  </div>
                  <div className="text-sm mt-1">{o.subject}</div>
                </div>
              ))}
            </div>
          )}

          {extracted.length > 0 && (
            <div className="card-pad space-y-3">
              <div className="section-title !mb-1">Extracted social posts</div>
              {extracted.map((p, i) => (
                <div key={i} className="border border-border rounded p-2 space-y-2">
                  <div className="text-[10px] text-text-secondary uppercase tracking-wider">Post {i + 1}</div>
                  {p.x_standalone && (
                    <div>
                      <div className="text-[10px] text-text-secondary">X · {p.x_standalone.length}ch</div>
                      <div className="text-xs mt-0.5 whitespace-pre-wrap">{p.x_standalone}</div>
                    </div>
                  )}
                  {p.linkedin_post && (
                    <div>
                      <div className="text-[10px] text-text-secondary">LinkedIn</div>
                      <div className="text-xs mt-0.5 whitespace-pre-wrap line-clamp-4">{p.linkedin_post}</div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="card-pad space-y-2">
            <div className="section-title !mb-1">Send</div>
            <div>
              <div className="label">Test to</div>
              <input className="input" type="email" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} placeholder="your@email.com" />
            </div>
            <button className="btn w-full justify-center" onClick={sendTest} disabled={sendBusy || !subject}>
              {sendBusy ? 'Sending…' : 'Send test'}
            </button>
            <button
              className="btn-primary w-full justify-center"
              onClick={sendToAll}
              disabled={sendBusy || status === 'sent' || !subject || !markdown}
            >
              {status === 'sent' ? 'Already sent' : sendBusy ? 'Sending…' : 'Send to all subscribers'}
            </button>
            {sendMessage && <div className="text-[11px] text-text-secondary leading-relaxed">{sendMessage}</div>}
          </div>
        </aside>
      </div>

      {showExpand && (
        <ExpandModal
          rows={libraryRows}
          selected={selectedContentIds}
          onToggle={(id) => setSelectedContentIds((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id])}
          onClose={() => setShowExpand(false)}
          onRun={runExpand}
          busy={aiBusy === 'expand'}
        />
      )}
    </div>
  );
}

function ExpandModal({ rows, selected, onToggle, onClose, onRun, busy }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 md:p-8 overflow-y-auto bg-black/70">
      <div className="card w-full max-w-3xl my-4">
        <div className="px-6 py-4 border-b border-border flex items-start justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-widest text-text-secondary">Expand from social</div>
            <div className="text-lg font-semibold mt-1">Pick 2–3 posts to fold into a newsletter draft</div>
          </div>
          <button className="btn-ghost" onClick={onClose}>✕</button>
        </div>
        <div className="p-6 space-y-3 max-h-[60vh] overflow-y-auto">
          {rows.length === 0 ? (
            <div className="text-text-secondary text-sm">No content in the library yet. Generate some from the Calendar first.</div>
          ) : (
            rows.map((r) => (
              <label key={r.id} className={`block card-pad cursor-pointer transition-colors ${selected.includes(r.id) ? 'border-primary bg-primary/5' : 'hover:border-[#555]'}`}>
                <div className="flex items-start gap-3">
                  <input type="checkbox" checked={selected.includes(r.id)} onChange={() => onToggle(r.id)} className="mt-1" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-[10px] text-text-secondary">
                      <span>{r.platform || 'multi'}</span>
                      <span>·</span>
                      <span>{r.content_type}</span>
                      {r.calendar_funnel_layer && (<><span>·</span><span>{r.calendar_funnel_layer}</span></>)}
                    </div>
                    <div className="text-sm font-medium mt-1 truncate">{r.title}</div>
                    <div className="text-xs text-text-secondary mt-1 line-clamp-2">{(r.body || '').slice(0, 160)}</div>
                  </div>
                </div>
              </label>
            ))
          )}
        </div>
        <div className="px-6 py-4 border-t border-border flex justify-between items-center">
          <div className="text-xs text-text-secondary">{selected.length} selected · Best with 2–3</div>
          <div className="flex gap-2">
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn-primary" onClick={onRun} disabled={busy || selected.length === 0}>
              {busy ? 'Generating…' : 'Expand into newsletter'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function statusPill(status) {
  switch (status) {
    case 'draft': return 'border-border text-text-secondary';
    case 'scheduled': return 'border-blue-500/40 text-blue-300 bg-blue-500/10';
    case 'sent': return 'border-success/40 text-success bg-success/5';
    default: return 'border-border text-text-secondary';
  }
}

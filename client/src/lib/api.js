import { getAccessToken } from './supabase.js';

async function request(path, options = {}) {
  const token = await getAccessToken().catch(() => null);
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };
  const res = await fetch(path, {
    ...options,
    headers,
    body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body,
  });
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const err = new Error((data && data.error) || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function safeJson(s) { try { return JSON.parse(s); } catch { return s; } }

/**
 * Trigger a file download from an authed endpoint. Uses the same bearer token
 * as api.request, but returns raw bytes and forces the browser to save them
 * under the server-suggested filename.
 */
async function downloadFile(path, fallbackName = 'export.md') {
  const token = await getAccessToken().catch(() => null);
  const res = await fetch(path, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); msg = j.error || msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  const blob = await res.blob();
  // Pull filename from Content-Disposition when present.
  const disp = res.headers.get('Content-Disposition') || '';
  const match = disp.match(/filename="([^"]+)"/);
  const filename = match ? match[1] : fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const api = {
  calendar: {
    list: (params = {}) => {
      const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
      return request(`/api/calendar${qs ? `?${qs}` : ''}`);
    },
    get: (id) => request(`/api/calendar/${id}`),
    setStatus: (id, status) => request(`/api/calendar/${id}/status`, {
      method: 'POST',
      body: { status },
    }),
    create: (payload) => request('/api/calendar', { method: 'POST', body: payload }),
    update: (id, payload) => request(`/api/calendar/${id}`, { method: 'PATCH', body: payload }),
    remove: (id) => request(`/api/calendar/${id}`, { method: 'DELETE' }),
    clearAll: () => request('/api/calendar-ai/clear', { method: 'POST' }),
    planMonth: (payload) => request('/api/calendar-ai/plan-month', { method: 'POST', body: payload }),
    brainstorm: (payload) => request('/api/calendar-ai/brainstorm', { method: 'POST', body: payload }),
    deepen: (id) => request(`/api/calendar-ai/${id}/deepen`, { method: 'POST' }),
    refineBrief: (id, payload) => request(`/api/calendar-ai/${id}/refine-brief`, { method: 'POST', body: payload }),
    gaps: () => request('/api/calendar-ai/gaps'),
    reseed: (force = false) => request('/api/calendar-ai/reseed', { method: 'POST', body: { force } }),
    reactiveAngles: (payload) => request('/api/calendar-ai/reactive-angles', { method: 'POST', body: payload }),
  },
  generate: {
    content: (payload) => request('/api/generate/content', { method: 'POST', body: payload }),
    hooks: (payload) => request('/api/generate/hooks', { method: 'POST', body: payload }),
  },
  prompts: {
    build: (payload) => request('/api/prompts/build', { method: 'POST', body: payload }),
  },
  subscribers: {
    list: (params = {}) => {
      const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
      return request(`/api/subscribers${qs ? `?${qs}` : ''}`);
    },
    facets: () => request('/api/subscribers/facets'),
    overview: () => request('/api/subscribers/overview'),
    leaders: () => request('/api/subscribers/engagement-leaders'),
    needsReengagement: () => request('/api/subscribers/needs-reengagement'),
    create: (payload) => request('/api/subscribers', { method: 'POST', body: payload }),
    update: (id, payload) => request(`/api/subscribers/${id}`, { method: 'PATCH', body: payload }),
    remove: (id) => request(`/api/subscribers/${id}`, { method: 'DELETE' }),
    import: (rows) => request('/api/subscribers/import', { method: 'POST', body: { rows } }),
  },
  newsletter: {
    list: () => request('/api/newsletter'),
    get: (id) => request(`/api/newsletter/${id}`),
    create: (payload) => request('/api/newsletter', { method: 'POST', body: payload }),
    update: (id, payload) => request(`/api/newsletter/${id}`, { method: 'PATCH', body: payload }),
    remove: (id) => request(`/api/newsletter/${id}`, { method: 'DELETE' }),
    sendTest: (id, to) => request(`/api/newsletter/${id}/send-test`, { method: 'POST', body: { to } }),
    send: (id, audience = 'all') => request(`/api/newsletter/${id}/send`, { method: 'POST', body: { audience } }),
    analytics: (id) => request(`/api/newsletter/${id}/analytics`),
    overview: () => request('/api/newsletter/analytics/overview'),
    welcome: {
      due: () => request('/api/newsletter/welcome/due'),
      preview: (key) => request(`/api/newsletter/welcome/preview/${key}`),
      run: () => request('/api/newsletter/welcome/run', { method: 'POST' }),
    },
    ai: {
      expandFromSocial: (payload) => request('/api/newsletter-ai/expand-from-social', { method: 'POST', body: payload }),
      extractSocial: (payload) => request('/api/newsletter-ai/extract-social', { method: 'POST', body: payload }),
      subjectLines: (payload) => request('/api/newsletter-ai/subject-lines', { method: 'POST', body: payload }),
    },
  },
  signupForms: {
    list: () => request('/api/signup/forms'),
    get: (id) => request(`/api/signup/forms/${id}`),
    create: (payload) => request('/api/signup/forms', { method: 'POST', body: payload }),
    update: (id, payload) => request(`/api/signup/forms/${id}`, { method: 'PATCH', body: payload }),
    remove: (id) => request(`/api/signup/forms/${id}`, { method: 'DELETE' }),
  },
  prospects: {
    list: (params = {}) => {
      const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
      return request(`/api/prospects${qs ? `?${qs}` : ''}`);
    },
    get: (id) => request(`/api/prospects/${id}`),
    facets: () => request('/api/prospects/facets'),
    stages: () => request('/api/prospects/stages/list'),
    create: (payload) => request('/api/prospects', { method: 'POST', body: payload }),
    update: (id, payload) => request(`/api/prospects/${id}`, { method: 'PATCH', body: payload }),
    remove: (id) => request(`/api/prospects/${id}`, { method: 'DELETE' }),
    move: (id, stage) => request(`/api/prospects/${id}/move`, { method: 'POST', body: { stage } }),
    import: (rows) => request('/api/prospects/import', { method: 'POST', body: { rows } }),
  },
  emailTemplates: {
    list: (params = {}) => {
      const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
      return request(`/api/email-templates${qs ? `?${qs}` : ''}`);
    },
    get: (id) => request(`/api/email-templates/${id}`),
    create: (payload) => request('/api/email-templates', { method: 'POST', body: payload }),
    update: (id, payload) => request(`/api/email-templates/${id}`, { method: 'PATCH', body: payload }),
    remove: (id) => request(`/api/email-templates/${id}`, { method: 'DELETE' }),
  },
  outreach: {
    aiPersonalize: (payload) => request('/api/outreach/ai-personalize', { method: 'POST', body: payload }),
    send: (payload) => request('/api/outreach/send', { method: 'POST', body: payload }),
    markReplied: (id, reply_text) => request(`/api/outreach/${id}/mark-replied`, { method: 'POST', body: { reply_text } }),
    dailyStats: () => request('/api/outreach/daily-stats'),
  },
  meetings: {
    list: (params = {}) => {
      const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
      return request(`/api/meetings${qs ? `?${qs}` : ''}`);
    },
    get: (id) => request(`/api/meetings/${id}`),
    create: (payload) => request('/api/meetings', { method: 'POST', body: payload }),
    update: (id, payload) => request(`/api/meetings/${id}`, { method: 'PATCH', body: payload }),
    complete: (id, payload) => request(`/api/meetings/${id}/complete`, { method: 'POST', body: payload }),
    remove: (id) => request(`/api/meetings/${id}`, { method: 'DELETE' }),
    outcomes: () => request('/api/meetings/outcomes/list'),
  },
  pipeline: {
    overview: () => request('/api/pipeline/overview'),
    analytics: () => request('/api/pipeline/analytics'),
    board: () => request('/api/pipeline/board'),
  },
  attribution: {
    contentRevenue: () => request('/api/attribution/content-revenue'),
    journey: (prospect_id) => request(`/api/attribution/journey/${prospect_id}`),
    hotProspects: () => request('/api/attribution/hot-prospects'),
    newsletterToProspect: (subscriber_id) => request('/api/attribution/newsletter-to-prospect', { method: 'POST', body: { subscriber_id } }),
    prospectToNewsletter: (prospect_id) => request('/api/attribution/prospect-to-newsletter', { method: 'POST', body: { prospect_id } }),
  },
  insights: {
    list: (status = 'active') => request(`/api/insights?status=${status}`),
    generate: () => request('/api/insights/generate', { method: 'POST' }),
    dismiss: (id) => request(`/api/insights/${id}/dismiss`, { method: 'POST' }),
  },
  unified: {
    scorecard: () => request('/api/unified/scorecard'),
    alerts: () => request('/api/unified/alerts'),
  },
  library: {
    list: (params = {}) => {
      const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
      return request(`/api/content${qs ? `?${qs}` : ''}`);
    },
    get: (id) => request(`/api/content/${id}`),
    update: (id, payload) => request(`/api/content/${id}`, { method: 'POST', body: payload }),
    remove: (id) => request(`/api/content/${id}`, { method: 'DELETE' }),
    rate: (id, performance) => request(`/api/content/${id}`, { method: 'POST', body: { performance } }),
    translateFr: (id) => request(`/api/content/${id}/translate-fr`, { method: 'POST' }),
    repurpose: (id, payload) => request(`/api/content/${id}/repurpose`, { method: 'POST', body: payload }),
    caption: (id, payload) => request(`/api/content/${id}/caption`, { method: 'POST', body: payload }),
    refine: (id, payload) => request(`/api/content/${id}/refine`, { method: 'POST', body: payload }),
    rigorCheck: (payload) => request('/api/content/rigor-check', { method: 'POST', body: payload }),
    facets: () => request('/api/content/facets'),
    topPerformers: (limit = 5) => request(`/api/content/top-performers?limit=${limit}`),
    export: () => downloadFile('/api/content/export', 'library-export.md'),
  },
  metrics: {
    list: (params = {}) => {
      const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
      return request(`/api/metrics${qs ? `?${qs}` : ''}`);
    },
    latest: () => request('/api/metrics/latest'),
    save: (payload) => request('/api/metrics', { method: 'POST', body: payload }),
    platforms: () => request('/api/metrics/platforms'),
    trends: () => request('/api/metrics/trends'),
    health: () => request('/api/metrics/health'),
  },
  outcomes: {
    list: (params = {}) => {
      const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
      return request(`/api/outcomes${qs ? `?${qs}` : ''}`);
    },
    summary: () => request('/api/outcomes/summary'),
    types: () => request('/api/outcomes/types'),
    create: (payload) => request('/api/outcomes', { method: 'POST', body: payload }),
    remove: (id) => request(`/api/outcomes/${id}`, { method: 'DELETE' }),
  },
  reviews: {
    list: () => request('/api/reviews'),
    get: (week_start) => request(`/api/reviews/${week_start}`),
    save: (week_start, payload) => request(`/api/reviews/${week_start}`, { method: 'PUT', body: payload }),
    summary: (week_start) => request(`/api/reviews/${week_start}/summary`),
  },
  briefings: {
    list: () => request('/api/briefings'),
    get: (id) => request(`/api/briefings/${id}`),
    generate: (payload) => request('/api/briefings/generate', { method: 'POST', body: payload }),
    runningState: () => request('/api/briefings/running-state'),
  },
  knowledge: {
    list: () => request('/api/knowledge'),
    get: (id) => request(`/api/knowledge/${id}`),
    create: (payload) => request('/api/knowledge', { method: 'POST', body: payload }),
    update: (id, payload) => request(`/api/knowledge/${id}`, { method: 'PATCH', body: payload }),
    remove: (id) => request(`/api/knowledge/${id}`, { method: 'DELETE' }),
    toggle: (ids, is_active) => request('/api/knowledge/toggle', { method: 'POST', body: { ids, is_active } }),
    export: () => downloadFile('/api/knowledge/export', 'knowledge-export.md'),
  },
  quickCapture: {
    classify: (text) => request('/api/quick-capture/classify', { method: 'POST', body: { text } }),
  },
  crisis: {
    assess: (situation) => request('/api/crisis/assess', { method: 'POST', body: { situation } }),
    saveDraft: (payload) => request('/api/crisis/save-draft', { method: 'POST', body: payload }),
  },
  voiceProfile: {
    get: () => request('/api/voice-profile'),
    save: (profile) => request('/api/voice-profile', { method: 'PUT', body: profile }),
    dimensions: () => request('/api/voice-profile/dimensions'),
    extractionPrompt: () => request('/api/voice-profile/extraction-prompt'),
    parseAiResponse: (text) => request('/api/voice-profile/parse-ai-response', { method: 'POST', body: { text } }),
    extractFromCorpus: (corpus, display_name) => request('/api/voice-profile/extract-from-corpus', {
      method: 'POST', body: { corpus, display_name },
    }),
    score: () => request('/api/voice-profile/score', { method: 'POST', body: {} }),
    reset: () => request('/api/voice-profile/reset', { method: 'POST', body: {} }),
    compliancePacks: () => request('/api/voice-profile/compliance-packs'),
    archetypes: () => request('/api/voice-profile/archetypes'),
    archetype: (id) => request(`/api/voice-profile/archetypes/${id}`),
    export: () => downloadFile('/api/voice-profile/export', 'voice-profile.json'),
    import: (payload) => request('/api/voice-profile/import', { method: 'POST', body: { payload } }),
  },
  health: () => request('/api/health'),
  uploads: {
    list: (params = {}) => {
      const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
      return request(`/api/uploads${qs ? `?${qs}` : ''}`);
    },
    tags: () => request('/api/uploads/tags'),
    upload: async (file, { tags = [], notes = '' } = {}) => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('tags', JSON.stringify(tags));
      if (notes) fd.append('notes', notes);
      const token = await getAccessToken().catch(() => null);
      const res = await fetch('/api/uploads', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      const text = await res.text();
      const data = text ? safeJson(text) : null;
      if (!res.ok) {
        const err = new Error((data && data.error) || `HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }
      return data;
    },
    patch: (id, payload) => request(`/api/uploads/${id}`, { method: 'PATCH', body: payload }),
    remove: (id) => request(`/api/uploads/${id}`, { method: 'DELETE' }),
  },
  carousels: {
    list: (params = {}) => {
      const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
      return request(`/api/carousels${qs ? `?${qs}` : ''}`);
    },
    get: (id) => request(`/api/carousels/${id}`),
    create: (payload) => request('/api/carousels', { method: 'POST', body: payload }),
    update: (id, payload) => request(`/api/carousels/${id}`, { method: 'PATCH', body: payload }),
    remove: (id) => request(`/api/carousels/${id}`, { method: 'DELETE' }),
    generate: (payload) => request('/api/carousels/generate', { method: 'POST', body: payload }),
    parse: (text) => request('/api/carousels/parse', { method: 'POST', body: { text } }),
  },
};

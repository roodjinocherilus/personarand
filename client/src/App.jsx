import { useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Sidebar from './components/Sidebar.jsx';
import Dashboard from './components/Dashboard.jsx';
import CalendarView from './components/Calendar/CalendarView.jsx';
import LibraryView from './components/Library/LibraryView.jsx';
import MetricsForm from './components/Metrics/MetricsForm.jsx';
import CarouselView from './components/Carousel/CarouselView.jsx';
import InspirationView from './components/Inspiration/InspirationView.jsx';
import ReviewView from './components/Review/ReviewView.jsx';
import BriefingView from './components/Briefing/BriefingView.jsx';
import KnowledgeView from './components/Knowledge/KnowledgeView.jsx';
import VoiceProfileView from './components/VoiceProfile/VoiceProfileView.jsx';
import QuickCaptureFAB from './components/QuickCapture/QuickCaptureFAB.jsx';
import CrisisView from './components/Crisis/CrisisView.jsx';
import ReplyAssistantView from './components/ReplyAssistant/ReplyAssistantView.jsx';
import NewsletterView from './components/Newsletter/NewsletterView.jsx';
import ProspectsView from './components/Prospects/ProspectsView.jsx';
import AttributionView from './components/Attribution/AttributionView.jsx';
import Login from './components/Login.jsx';
import { supabase, supabaseConfigured } from './lib/supabase.js';

export default function App() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [session, setSession] = useState(null);
  const [loadingAuth, setLoadingAuth] = useState(true);

  useEffect(() => {
    if (!supabaseConfigured) {
      // Supabase not configured — skip auth gate (dev mode without it).
      setLoadingAuth(false);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoadingAuth(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function signOut() {
    if (supabase) await supabase.auth.signOut();
  }

  if (loadingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg text-text-secondary">Loading…</div>
    );
  }

  // If Supabase is configured but no session, show login.
  if (supabaseConfigured && !session) {
    return <Login />;
  }

  return (
    <div className="flex min-h-screen bg-bg text-text-primary">
      <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} onSignOut={signOut} user={session?.user} />
      <main className="flex-1 min-w-0 overflow-x-hidden">
        <header className="mobile-header lg:hidden sticky top-0 z-20 flex items-center gap-3 px-4 pb-3 bg-card border-b border-border">
          <button onClick={() => setMobileOpen(true)} aria-label="Open navigation" className="p-2 -ml-2 rounded-md text-text-primary hover:bg-[#1f1f1f]">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <div className="text-sm font-semibold">Personal Brand</div>
        </header>
        <div className="max-w-content mx-auto px-4 md:px-8 py-6 md:py-8">
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/calendar" element={<CalendarView />} />
            <Route path="/carousels" element={<CarouselView />} />
            <Route path="/inspiration" element={<InspirationView />} />
            <Route path="/library" element={<LibraryView />} />
            <Route path="/newsletter" element={<NewsletterView />} />
            <Route path="/prospects" element={<ProspectsView />} />
            <Route path="/attribution" element={<AttributionView />} />
            <Route path="/briefing" element={<BriefingView />} />
            <Route path="/knowledge" element={<KnowledgeView />} />
            <Route path="/voice-profile" element={<VoiceProfileView />} />
            <Route path="/crisis" element={<CrisisView />} />
            <Route path="/reply-assistant" element={<ReplyAssistantView />} />
            <Route path="/review" element={<ReviewView />} />
            <Route path="/metrics" element={<MetricsForm />} />
          </Routes>
        </div>
      </main>
      {/* Floating quick-capture mic — global. Lets the operator dictate any
          thought from any page; Haiku classifies and routes to KB / Calendar
          / journal. The single biggest UX bet on solo-operator usage. */}
      <QuickCaptureFAB />
    </div>
  );
}

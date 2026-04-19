import { NavLink } from 'react-router-dom';

const NAV = [
  { to: '/dashboard', label: 'Dashboard', hint: 'Strategic overview' },
  { to: '/calendar', label: 'Calendar', hint: '30-day content plan' },
  { to: '/carousels', label: 'Carousels', hint: 'Multi-slide posts' },
  { to: '/inspiration', label: 'Inspiration', hint: 'Visual references' },
  { to: '/library', label: 'Library', hint: 'Generated content' },
  { to: '/newsletter', label: 'Newsletter', hint: 'Owned audience' },
  { to: '/prospects', label: 'Prospects', hint: 'Outbound pipeline' },
  { to: '/attribution', label: 'Attribution', hint: 'Revenue intelligence' },
  { to: '/review', label: 'Review', hint: 'Weekly reflection' },
  { to: '/metrics', label: 'Metrics', hint: 'Weekly performance' },
];

export default function Sidebar({ mobileOpen, onClose, onSignOut, user }) {
  return (
    <>
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 lg:hidden"
          onClick={onClose}
          aria-hidden
        />
      )}
      <aside
        className={`
          fixed inset-y-0 left-0 z-40 w-64 bg-card border-r border-border flex flex-col
          transition-transform duration-200
          lg:static lg:translate-x-0 lg:w-60 lg:min-h-screen
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
      >
        <div className="px-6 pt-7 pb-6 border-b border-border">
          <div className="text-[11px] uppercase tracking-widest text-text-secondary">Roodjino Chérilus</div>
          <div className="text-lg font-semibold mt-1 leading-tight">Personal Brand</div>
          <div className="text-[11px] text-text-secondary mt-1">Command center</div>
        </div>
        <nav className="flex-1 py-4 px-3 overflow-y-auto">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => onClose?.()}
              className={({ isActive }) =>
                `block px-3 py-2.5 rounded-md mb-1 transition-colors ${
                  isActive
                    ? 'bg-[#1f1f1f] border border-border text-text-primary'
                    : 'text-text-secondary hover:bg-[#1f1f1f] hover:text-text-primary'
                }`
              }
            >
              <div className="text-sm font-medium">{item.label}</div>
              <div className="text-[11px] text-text-secondary mt-0.5">{item.hint}</div>
            </NavLink>
          ))}
        </nav>
        <div className="px-6 py-5 border-t border-border text-[11px] text-text-secondary leading-relaxed">
          {user && (
            <div className="mb-3 pb-3 border-b border-border">
              <div className="truncate text-text-primary">{user.email}</div>
              {onSignOut && (
                <button onClick={onSignOut} className="text-text-secondary hover:text-text-primary mt-1 text-[10px] uppercase tracking-wider">
                  Sign out →
                </button>
              )}
            </div>
          )}
          <div className="uppercase tracking-wider mb-1">Discipline</div>
          <div>Presence over frequency. Proof over promotion.</div>
        </div>
      </aside>
    </>
  );
}

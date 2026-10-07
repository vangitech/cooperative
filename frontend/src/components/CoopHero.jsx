// Cooperative strength illustration: farmers, drivers, doctors, government
// workers, private workers and market women putting hands together into
// the MPCS contribution box. Pure SVG — scales to any screen, no assets.
export default function CoopHero({ className = '' }) {
  return (
    <svg
      viewBox="0 0 640 520"
      role="img"
      aria-label="People from different professions putting their hands together into a cooperative contribution box"
      className={className}
    >
      <defs>
        <pattern id="coop-plaid" width="18" height="18" patternUnits="userSpaceOnUse">
          <rect width="18" height="18" fill="#15803d" />
          <rect x="7" width="4" height="18" fill="#166534" />
          <rect y="7" width="18" height="4" fill="#166534" />
          <rect x="7" y="7" width="4" height="4" fill="#bbf7d0" />
        </pattern>
        <pattern id="coop-ankara" width="22" height="22" patternUnits="userSpaceOnUse">
          <rect width="22" height="22" fill="#7c3aed" />
          <circle cx="6" cy="6" r="3.4" fill="#f59e0b" />
          <circle cx="17" cy="17" r="3.4" fill="#f59e0b" />
          <circle cx="17" cy="6" r="1.6" fill="#fce7f3" />
          <circle cx="6" cy="17" r="1.6" fill="#fce7f3" />
        </pattern>
        <linearGradient id="coop-box" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#059669" />
          <stop offset="100%" stopColor="#065f46" />
        </linearGradient>
      </defs>

      {/* backdrop */}
      <circle cx="320" cy="252" r="212" fill="#ffffff" opacity="0.14" />
      <circle cx="320" cy="252" r="168" fill="#ffffff" opacity="0.10" />
      <ellipse cx="320" cy="470" rx="150" ry="18" fill="#064e3b" opacity="0.35" />

      {/* coins dropping in */}
      <g fill="#fbbf24" stroke="#b45309" strokeWidth="2">
        <ellipse cx="296" cy="238" rx="17" ry="17" />
        <ellipse cx="344" cy="222" rx="17" ry="17" />
        <ellipse cx="320" cy="196" rx="17" ry="17" />
      </g>
      <g stroke="#b45309" strokeWidth="2.5" opacity="0.7">
        <text x="296" y="245" textAnchor="middle" fontSize="18" fontWeight="bold" fill="none" strokeWidth="1.5">₦</text>
        <text x="344" y="229" textAnchor="middle" fontSize="18" fontWeight="bold" fill="none" strokeWidth="1.5">₦</text>
        <text x="320" y="203" textAnchor="middle" fontSize="18" fontWeight="bold" fill="none" strokeWidth="1.5">₦</text>
      </g>
      <g stroke="#ffffff" strokeWidth="3" strokeLinecap="round" opacity="0.5">
        <line x1="262" y1="200" x2="262" y2="222" />
        <line x1="378" y1="186" x2="378" y2="208" />
      </g>

      {/* contribution box */}
      <g>
        <polygon points="248,330 392,330 372,300 268,300" fill="#047857" />
        <rect x="268" y="300" width="104" height="12" rx="6" fill="#022c22" />
        <rect x="248" y="330" width="144" height="128" rx="10" fill="url(#coop-box)" />
        <rect x="248" y="330" width="144" height="128" rx="10" fill="none" stroke="#022c22" strokeWidth="3" opacity="0.4" />
        <text x="320" y="398" textAnchor="middle" fontSize="40" fontWeight="800" fill="#ffffff" letterSpacing="2">MPCS</text>
        <text x="320" y="424" textAnchor="middle" fontSize="14" fontWeight="600" fill="#a7f3d0">Together we grow</text>
      </g>

      {/* arms: sleeve (thick round line) + cuff + hand, converging on the box */}
      <g strokeLinecap="round">
        {/* farmer — green plaid, top left */}
        <line x1="58" y1="52" x2="238" y2="286" stroke="url(#coop-plaid)" strokeWidth="40" />
        <line x1="216" y1="258" x2="244" y2="292" stroke="#fefce8" strokeWidth="40" />
        <circle cx="262" cy="312" r="24" fill="#8d5524" stroke="none" />
        {/* doctor — white coat, top right */}
        <line x1="582" y1="52" x2="402" y2="286" stroke="#f8fafc" strokeWidth="40" />
        <line x1="396" y1="258" x2="424" y2="292" stroke="#0ea5e9" strokeWidth="40" />
        <circle cx="378" cy="312" r="24" fill="#f1c27d" stroke="none" />
        {/* driver — orange hi-vis, left */}
        <line x1="18" y1="252" x2="216" y2="368" stroke="#ea580c" strokeWidth="40" />
        <line x1="96" y1="298" x2="136" y2="320" stroke="#fef08a" strokeWidth="42" />
        <circle cx="240" cy="380" r="24" fill="#a0663a" stroke="none" />
        {/* government worker — grey suit, right */}
        <line x1="622" y1="252" x2="424" y2="368" stroke="#475569" strokeWidth="40" />
        <line x1="504" y1="320" x2="544" y2="342" stroke="#f8fafc" strokeWidth="40" />
        <circle cx="400" cy="380" r="24" fill="#c68642" stroke="none" />
        {/* private worker — blue shirt, bottom left */}
        <line x1="128" y1="508" x2="262" y2="448" stroke="#2563eb" strokeWidth="40" />
        <line x1="244" y1="472" x2="268" y2="458" stroke="#dbeafe" strokeWidth="40" />
        <circle cx="288" cy="440" r="24" fill="#6b4423" stroke="none" />
        {/* market woman — ankara, bottom right */}
        <line x1="512" y1="508" x2="378" y2="448" stroke="url(#coop-ankara)" strokeWidth="40" />
        <line x1="372" y1="472" x2="396" y2="458" stroke="#fbbf24" strokeWidth="40" />
        <circle cx="352" cy="440" r="24" fill="#e0ac69" stroke="none" />
      </g>
    </svg>
  );
}

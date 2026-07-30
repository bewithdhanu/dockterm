const ITEMS = [
  {
    id: 'hosts',
    label: 'Hosts',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path
          fill="currentColor"
          d="M4 4h16a1 1 0 0 1 1 1v4H3V5a1 1 0 0 1 1-1zm-1 7h18v3H3v-3zm0 5h18v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-3zm3-10.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5zm0 7a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5zm0 5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5z"
        />
      </svg>
    ),
  },
  {
    id: 'snippets',
    label: 'Snippets',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path
          fill="currentColor"
          d="M8.7 17.3 4.4 13l4.3-4.3 1.4 1.4L7.2 13l2.9 2.9-1.4 1.4zm6.6 0-1.4-1.4 2.9-2.9-2.9-2.9 1.4-1.4 4.3 4.3-4.3 4.3z"
        />
      </svg>
    ),
  },
  {
    id: 'history',
    label: 'History',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path
          fill="currentColor"
          d="M13 3a9 9 0 1 0 8.94 8H20a7 7 0 1 1-2.05-4.95L15 9h6V3l-2.12 2.12A8.96 8.96 0 0 0 13 3zm-1 5v5l4.2 2.5.8-1.3-3.5-2.1V8H12z"
        />
      </svg>
    ),
  },
  {
    id: 'config',
    label: 'Config',
    icon: (
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path
          fill="currentColor"
          d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.07 7.07 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 14.9 2h-3.8a.5.5 0 0 0-.49.42l-.36 2.54c-.59.24-1.13.55-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L3.71 8.48a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94L3.83 14.58a.5.5 0 0 0-.12.64l1.92 3.32c.14.24.43.34.68.22l2.39-.96c.5.39 1.04.71 1.63.94l.36 2.54c.05.24.25.42.49.42h3.8c.24 0 .44-.18.49-.42l.36-2.54c.59-.24 1.13-.55 1.63-.94l2.39.96c.25.12.54.02.68-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z"
        />
      </svg>
    ),
  },
];

export function NavRail({ active, onSelect }) {
  return (
    <nav className="nav-rail" aria-label="Main">
      {ITEMS.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`nav-rail-item ${active === item.id ? 'active' : ''}`}
          onClick={() => onSelect?.(item.id)}
          title={item.label}
        >
          <span className="nav-rail-icon">{item.icon}</span>
          <span className="nav-rail-label">{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

import {
  LuCode,
  LuHistory,
  LuServer,
  LuSettings,
} from 'react-icons/lu';

const ITEMS = [
  {
    id: 'hosts',
    label: 'Hosts',
    icon: <LuServer size={18} aria-hidden="true" />,
  },
  {
    id: 'snippets',
    label: 'Snippets',
    icon: <LuCode size={18} aria-hidden="true" />,
  },
  {
    id: 'history',
    label: 'History',
    icon: <LuHistory size={18} aria-hidden="true" />,
  },
  {
    id: 'config',
    label: 'Config',
    icon: <LuSettings size={18} aria-hidden="true" />,
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

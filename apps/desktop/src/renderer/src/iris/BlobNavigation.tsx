import { NavLink } from 'react-router-dom';

export const destinations = [
  {
    label: 'Live',
    path: '/live',
    color: 'blue',
    icon: 'M3 12h4l3-7 4 14 3-7h4',
  },
  {
    label: 'Timeline',
    path: '/timeline',
    color: 'lavender',
    icon: 'M5 5v14h14 M8 14l4-5 4 3 4-7',
  },
  {
    label: 'Patterns',
    path: '/patterns',
    color: 'peach',
    icon: 'M5 6h4v4H5z M15 6h4v4h-4z M5 16h4v4H5z M15 16h4v4h-4z',
  },
  {
    label: 'Ask Iris',
    path: '/ask-iris',
    color: 'mint',
    icon: 'M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4V6a2 2 0 0 1 1-2z M8 9h8 M8 13h5',
  },
  {
    label: 'Experiments',
    path: '/experiments',
    color: 'pink',
    icon: 'M9 3h6 M10 3v7l-5 8a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-8V3 M8 15h8',
  },
  {
    label: 'Settings',
    path: '/settings',
    color: 'sand',
    icon: 'M4 7h16 M4 17h16 M8 4v6 M16 14v6',
  },
] as const;

export function BlobNavigation({
  orbital = false,
  hidden = false,
}: {
  orbital?: boolean;
  hidden?: boolean;
}) {
  return (
    <nav
      className={orbital ? 'blob-orbit' : 'blob-navigation'}
      aria-label="Main navigation"
      hidden={hidden}
    >
      {destinations.map((item, index) => (
        <NavLink
          key={item.path}
          to={item.path}
          aria-label={item.label}
          className={`navigation-blob blob-${item.color} orbit-${index}`}
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d={item.icon} />
          </svg>
          <span>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./nav.module.css";

const LEFT = [
  { href: "/", label: "Bugün", icon: TodayIcon },
  { href: "/takvim", label: "Takvim", icon: CalendarIcon },
];

const RIGHT = [
  { href: "/ilerleme", label: "İlerleme", icon: ProgressIcon },
  { href: "/chat", label: "Sohbet", icon: ChatIcon },
];

export function BottomNav() {
  const pathname = usePathname();

  // The login screen is outside the app shell.
  if (pathname === "/login") return null;

  return (
    <nav className={styles.nav}>
      {LEFT.map((item) => (
        <NavItem key={item.href} {...item} active={pathname === item.href} />
      ))}

      {/* Center action: jump to chat with a fresh prompt to log something. */}
      <Link href="/chat" className={styles.fab} aria-label="Kayıt ekle">
        <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden>
          <path
            d="M12 5v14M5 12h14"
            stroke="#0b0b0b"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
        </svg>
      </Link>

      {RIGHT.map((item) => (
        <NavItem key={item.href} {...item} active={pathname === item.href} />
      ))}
    </nav>
  );
}

function NavItem({
  href,
  label,
  icon: Icon,
  active,
}: {
  href: string;
  label: string;
  icon: () => JSX.Element;
  active: boolean;
}) {
  return (
    <Link href={href} className={`${styles.item} ${active ? styles.active : ""}`}>
      <Icon />
      <span>{label}</span>
    </Link>
  );
}

/* Icons kept inline so the app ships no icon-font or external asset. */

function TodayIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden>
      <rect
        x="3"
        y="5"
        width="18"
        height="16"
        rx="3"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M3 10h18M8 3v4M16 3v4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ProgressIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden>
      <path
        d="M5 20V11M12 20V4M19 20v-6"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden>
      <path
        d="M20 12a7.5 7.5 0 0 1-10.9 6.7L4 20l1.3-4A7.5 7.5 0 1 1 20 12Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

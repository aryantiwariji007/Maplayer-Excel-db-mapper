"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Upload,
  BookOpen,
  Eye,
  BarChart3,
  Layers,
  Link2,
} from "lucide-react";

const navItems = [
  { href: "/upload", label: "Upload", icon: Upload, desc: "Ingest files" },
  { href: "/mapping", label: "Profiles", icon: BookOpen, desc: "Manage schemas" },
  { href: "/preview", label: "Preview", icon: Eye, desc: "Inspect data" },
  { href: "/analytics", label: "Analytics", icon: BarChart3, desc: "Query & metrics" },
  { href: "/compose", label: "Compose", icon: Link2, desc: "Cross-dataset views" },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: "linear-gradient(135deg, #a78bfa 0%, #60a5fa 100%)",
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
          }}>
            <Layers size={18} color="white" />
          </div>
          <h1>MapLayer</h1>
        </div>
        <p>Data Ingestion Platform</p>
      </div>

      <nav className="sidebar-nav">
        <div className="nav-label">Navigation</div>
        {navItems.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={`nav-item ${pathname === href || pathname.startsWith(href) ? "active" : ""}`}
          >
            <Icon size={17} />
            {label}
          </Link>
        ))}


      </nav>
    </aside>
  );
}

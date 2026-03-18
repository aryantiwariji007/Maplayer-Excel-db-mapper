"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Upload,
  GitBranch,
  Eye,
  BarChart3,
  Layers,
  Zap,
} from "lucide-react";

const navItems = [
  { href: "/upload", label: "Upload", icon: Upload, desc: "Ingest files" },
  { href: "/mapping", label: "Mapping", icon: GitBranch, desc: "Map columns" },
  { href: "/preview", label: "Preview", icon: Eye, desc: "Inspect data" },
  { href: "/analytics", label: "Analytics", icon: BarChart3, desc: "Query & metrics" },
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

        <div className="nav-label" style={{ marginTop: 16 }}>System</div>
        <div style={{ padding: "16px 12px", marginTop: "auto" }}>
          <div style={{
            background: "linear-gradient(135deg, rgba(167,139,250,0.1) 0%, rgba(96,165,250,0.1) 100%)",
            border: "1px solid rgba(167,139,250,0.2)",
            borderRadius: 12,
            padding: "14px",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <Zap size={14} color="#a78bfa" />
              <span style={{ fontSize: 12, fontWeight: 600, color: "#a78bfa" }}>AI-Powered</span>
            </div>
            <p style={{ fontSize: 11, color: "hsl(220 10% 55%)", lineHeight: 1.5 }}>
              Auto-maps columns using Gemini AI &amp; semantic similarity.
            </p>
          </div>
        </div>
      </nav>
    </aside>
  );
}

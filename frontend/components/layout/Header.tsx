"use client";
import { useAppStore } from "@/store/useAppStore";
import { useState } from "react";
import { Bell, ChevronDown, Settings, Package } from "lucide-react";

const PRODUCTS = ["default", "crm-prod", "ecommerce-v2", "analytics-core"];

interface HeaderProps {
  title: string;
  subtitle?: string;
}

export default function Header({ title, subtitle }: HeaderProps) {
  const { productId, setProductId } = useAppStore();
  const [open, setOpen] = useState(false);

  return (
    <div className="page-header">
      <div>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: "hsl(220 20% 96%)" }}>{title}</h2>
        {subtitle && (
          <p style={{ fontSize: 13, color: "hsl(220 10% 55%)", marginTop: 2 }}>{subtitle}</p>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {/* Product Selector */}
        <div style={{ position: "relative" }}>
          <button
            onClick={() => setOpen(!open)}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              background: "hsl(220 15% 12%)",
              border: "1px solid hsl(220 15% 22%)",
              borderRadius: 8, padding: "6px 12px",
              color: "hsl(220 20% 96%)", cursor: "pointer",
              fontSize: 13, fontWeight: 500,
            }}
          >
            <Package size={14} color="#a78bfa" />
            <span>{productId}</span>
            <ChevronDown size={13} />
          </button>
          {open && (
            <div style={{
              position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 50,
              background: "hsl(220 15% 8%)", border: "1px solid hsl(220 15% 18%)",
              borderRadius: 10, padding: 6, minWidth: 180, boxShadow: "0 20px 40px rgba(0,0,0,0.5)",
            }}>
              <div style={{ fontSize: 10, color: "hsl(220 10% 45%)", padding: "4px 8px 6px", textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 600 }}>
                Select Product
              </div>
              {PRODUCTS.map((p) => (
                <button
                  key={p}
                  onClick={() => { setProductId(p); setOpen(false); }}
                  style={{
                    display: "block", width: "100%", textAlign: "left",
                    padding: "8px 10px", borderRadius: 7, cursor: "pointer",
                    fontSize: 13, fontWeight: 500,
                    color: p === productId ? "#a78bfa" : "hsl(220 20% 80%)",
                    background: p === productId ? "rgba(167,139,250,0.1)" : "transparent",
                    border: "none",
                  }}
                >
                  {p}
                </button>
              ))}
              <div style={{ borderTop: "1px solid hsl(220 15% 16%)", margin: "6px 0 4px" }} />
              <input
                placeholder="Custom product ID…"
                style={{
                  width: "100%", background: "hsl(220 15% 12%)", border: "1px solid hsl(220 15% 20%)",
                  borderRadius: 6, padding: "6px 8px", color: "hsl(220 20% 90%)", fontSize: 12,
                  outline: "none",
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const val = (e.target as HTMLInputElement).value.trim();
                    if (val) { setProductId(val); setOpen(false); }
                  }
                }}
              />
            </div>
          )}
        </div>

        {/* Bell icon */}
        <button style={{
          background: "hsl(220 15% 12%)", border: "1px solid hsl(220 15% 22%)",
          borderRadius: 8, padding: "6px 10px", cursor: "pointer", color: "hsl(220 10% 55%)",
          display: "flex", alignItems: "center",
        }}>
          <Bell size={15} />
        </button>

        {/* Settings icon */}
        <button style={{
          background: "hsl(220 15% 12%)", border: "1px solid hsl(220 15% 22%)",
          borderRadius: 8, padding: "6px 10px", cursor: "pointer", color: "hsl(220 10% 55%)",
          display: "flex", alignItems: "center",
        }}>
          <Settings size={15} />
        </button>
      </div>
    </div>
  );
}

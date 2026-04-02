"use client";
import { useAppStore } from "@/store/useAppStore";
import { useState } from "react";
import { ChevronDown, Package, Plus } from "lucide-react";

const PRODUCTS = ["default", "crm-prod", "ecommerce-v2", "analytics-core"];

interface HeaderProps {
  title: string;
  subtitle?: string;
}

export default function Header({ title, subtitle }: HeaderProps) {
  const { productId, setProductId, productIds } = useAppStore();
  const [open, setOpen] = useState(false);
  const [showAddInput, setShowAddInput] = useState(false);

  const displayIds = Array.from(new Set([productId, ...productIds]));

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
        <div 
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => { setOpen(false); setShowAddInput(false); }}
          style={{ position: "relative" }}
         maplayer-product-selector="true">
          <button
            onClick={() => setOpen(!open)}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              background: "hsl(220 15% 12%)",
              border: "1px solid hsl(220 15% 22%)",
              borderRadius: 8, padding: "6px 12px",
              color: "hsl(220 20% 96%)", cursor: "pointer",
              fontSize: 13, fontWeight: 500,
              transition: "all 0.2s",
            }}
            className="hover-glow"
          >
            <Package size={14} color="#a78bfa" />
            <span style={{ maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {productId}
            </span>
            <ChevronDown size={13} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
          </button>
          
          {open && (
            <div style={{
              position: "absolute", top: "100%", right: 0, zIndex: 100,
              paddingTop: 8,
            }}>
              <div style={{
                background: "hsl(220 15% 8%)", border: "1px solid hsl(220 15% 18%)",
                borderRadius: 12, padding: "8px", minWidth: 220, boxShadow: "0 20px 50px rgba(0,0,0,0.6)",
                backdropFilter: "blur(10px)",
              }}>
                <div style={{ 
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "4px 8px 10px", borderBottom: "1px solid hsl(220 15% 14%)", marginBottom: 6
                }}>
                  <span style={{ fontSize: 10, color: "hsl(220 10% 45%)", textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 700 }}>
                    Project context
                  </span>
                  <button 
                    onClick={() => setShowAddInput(!showAddInput)}
                    style={{ 
                      background: showAddInput ? "rgba(167,139,250,0.2)" : "rgba(255,255,255,0.05)",
                      border: "none", borderRadius: 4, padding: 4, cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      transition: "all 0.2s"
                    }}
                  >
                    <Plus size={12} color={showAddInput ? "#a78bfa" : "hsl(220 10% 60%)"} />
                  </button>
                </div>

                <div style={{ maxHeight: 240, overflowY: "auto", paddingRight: 4 }} className="custom-scrollbar">
                  {displayIds.map((p) => (
                    <button
                      key={p}
                      onClick={() => { setProductId(p); setOpen(false); }}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        width: "100%", textAlign: "left",
                        padding: "8px 10px", borderRadius: 8, cursor: "pointer",
                        fontSize: 13, fontWeight: 500,
                        color: p === productId ? "#a78bfa" : "hsl(220 20% 80%)",
                        background: p === productId ? "rgba(167,139,250,0.08)" : "transparent",
                        border: "none", marginBottom: 2,
                        transition: "all 0.15s",
                      }}
                      className="menu-item-hover"
                    >
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p}</span>
                      {p === productId && <div style={{ width: 4, height: 4, borderRadius: "50%", background: "#a78bfa" }} />}
                    </button>
                  ))}
                </div>

                {showAddInput && (
                  <div style={{ 
                    marginTop: 8, padding: "8px 4px 4px", borderTop: "1px solid hsl(220 15% 14%)",
                    animation: "fadeIn 0.2s ease-out"
                  }}>
                    <input
                      autoFocus
                      placeholder="Enter product ID..."
                      style={{
                        width: "100%", background: "hsl(220 15% 10%)", border: "1px solid hsl(220 15% 20%)",
                        borderRadius: 8, padding: "8px 12px", color: "hsl(220 20% 95%)", fontSize: 13,
                        outline: "none", boxShadow: "inset 0 2px 4px rgba(0,0,0,0.2)"
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          const val = (e.currentTarget).value.trim();
                          if (val) {
                            setProductId(val);
                            (e.currentTarget).value = "";
                            setOpen(false);
                            setShowAddInput(false);
                          }
                        }
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

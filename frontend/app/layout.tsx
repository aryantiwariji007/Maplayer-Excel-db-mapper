import type { Metadata } from "next";
import "./globals.css";
import Sidebar from "@/components/layout/Sidebar";
import { Toaster } from "sonner";
import Providers from "./providers";

export const metadata: Metadata = {
  title: "MapLayer — AI Data Ingestion Platform",
  description:
    "MapLayer helps you ingest, map, and analyze data from multiple sources with AI-powered column mapping.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body>
        <Providers>
          <div className="main-layout">
            <Sidebar />
            <div className="main-content">{children}</div>
          </div>
          <Toaster
            position="bottom-right"
            theme="dark"
            richColors
            toastOptions={{
              style: {
                background: "hsl(220 15% 8%)",
                border: "1px solid hsl(220 15% 18%)",
                color: "hsl(220 20% 96%)",
              },
            }}
          />
        </Providers>
      </body>
    </html>
  );
}

# MapLayer UI Design System & Tech Stack

This document outlines the design philosophy, tech stack, and "prompt patterns" used to create the MapLayer interface. Feel free to use this as a template for your future high-end web applications.

## 🚀 The Tech Stack

| Layer | Technology |
|---|---|
| **Framework** | [Next.js 14+](https://nextjs.org/) (App Router) |
| **Language** | [TypeScript](https://www.typescript.org/) |
| **Styling** | [Tailwind CSS](https://tailwindcss.com/) + Custom Vanilla CSS Variables |
| **Icons** | [Lucide React](https://lucide.dev/) |
| **Data Fetching** | [TanStack Query](https://tanstack.com/query/latest) (React Query) |
| **State Management** | [Zustand](https://github.com/pmndrs/zustand) |
| **Notifications** | [Sonner](https://sonner.stevenly.me/) |
| **Components** | Radix UI (Primitives) |

---

## 🎨 Design Aesthetics: "Premium Dark Agentic"

The UI follows a modern **Glassmorphic Dark Mode** aesthetic common in high-end AI tools (like Linear, Vercel, or OpenAI).

### Key Visual Tokens (from `globals.css`)
- **Background**: `hsl(0 0% 4%)` — Deep near-black.
- **Surface**: `hsl(220 15% 8%)` — Slightly lighter gray for cards.
- **Accents**: 
  - `Primary`: `#a78bfa` (Violet-400)
  - `Secondary`: `#60a5fa` (Blue-400)
- **Glassmorphism**: `backdrop-filter: blur(10px)` with `rgba` border transparency.
- **Gradients**: `linear-gradient(135deg, #a78bfa 0%, #60a5fa 100%)` used for logos and primary buttons.

---

## 🤖 The Prompt Pattern

To generate a UI like this using Antigravity (or any advanced AI), use the following prompt structure:

### 1. The "Atmosphere" Prompt
> *"Create a premium, state-of-the- art web application using Next.js and TypeScript. Use a deep dark mode palette (near black background, not pure black). Implement a glassmorphism design system with subtle borders (`1px solid hsl(var(--border))`), backdrop blurs, and vibrant violet-to-blue gradients for primary accents. Avoid generic UI kits; build a custom, high-density layout that feels like a professional engineering tool."*

### 2. The "Layout" Prompt
> *"Use a fixed-height main layout with a persistent sidebar (240px) and a scrollable main content area. Use a 'Card-Glass' container for all main panels. Header should show current page breadcrumbs and subtitle in a muted color. Typography should be Inter, using high contrast for titles and low contrast (muted foreground) for meta-information."*

### 3. The "Interaction" Prompt
> *"Implement smooth micro-animations for hover states using `transition: all 0.15s ease`. Primary buttons should have a subtle glow or pulse when active. Use a custom thin scrollbar that matches the dark theme."*

---

## 🛠️ Implementation Tips

1. **Use CSS Variables**: Don't hardcode colors. Define `--background`, `--primary`, etc., in `:root` so you can swap themes instantly.
2. **Icon Consistency**: Always use a consistent stroke width (e.g., `size={18}` and `strokeWidth={2}`) for all icons to maintain a cohesive look.
3. **Muted Hierarchy**: Use `text-transform: uppercase` and `letter-spacing: 0.5px` with a `muted-foreground` color for labels. It makes the UI look more industrial and professional.
4. **Spacing**: Use consistent logical gaps (e.g., `gap: 12px` or `20px`) and never let elements touch the edge of the viewport (`padding: 28px`).

---

*“Design is not just what it looks like and feels like. Design is how it works.” — MapLayer UI Philosophy*

# MapLayer v1.0

MapLayer is a production-ready **Dynamic Schema Ingestion & Mapping Platform**. It acts as an AI-powered middleware layer that allows SaaS products to ingest arbitrary tabular data (CSV / Excel / ZIP), auto-infer schemas, semantically map source columns to unified target structures, and expose a SQL-queryable analytics layer — all without writing schema migrations.

---

## Table of Contents

1. [Key Features](#key-features)
2. [Architecture Overview](#architecture-overview)
3. [Tech Stack](#tech-stack)
4. [Prerequisites](#prerequisites)
5. [Quick Start — Docker Compose (Recommended)](#quick-start--docker-compose-recommended)
6. [Manual Local Setup](#manual-local-setup)
7. [Environment Variables Reference](#environment-variables-reference)
8. [Frontend Setup](#frontend-setup)
9. [Running Tests](#running-tests)
10. [Deployment — Railway + Vercel](#deployment--railway--vercel)
11. [API Overview](#api-overview)
12. [Project Structure](#project-structure)

---

## Key Features

| Feature | Description |
|---|---|
| **AI-Powered Mapping** | Semantically matches uploaded file headers to target schemas using local sentence embeddings + Gemini AI |
| **Dynamic Ingestion** | Ingest any CSV/Excel file — MapLayer auto-infers data types and creates physical PostgreSQL tables on the fly |
| **Bulk & ZIP Upload** | Upload a ZIP archive or multiple files at once; a Celery background worker processes each file asynchronously |
| **Schema Evolution** | Materializes data into unified "Logical Datasets," automatically handling added/changed columns over time |
| **Correction Memory** | Remembers manual mapping corrections per product to improve future AI suggestions |
| **Analytics Layer** | Securely run SQL `SELECT` queries and define reusable semantic metrics over ingested data |
| **Composite Views** | Define cross-dataset JOINs and query them as a single unified view |
| **AI Metric Discovery** | Gemini AI analyses column names + sample data and suggests business metrics automatically |

---

## Architecture Overview

```
Browser (Next.js 16)
        │
        │  HTTP / REST
        ▼
FastAPI API Server  ──────────────────► PostgreSQL 15
        │                               (datasets, schemas, metrics, jobs)
        │
        ├── Qdrant (vector search)      schema embedding lookup
        │
        └── Redis ──► Celery Worker     async bulk-upload processing
                          │
                      Gemini API        AI column mapping + metric discovery
```

**Upload flow (bulk):**
1. `POST /ingest/upload-bulk` receives files → saves to `storage/temp_uploads/{job_id}/`
2. API returns `{ job_id }` immediately (non-blocking)
3. Celery worker picks up the job, extracts ZIPs, ingests each file, updates job status
4. Frontend polls `GET /ingest/jobs/{job_id}` until `status = COMPLETED`

---

## Tech Stack

| Layer | Technology |
|---|---|
| API | Python 3.10+, FastAPI, Uvicorn |
| ORM | SQLAlchemy 2.0 |
| Database | PostgreSQL 15 |
| Vector Search | Qdrant |
| AI / LLM | Google Gemini (`gemini-1.5-flash`) |
| Embeddings | `sentence-transformers/all-MiniLM-L6-v2` |
| Fuzzy Matching | RapidFuzz |
| Data Processing | Pandas, OpenPyXL, xlrd |
| Async Tasks | Celery 5 + Redis 7 |
| Task Monitor | Flower |
| Frontend | Next.js 16, TypeScript, Tailwind CSS, Shadcn UI |
| State Management | Zustand |
| Containerisation | Docker & Docker Compose |

---

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (for Docker Compose setup)
- [Python 3.10+](https://www.python.org/downloads/) (for manual setup only)
- [Node.js 18+](https://nodejs.org/) (for manual frontend setup only)
- A [Google Gemini API key](https://aistudio.google.com/app/apikey)

---

## Quick Start — Docker Compose (Recommended)

This starts every service (PostgreSQL, Qdrant, Redis, API, Celery worker, Flower, Frontend) with one command.

### 1. Clone the repository

```bash
git clone https://github.com/your-org/maplayer.git
cd maplayer
```

### 2. Create the environment file

```bash
cp .env.example .env
```

Open `.env` and fill in your values:

```env
GEMINI_API_KEY=your_gemini_api_key_here
POSTGRES_USER=maplayer
POSTGRES_PASSWORD=maplayer_password
POSTGRES_DB=maplayer_db
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
REDIS_URL=redis://redis:6379/0
QDRANT_HOST=qdrant
QDRANT_PORT=6333
```

> **Note:** When running inside Docker Compose, use the service names (`postgres`, `redis`, `qdrant`) as hostnames — not `localhost`.

### 3. Build and start all services

```bash
docker-compose up --build
```

The first build downloads and compiles PyTorch (CPU wheel) and sentence-transformers — this can take 5–10 minutes. Subsequent starts are fast.

### 4. Verify services are up

| Service | URL |
|---|---|
| **API** | http://localhost:8000 |
| **API Docs (Swagger)** | http://localhost:8000/docs |
| **API Docs (ReDoc)** | http://localhost:8000/redoc |
| **Frontend** | http://localhost:3000 |
| **Flower (Celery monitor)** | http://localhost:5555 |
| **Qdrant dashboard** | http://localhost:6333/dashboard |

### 5. Health check

```bash
curl http://localhost:8000/health
# → {"status":"ok","service":"MapLayer","version":"3.0"}
```

### Stopping services

```bash
docker-compose down          # stop, keep data volumes
docker-compose down -v       # stop and DELETE all data volumes
```

---

## Manual Local Setup

Use this if you want to run the API directly on your machine (useful for development with hot-reload).

### 1. Start infrastructure services only

```bash
docker-compose up -d postgres qdrant redis
```

### 2. Create a Python virtual environment

```bash
python -m venv venv

# Windows
.\venv\Scripts\activate

# Linux / macOS
source venv/bin/activate
```

### 3. Install Python dependencies

```bash
pip install -r requirements.txt
```

> Installing `torch` and `sentence-transformers` may take several minutes the first time.

### 4. Create `.env` in the project root

```env
GEMINI_API_KEY=your_gemini_api_key_here
POSTGRES_USER=maplayer
POSTGRES_PASSWORD=maplayer_password
POSTGRES_DB=maplayer_db
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
REDIS_URL=redis://localhost:6379/0
QDRANT_HOST=localhost
QDRANT_PORT=6333
```

### 5. Start the API server

```bash
uvicorn src.main:app --host 0.0.0.0 --port 8000 --reload
```

### 6. Start the Celery worker (separate terminal)

```bash
celery -A src.celery_app worker --loglevel=info --concurrency=4
```

The API is now available at `http://localhost:8000`.

---

## Environment Variables Reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `GEMINI_API_KEY` | Yes | — | Google Gemini API key for AI mapping and metric discovery |
| `POSTGRES_USER` | Yes | `maplayer` | PostgreSQL username |
| `POSTGRES_PASSWORD` | Yes | — | PostgreSQL password |
| `POSTGRES_DB` | Yes | `maplayer_db` | PostgreSQL database name |
| `POSTGRES_HOST` | Yes | `localhost` | PostgreSQL host (`postgres` inside Docker) |
| `POSTGRES_PORT` | No | `5432` | PostgreSQL port |
| `REDIS_URL` | Yes | `redis://localhost:6379/0` | Redis connection URL for Celery |
| `QDRANT_HOST` | Yes | `localhost` | Qdrant host (`qdrant` inside Docker) |
| `QDRANT_PORT` | No | `6333` | Qdrant HTTP port |
| `FRONTEND_URL` | No | — | Production frontend URL added to CORS allowed origins (e.g. `https://myapp.vercel.app`) |
| `NEXT_PUBLIC_API_URL` | Frontend | `http://localhost:8000` | Backend base URL used by the Next.js frontend |

---

## Frontend Setup

The frontend is a Next.js 16 app located in `frontend/`.

### Running inside Docker (default)

The `frontend` service in `docker-compose.yml` handles this automatically. No extra steps needed.

### Running locally (development)

```bash
cd frontend
npm install
```

Create `frontend/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

```bash
npm run dev
```

Frontend is available at `http://localhost:3000`.

### Frontend pages

| Route | Description |
|---|---|
| `/` | Dashboard — overview of uploaded datasets |
| `/upload` | File upload (single file, folder, or ZIP) |
| `/mapping` | Schema mapping review and confirmation |
| `/preview` | Preview ingested data and remapped columns |
| `/analytics` | SQL query builder and metric management |
| `/compose` | Composite view builder (cross-dataset JOINs) |

---

## Running Tests

The test suite uses `pytest` with `fastapi.testclient.TestClient` against a live PostgreSQL database (no SQLite shim). Run tests inside Docker.

### Inside Docker

```bash
# Start services first
docker-compose up -d postgres qdrant redis api

# Run the full test suite
docker-compose exec api pytest tests/ -v
```

### With coverage

```bash
docker-compose exec api pytest tests/ -v --tb=short --cov=src --cov-report=term-missing
```

### Test layout

```
tests/
└── test_api/
    ├── conftest.py          # shared fixtures, test isolation setup
    ├── test_system.py       # /health, /diag
    ├── test_schemas.py      # /schemas CRUD
    ├── test_ingest.py       # /ingest all endpoints
    ├── test_mapping.py      # /map all endpoints
    ├── test_analytics.py    # /analytics all endpoints
    └── test_composite.py    # /composite all endpoints
```

All tests use `product_id = "test-pytest-suite"` for data isolation. Test data is cleaned up automatically at the end of each test session.

---

## Deployment — Railway + Vercel

MapLayer is designed to deploy the backend on **Railway** and the frontend on **Vercel**.

### Step 1 — Deploy the backend on Railway

1. Create a new Railway project and connect your GitHub repository.
2. Railway auto-detects `railway.toml` and uses:
   ```
   uvicorn src.main:app --host 0.0.0.0 --port $PORT
   ```
3. Add the following environment variables in the Railway dashboard:

   | Variable | Value |
   |---|---|
   | `GEMINI_API_KEY` | Your Gemini key |
   | `POSTGRES_HOST` | Railway Postgres internal hostname |
   | `POSTGRES_USER` | From Railway Postgres plugin |
   | `POSTGRES_PASSWORD` | From Railway Postgres plugin |
   | `POSTGRES_DB` | From Railway Postgres plugin |
   | `REDIS_URL` | From Railway Redis plugin |
   | `QDRANT_HOST` | Your Qdrant Cloud or self-hosted host |
   | `QDRANT_PORT` | `6333` |

4. Deploy. Note the public URL (e.g. `https://maplayer-api.up.railway.app`).

### Step 2 — Deploy the frontend on Vercel

1. Import the `frontend/` directory on Vercel (set the root directory to `frontend`).
2. Add this environment variable:

   | Variable | Value |
   |---|---|
   | `NEXT_PUBLIC_API_URL` | Your Railway backend URL |

3. Deploy. Note the production URL (e.g. `https://maplayer.vercel.app`).

### Step 3 — Wire CORS back to Railway

Add this variable in the Railway dashboard so the API allows your Vercel frontend:

| Variable | Value |
|---|---|
| `FRONTEND_URL` | `https://maplayer.vercel.app` |

Redeploy the Railway service. All Vercel preview deployments (`*.vercel.app`) are also automatically allowed via `allow_origin_regex`.

---

## API Overview

Base URL: `http://localhost:8000` (local) or your Railway URL (production).

| Tag | Prefix | Description |
|---|---|---|
| System | `/health`, `/diag` | Health checks and diagnostics |
| Schemas | `/schemas` | Manage target schema definitions |
| Mapping | `/map` | AI-powered file → schema mapping |
| Ingest | `/ingest` | File upload, dataset registry, logical datasets |
| Analytics | `/analytics` | SQL queries, previews, and semantic metrics |
| Composite | `/composite` | Cross-dataset JOIN views |

Interactive documentation is available at:
- **Swagger UI**: `http://localhost:8000/docs`
- **ReDoc**: `http://localhost:8000/redoc`

See [API_DOCUMENTATION.md](API_DOCUMENTATION.md) for the complete endpoint reference.

---

## Project Structure

```
maplayer/
├── src/                          # Backend Python source
│   ├── main.py                   # FastAPI app, CORS, router registration
│   ├── database.py               # SQLAlchemy engine and session
│   ├── models.py                 # ORM models (Dataset, Schema, Metric, …)
│   ├── schemas.py                # Pydantic request/response models
│   ├── celery_app.py             # Celery app + ingestion task definition
│   ├── routers/
│   │   ├── schemas.py            # /schemas endpoints
│   │   ├── map_endpoint.py       # /map endpoints
│   │   ├── ingest.py             # /ingest endpoints
│   │   ├── analytics.py          # /analytics endpoints
│   │   └── composite_views.py    # /composite endpoints
│   └── services/
│       ├── data_processor.py     # CSV/Excel parsing
│       ├── schema_inference.py   # Column type inference
│       ├── mapper.py             # Scoring engine
│       ├── similarity.py         # Fuzzy + semantic similarity
│       ├── embedding.py          # Sentence transformer wrapper
│       ├── qdrant_service.py     # Qdrant operations
│       ├── gemini.py             # Gemini API calls
│       ├── dataset_store.py      # Dynamic table operations
│       ├── materialization.py    # Logical dataset materialisation
│       ├── corrections.py        # Correction memory
│       ├── schema_resolver.py    # Unified schema resolution
│       └── profiler.py           # Column profiling
│
├── frontend/                     # Next.js 16 TypeScript frontend
│   ├── app/                      # App Router pages
│   ├── components/               # UI components (Shadcn + custom)
│   ├── lib/
│   │   └── api.ts                # Axios API client
│   ├── store/
│   │   └── useAppStore.ts        # Zustand global state
│   └── types/index.ts            # TypeScript type definitions
│
├── tests/
│   └── test_api/                 # pytest test suite (120 tests)
│
├── docker-compose.yml            # Full-stack orchestration
├── backend.Dockerfile            # Python API container
├── frontend/Dockerfile           # Next.js frontend container
├── railway.toml                  # Railway deploy config
├── requirements.txt              # Python dependencies
└── .env.example                  # Environment variable template
```

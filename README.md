# MapLayer v3.0

MapLayer is a production-ready **Dynamic Schema Ingestion & Mapping Platform**. It acts as an AI-powered layer that allows SaaS products to ingest arbitrary tabular data (CSV/Excel), auto-infer schemas, and semantically map source columns to unified target structures.

Built with **FastAPI**, **PostgreSQL**, and **Qdrant**, it utilizes the **Gemini API** for intelligent column matching and can "learn" from user corrections over time.

## 🚀 Key Features
- **AI-Powered Mapping**: Semantically matches uploaded headers to target schemas using local embeddings and Gemini AI.
- **Dynamic Ingestion**: Ingest any file; the platform auto-infers data types and creates physical PostgreSQL tables on the fly.
- **Schema Evolution**: Materializes data into unified "Logical Datasets," handling schema changes automatically.
- **Analytics Layer**: Securely run SQL queries and define semantic metrics over ingested data.
- **Correction Memory**: Remembers manual mapping corrections to improve future AI suggestions for specific products.

## 🛠 Tech Stack
- **Backend**: Python 3.10+ (FastAPI)
- **Database**: PostgreSQL (Via SQLAlchemy)
- **Vector Search**: Qdrant (For semantic column matching)
- **AI/LLM**: Gemini API (`google-generativeai`)
- **Data Processing**: Pandas, RapidFuzz, Sentence Transformers (`all-MiniLM-L6-v2`)
- **Infrastructure**: Docker & Docker Compose

---

## ⚙️ Setup Instructions

### 1. Prerequisites
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- [Python 3.10+](https://www.python.org/downloads/)

### 2. Infrastructure (Docker)
Start the PostgreSQL and Qdrant services:
```bash
docker-compose up -d
```

### 3. Environment Variables
Create a `.env` file in the root directory:
```env
PORT=3000
GEMINI_API_KEY=your_gemini_api_key_here
# Postgres settings (Matching docker-compose defaults)
POSTGRES_USER=maplayer
POSTGRES_PASSWORD=maplayer_password
POSTGRES_DB=maplayer_db
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
```

### 4. Install Dependencies
```bash
# Recommendation: Use a virtual environment
python -m venv venv
.\venv\Scripts\activate  # Windows
source venv/bin/activate # Linux/Mac

pip install -r requirements.txt
```

### 5. Start the Server
```bash
python -m src.main
```
The API will be available at `http://localhost:3000`.

---

## 📖 API Documentation

### Interactive Docs
- **Swagger UI**: [http://localhost:3000/docs](http://localhost:3000/docs)
- **Redoc**: [http://localhost:3000/redoc](http://localhost:3000/redoc)

### Core Modules

#### 1. Schema Management (`/schemas`)
Register target schemas that you want incoming data to map towards.
- `POST /schemas/`: Create a new target schema with defined column types, aliases, and hints.
- `GET /schemas/`: List registered schemas for a product.

#### 2. Mapping Engine (`/map`)
AI-driven matching between file headers and target schemas.
- `POST /map/`: Upload a file to get suggested mappings for a specific schema or auto-detect the best one.
- `POST /map/confirm`: Record a manual correction (improves AI accuracy over time).
- `POST /map/auto-transform`: Directly get back transformed JSON data from an upload.

#### 3. Data Ingestion (`/ingest`)
The "No-Code" backend for data storage.
- `POST /ingest/upload`: Upload ANY CSV/Excel. MapLayer creates a table and stores it.
- `POST /ingest/dataset/map`: Map a physical dataset to a **Logical Dataset** (Unified View).

#### 4. Analytics (`/analytics`)
Querying and Metrics.
- `POST /analytics/query`: Execute SELECT queries (scoped to product tables).
- `POST /analytics/metrics`: Define a reusable SQL metric (e.g., "Total Revenue").
- `GET /analytics/datasets/{id}/preview`: Preview raw or logical data.

---

## 🔍 Diagnostics
Check if all libraries (Pandas, Multipart, etc.) are correctly installed and connected:
```bash
curl http://localhost:3000/diag
```


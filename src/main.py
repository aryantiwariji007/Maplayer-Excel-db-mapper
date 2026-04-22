from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from src.database import init_db
from src.services.qdrant_service import init_qdrant
from src.routers import schemas, map_endpoint, ingest, analytics, composite_views, pdf_extract
import uvicorn
from dotenv import load_dotenv
import os

load_dotenv()

app = FastAPI(title="MapLayer API", version="1.0")

ALLOWED_ORIGINS = [
    o.strip() for o in os.getenv(
        "ALLOWED_ORIGINS",
        "http://localhost:3000,http://localhost:3001,https://backend-production-b6f9.up.railway.app,https://maplayer.maint-lab.world"
    ).split(",")
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
def on_startup():
    init_db()
    init_qdrant()

@app.get("/diag")
def diagnostics():
    try:
        import multipart
        multipart_status = "installed"
    except ImportError:
        multipart_status = "MISSING"
    
    import pandas
    return {
        "status": "ok",
        "multipart_library": multipart_status,
        "pandas_version": pandas.__version__,
        "version": "3.0.1"
    }

@app.get("/health")
def health_check():
    return {"status": "ok", "service": "MapLayer", "version": "3.0"}

app.include_router(schemas.router, prefix="/schemas", tags=["Schemas"])
app.include_router(map_endpoint.router, prefix="/map", tags=["Mapping"])
app.include_router(ingest.router, prefix="/ingest", tags=["Ingest"])
app.include_router(analytics.router, prefix="/analytics", tags=["Analytics"])
app.include_router(composite_views.router, prefix="/composite", tags=["Composite Views"])
app.include_router(pdf_extract.router, prefix="/pdf", tags=["PDF Extraction"])

if __name__ == "__main__":
    uvicorn.run("src.main:app", host="0.0.0.0", port=8001, reload=True)

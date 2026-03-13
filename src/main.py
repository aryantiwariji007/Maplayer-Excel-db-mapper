from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .database import init_db
from .services.qdrant_service import init_qdrant
from .routers import schemas, map_endpoint, ingest, analytics
import uvicorn

app = FastAPI(title="MapLayer API", version="3.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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

if __name__ == "__main__":
    uvicorn.run("src.main:app", host="0.0.0.0", port=3000, reload=True)

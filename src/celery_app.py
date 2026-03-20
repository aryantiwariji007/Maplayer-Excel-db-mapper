import os
from celery import Celery
from sqlalchemy.orm import Session
from .database import SessionLocal
from .models import UploadJob
from .utils.json_utils import sanitize_nans

# Configure Celery with Redis as broker and result backend
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

app = Celery(
    "maplayer",
    broker=REDIS_URL,
    backend=REDIS_URL,
    include=["src.celery_app"]
)

app.conf.update(
    task_track_started=True,
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
)

@app.task(bind=True)
def process_ingestion_job(self, job_id: str, product_id: str, auto_map: bool, logical_dataset_name: str = None):
    """
    Background task to process a batch of files.
    - Updates UploadJob.status
    - Iterates through the files (which are stored in a temporary folder based on job_id)
    - Updates UploadJob.processed_files / total_files for progress
    - Updates results in UploadJob
    """
    db: Session = SessionLocal()
    job = db.query(UploadJob).filter(UploadJob.id == job_id).first()
    if not job:
        return {"error": "Job not found"}

    try:
        job.status = "PROCESSING"
        db.commit()

        # Import the heavy logic here to avoid circular imports during startup
        from .services.ingestion_service import run_bulk_ingestion_workflow
        
        # Temp directory where FastAPI saved the files
        temp_dir = os.path.join("storage", "temp_uploads", job_id)
        
        results = run_bulk_ingestion_workflow(
            db=db,
            job=job,
            temp_dir=temp_dir,
            product_id=product_id,
            auto_map=auto_map,
            logical_dataset_name=logical_dataset_name
        )

        job.status = "COMPLETED"
        job.results = sanitize_nans(results)
        db.commit()
        return {"status": "success", "results": results}

    except Exception as e:
        import traceback
        error_info = traceback.format_exc()
        print(f"CELERY JOB ERROR: {e}\n{error_info}")
        job.status = "FAILED"
        job.error_message = str(e)
        db.commit()
        return {"status": "error", "message": str(e)}
    finally:
        db.close()
        # Clean up temp files
        import shutil
        temp_dir = os.path.join("storage", "temp_uploads", job_id)
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)

import os
from celery import Celery
from sqlalchemy.orm import Session
from .database import SessionLocal
from .models import UploadJob
from .utils.json_utils import sanitize_nans
from celery import chord
import os

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
    Dispatcher task:
    1. Expands all files (including Zips).
    2. Saves them to a temporary 'processed' folder.
    3. Spawns parallel sub-tasks for each file.
    """
    db: Session = SessionLocal()
    job = db.query(UploadJob).filter(UploadJob.id == job_id).first()
    if not job:
        db.close()
        return {"error": "Job not found"}

    try:
        job.status = "PROCESSING"
        db.commit()

        from .services.ingestion_service import prepare_ingestion_items
        temp_dir = os.path.join("storage", "temp_uploads", job_id)
        processed_dir = os.path.join(temp_dir, "processed")
        os.makedirs(processed_dir, exist_ok=True)

        items = prepare_ingestion_items(temp_dir)
        if not items:
            job.status = "COMPLETED"
            job.results = []
            db.commit()
            return {"status": "success", "results": []}

        # Update total count
        job.total_files = len(items)
        db.commit()

        # Save extracted items to disk for parallel workers to read (avoids large broker payloads)
        task_items = []
        for i, item in enumerate(items):
            safe_name = f"item_{i}_{item['filename']}"
            item_path = os.path.join(processed_dir, safe_name)
            with open(item_path, "wb") as f:
                f.write(item['content'])
            
            task_items.append({
                "filename": item['filename'],
                "disk_path": item_path
            })

        # Dispatch parallel tasks
        header = [
            process_single_file_task.s(job_id, product_id, auto_map, logical_dataset_name, t)
            for t in task_items
        ]
        callback = finalize_ingestion_job.s(job_id)
        
        chord(header)(callback)
        return {"status": "dispatched", "task_count": len(task_items)}

    except Exception as e:
        import traceback
        error_info = traceback.format_exc()
        print(f"CELERY DISPATCHER ERROR: {e}\n{error_info}")
        job.status = "FAILED"
        job.error_message = str(e)
        db.commit()
        return {"status": "error", "message": str(e)}
    finally:
        db.close()

@app.task
def process_single_file_task(job_id: str, product_id: str, auto_map: bool, logical_dataset_name: str, task_item: dict):
    """Worker task: processes one file."""
    db: Session = SessionLocal()
    from .services.ingestion_service import process_single_ingestion_item, increment_job_progress
    
    try:
        filename = task_item["filename"]
        disk_path = task_item["disk_path"]
        
        with open(disk_path, "rb") as f:
            content = f.read()
            
        result = process_single_ingestion_item(
            db=db,
            filename=filename,
            file_content=content,
            product_id=product_id,
            auto_map=auto_map,
            logical_dataset_name=logical_dataset_name
        )
        
        increment_job_progress(db, job_id)
        return result
    except Exception as e:
        return {"file_name": task_item.get("filename", "unknown"), "status": "error", "error": str(e)}
    finally:
        db.close()

@app.task
def finalize_ingestion_job(results, job_id: str):
    """Aggregator task: collects results and finishes the job."""
    db: Session = SessionLocal()
    try:
        job = db.query(UploadJob).filter(UploadJob.id == job_id).first()
        if not job:
            return {"error": "Job not found"}

        job.status = "COMPLETED"
        job.results = sanitize_nans(results)
        db.commit()
        
        # Clean up temp files
        import shutil
        temp_dir = os.path.join("storage", "temp_uploads", job_id)
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)
            
        return {"status": "success", "results_count": len(results)}
    except Exception as e:
        print(f"CELERY FINALIZER ERROR: {e}")
        return {"status": "error", "message": str(e)}
    finally:
        db.close()

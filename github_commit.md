You are a senior DevOps + backend engineer. Your task is to prepare my entire project for safe GitHub push and production deployment WITHOUT breaking existing functionality.

Perform the following steps carefully:

1. **Audit the repository**

   * Identify unnecessary, sensitive, or large files (e.g., .env, datasets, logs, uploads, outputs, **pycache**, venv, node_modules).
   * Ensure no secrets, API keys, or credentials are exposed anywhere in the code.

2. **Create/Update .gitignore**

   * Add all sensitive and non-essential files/folders:
     .env, *.env, venv/, **pycache**/, *.pyc, *.log, data/, uploads/, outputs/, *.csv, *.xlsx, .ipynb_checkpoints/, .vscode/, .idea/, build/, dist/
   * Ensure only necessary source code and configs are tracked.

3. **Handle environment variables properly**

   * Remove .env from tracking if already added.
   * Create a `.env.example` file with placeholder keys (e.g., DATABASE_URL=, API_KEY=).
   * Refactor code to safely load environment variables (use os.getenv or equivalent).

4. **Ensure deployment readiness**

   * Verify presence of:

     * requirements.txt (correct and minimal dependencies)
     * main entry file (e.g., main.py / app.py)
     * README.md with basic setup instructions
   * If missing, generate them.

5. **Check project structure**

   * Keep only essential folders:
     app/, src/, main files, configs
   * Remove or ignore temporary and experimental files.

6. **Validate the project**

   * Ensure the project still runs locally after cleanup.
   * Do NOT modify business logic unless required for environment/config fixes.

7. **Prepare Git operations**

   * Untrack already committed sensitive files using git rm --cached (without deleting locally).
   * Stage only clean and required files.

8. **Final output**

   * Show:

     * Clean folder structure
     * Final .gitignore content
     * Git commands to safely commit and push:
       git add .
       git commit -m "Deployment ready: cleaned repo and configs"
       git push origin main

IMPORTANT RULES:

* Do NOT delete user data permanently; only untrack or ignore it.
* Do NOT break existing APIs, pipelines, or ML models.
* Prefer safe, minimal, reversible changes.
* Think like preparing a production-grade repo for deployment on cloud (Render/AWS/GCP).

Your goal: Make the project clean, secure, reproducible, and deployment-ready.

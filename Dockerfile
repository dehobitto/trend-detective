# Trend Detective: one container = FastAPI API at /api + built React frontend at /.
#   docker build -t trend-detective .
#   docker run --rm -p 8200:8000 trend-detective      # http://localhost:8200
# Listens on $PORT (default 8000). Run ONE process/worker: jobs live in memory.

# ---- stage 1: build the frontend ---------------------------------------------------------------
FROM node:22-slim AS frontend
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
# Same-origin API (/api); override with --build-arg VITE_API_BASE=https://api.example.org/api
ARG VITE_API_BASE=/api
ENV VITE_API_BASE=${VITE_API_BASE}
RUN npm run build

# ---- stage 2: backend + static files -----------------------------------------------------------
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PORT=8000 \
    TD_STATIC_DIR=/app/static \
    TD_CACHE_DIR=/app/data/cache \
    TD_UPLOAD_DIR=/app/data/uploads \
    TD_CORS_ORIGINS='[]' \
    MALLOC_ARENA_MAX=2
WORKDIR /app/backend
COPY backend/requirements.txt ./
RUN pip install -r requirements.txt
COPY backend/app ./app
COPY --from=frontend /src/frontend/dist /app/static
RUN useradd --create-home --uid 10001 app \
    && mkdir -p /app/data/cache /app/data/uploads \
    && chown -R app:app /app/data
USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import os,urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\",\"8000\")}/api/health', timeout=4)"
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port \"${PORT:-8000}\" --workers 1 --proxy-headers --forwarded-allow-ips='*'"]

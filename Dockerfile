FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY pyproject.toml README.md ./
COPY monitor_engine ./monitor_engine
COPY btx_platform ./btx_platform
COPY tooling ./tooling
COPY clients ./clients
COPY frontend/data ./frontend/data

RUN python -m pip install --upgrade pip \
    && python -m pip install -e ".[dev,platform]"

EXPOSE 8000

CMD ["uvicorn", "btx_platform.asgi:app", "--host", "0.0.0.0", "--port", "8000"]

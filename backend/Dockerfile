# syntax=docker/dockerfile:1

FROM python:3.12-slim-bookworm AS base
LABEL org.opencontainers.image.source=https://github.com/jfhack/cadence
LABEL org.opencontainers.image.description="Cadence backend: FastAPI websocket gateway for Azure pronunciation assessment"
LABEL org.opencontainers.image.licenses=MIT

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# the Azure Speech SDK needs OpenSSL, ALSA and CA certificates at runtime.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libssl3 libasound2 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv/cadence
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# --- development: source is bind-mounted by docker compose ---
FROM base AS dev
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]

# --- production ---
FROM base AS prod
COPY app/ ./app/

RUN groupadd --system cadence && useradd --system --gid cadence --no-create-home cadence
USER cadence

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", \
     "--proxy-headers", "--forwarded-allow-ips", "*", "--no-server-header"]

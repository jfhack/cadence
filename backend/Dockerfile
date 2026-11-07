# syntax=docker/dockerfile:1

FROM python:3.12.16-slim-trixie@sha256:4840d514c583a4d3d8cad3940e68dee6f0f6f3635c12fcd0a3d74c21a5b93a54 AS base
LABEL org.opencontainers.image.source=https://github.com/jfhack/cadence
LABEL org.opencontainers.image.description="Cadence backend: FastAPI websocket gateway for Azure pronunciation assessment"
LABEL org.opencontainers.image.licenses=MIT

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# the Azure Speech SDK needs OpenSSL, ALSA and CA certificates at runtime.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libssl3t64 libasound2t64 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv/cadence
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

FROM base AS dev
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]

FROM base AS prod
COPY app/ ./app/

RUN groupadd --system cadence && useradd --system --gid cadence --no-create-home cadence
USER cadence

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", \
     "--proxy-headers", "--forwarded-allow-ips", "*", "--no-server-header"]

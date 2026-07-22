import logging
import sys

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

from backend.api import auth, gd, gd_live, interviews, progress, questions, reports, solo
from backend.realtime import gd_ws
from backend.config import get_settings

logging.basicConfig(level=logging.INFO, stream=sys.stdout, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("speaksense")

settings = get_settings()

app = FastAPI(title=settings.app_name, version="1.0.0")


@app.on_event("startup")
def _warm_pool_and_models():
    # Open a pooled (warm) connection at startup so the first user request —
    # especially the host "Start" action — doesn't pay the ~2s SSL handshake
    # to the remote DB. This is what keeps the GD startup under 1 second.
    try:
        from backend.database.db import get_connection
        conn = get_connection()
        conn.close()
        logger.info("DB connection pool warmed at startup")
    except Exception as exc:  # pragma: no cover - non-fatal
        logger.warning("DB pool warm-up skipped: %s", exc)

    # Pre-load Whisper model skipped due to Application Control policy restrictions on ctranslate2 DLL
    # try:
    #     from backend.ai.speech_recognition import warmup_model
    #     warmup_model()
    # except Exception as exc:
    #     logger.warning("Whisper warm-up skipped: %s", exc)



app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class IPFilterMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # Allow health checks and CORS preflight through
        if request.url.path == "/health" or request.method == "OPTIONS":
            return await call_next(request)

        allowed = settings.allowed_ips.strip()
        if allowed:
            forwarded = request.headers.get("x-forwarded-for", "")
            client_ip = forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else "")

            # Always allow local/loopback development access
            local_ips = {"127.0.0.1", "::1", "localhost", ""}
            allowed_list = {ip.strip() for ip in allowed.split(",") if ip.strip()}
            allowed_list |= local_ips

            if client_ip not in allowed_list:
                logger.warning("Blocked request from IP: %s", client_ip)
                return JSONResponse(
                    status_code=403,
                    content={"detail": "Access restricted to college network. Please connect via college WiFi."}
                )
        return await call_next(request)


app.add_middleware(IPFilterMiddleware)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.error("Unhandled error on %s %s: %s %s", request.method, request.url.path, type(exc).__name__, exc)
    return JSONResponse(status_code=500, content={"detail": f"Internal server error: {type(exc).__name__}: {exc}"})


@app.get("/", tags=["System"])
def root_redirect() -> RedirectResponse:
    return RedirectResponse(url="/docs")


@app.get("/health", tags=["System"])
def health_check() -> dict:
    return {"status": "ok", "service": settings.app_name}


app.include_router(auth.router)
app.include_router(questions.router)
app.include_router(interviews.router)
app.include_router(progress.router)
app.include_router(reports.router)
app.include_router(gd.router)
app.include_router(gd_live.router)
app.include_router(solo.router)
app.include_router(gd_ws.router)

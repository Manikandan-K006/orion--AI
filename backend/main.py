import logging
import sys

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
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
    try:
        from backend.database.db import get_connection, _return
        conn = get_connection()
        _return(conn)
        logger.info("DB connection pool warmed at startup")
    except Exception as exc:
        logger.warning("DB pool warm-up skipped: %s", exc)


class IPFilterMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.url.path == "/health" or request.method == "OPTIONS":
            return await call_next(request)

        if settings.network_restriction_enabled.strip().lower() != "true":
            return await call_next(request)

        allowed = settings.allowed_ips.strip()
        if allowed:
            forwarded = request.headers.get("x-forwarded-for", "")
            client_ip = forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else "")

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

# Private Network Access (PNA) middleware - Chrome/Edge require this header when
# a web page (even on localhost) makes requests to localhost/127.0.0.1 backends.
# Without it, the browser blocks the preflight and all API calls silently fail.
class PrivateNetworkAccessMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        if request.headers.get("access-control-request-private-network"):
            response.headers["access-control-allow-private-network"] = "true"
        return response

app.add_middleware(PrivateNetworkAccessMiddleware)

app.add_middleware(
    CORSMiddleware,
    # Explicit localhost origins for development (host PC access)
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    # Regex allows any LAN/production HTTP/HTTPS origin (covers 10.x.x.x, 192.168.x.x etc.)
    allow_origin_regex=r"https?://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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


@app.get("/health/database", tags=["System"])
def health_database() -> dict:
    try:
        from backend.database.db import get_connection, _return
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT 1")
        cursor.fetchone()
        cursor.close()
        _return(conn)
        return {"status": "connected", "database": "mysql"}
    except Exception as exc:
        logger.error("Database health check failed: %s", exc)
        return JSONResponse(status_code=503, content={"status": "disconnected", "database": "mysql", "error": str(exc)})


app.include_router(auth.router)
app.include_router(questions.router)
app.include_router(interviews.router)
app.include_router(progress.router)
app.include_router(reports.router)
app.include_router(gd.router)
app.include_router(gd_live.router)
app.include_router(solo.router)
app.include_router(gd_ws.router)

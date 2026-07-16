import logging
import sys

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from backend.api import auth, gd, gd_live, interviews, progress, questions, reports, solo
from backend.config import get_settings

logging.basicConfig(level=logging.INFO, stream=sys.stdout, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("speaksense")

settings = get_settings()

app = FastAPI(title=settings.app_name, version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.error("Unhandled error on %s %s: %s %s", request.method, request.url.path, type(exc).__name__, exc)
    return JSONResponse(status_code=500, content={"detail": f"Internal server error: {type(exc).__name__}: {exc}"})


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

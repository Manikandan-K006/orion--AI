from collections.abc import Generator
from queue import Empty, Queue
import logging
import threading

import mysql.connector
from mysql.connector import MySQLConnection

from backend.config import get_settings

logger = logging.getLogger("speaksense.db")

_pool: "Queue[MySQLConnection] | None" = None
_pool_lock = threading.Lock()
POOL_SIZE = 6


def _make_config() -> dict:
    settings = get_settings()
    config = {
        "host": settings.mysql_host,
        "port": settings.mysql_port,
        "user": settings.mysql_user,
        "password": settings.mysql_password,
        "database": settings.mysql_database,
        "autocommit": True,
        "use_pure": True,
        "connection_timeout": 10,
    }
    if settings.ssl_enabled:
        config["ssl_disabled"] = False
        config["ssl_verify_cert"] = False
    return config


def _open() -> MySQLConnection:
    config = _make_config()
    config["connection_timeout"] = 10
    config.pop("pool_name", None)
    return mysql.connector.connect(**config)


def _is_alive(conn: MySQLConnection) -> bool:
    """Return True only if the connection is genuinely usable."""
    try:
        if not conn.is_connected():
            return False
        conn.cmd_ping()
        return True
    except Exception:
        return False


def _safe_close(conn: MySQLConnection) -> None:
    try:
        conn.close()
    except Exception:
        pass


def _get_pool() -> "Queue[MySQLConnection]":
    global _pool
    if _pool is None:
        with _pool_lock:
            if _pool is None:
                q: "Queue[MySQLConnection]" = Queue(maxsize=POOL_SIZE)
                for _ in range(POOL_SIZE):
                    q.put(_open())
                _pool = q
    return _pool


def get_connection() -> MySQLConnection:
    pool = _get_pool()
    try:
        conn = pool.get_nowait()
    except Empty:
        conn = _open()

    if not _is_alive(conn):
        logger.warning("Stale pooled connection detected — reconnecting")
        _safe_close(conn)
        try:
            conn = _open()
        except Exception as exc:
            logger.error("Failed to open replacement connection: %s", exc)
            raise

    # Safety wrapper: if caller invokes conn.close(), route to _return(conn)
    # so connection is returned to pool instead of being destroyed
    def _pooled_close():
        _return(conn)
    conn.close = _pooled_close
    return conn


def _return(conn: MySQLConnection) -> None:
    pool = _pool
    if pool is None:
        _safe_close(conn)
        return
    # Only return healthy connections to the pool
    if not _is_alive(conn):
        logger.warning("Discarding dead connection instead of returning to pool")
        _safe_close(conn)
        # Replenish pool with a fresh connection to keep it full
        try:
            pool.put_nowait(_open())
        except Exception:
            pass
        return
    try:
        pool.put_nowait(conn)
    except Exception:
        _safe_close(conn)


def get_db() -> Generator[MySQLConnection, None, None]:
    connection = get_connection()
    try:
        yield connection
    finally:
        _return(connection)


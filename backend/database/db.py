from collections.abc import Generator
from queue import Empty, Queue
import threading

import mysql.connector
from mysql.connector import MySQLConnection

from backend.config import get_settings

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
    }
    if settings.mysql_host not in ("localhost", "127.0.0.1"):
        config["ssl_disabled"] = False
    return config


def _open() -> MySQLConnection:
    return mysql.connector.connect(**_make_config())


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
        # Pool exhausted — open a one-off connection (still reused on return
        # only if there's room; otherwise it's just closed).
        return _open()
    # Dead/idle connections must be refreshed before reuse, otherwise the
    # caller hits "'NoneType' object has no attribute 'cursor'".
    try:
        conn.ping(reconnect=True, attempts=3, delay=1)
    except Exception:
        try:
            conn = _open()
        except Exception:
            return _open()
    return conn


def _return(conn: MySQLConnection) -> None:
    pool = _pool
    if pool is None:
        try:
            conn.close()
        except Exception:
            pass
        return
    try:
        pool.put_nowait(conn)
    except Exception:
        try:
            conn.close()
        except Exception:
            pass


def get_db() -> Generator[MySQLConnection, None, None]:
    connection = get_connection()
    try:
        yield connection
    finally:
        _return(connection)

from collections.abc import Generator

import mysql.connector
from mysql.connector import MySQLConnection, pooling

from backend.config import get_settings

_pool = None
_pool_lock = __import__("threading").Lock()


def _build_config() -> dict:
    settings = get_settings()
    config = {
        "host": settings.mysql_host,
        "port": settings.mysql_port,
        "user": settings.mysql_user,
        "password": settings.mysql_password,
        "database": settings.mysql_database,
        "autocommit": False,
        "use_pure": True,
        "pool_name": "speaksense_pool",
        "pool_size": 20,
    }
    if settings.mysql_host not in ("localhost", "127.0.0.1"):
        config["ssl_disabled"] = False
    return config


def _get_pool():
    global _pool
    if _pool is None:
        with _pool_lock:
            if _pool is None:
                _pool = pooling.MySQLConnectionPool(**_build_config())
                try:
                    _pool._remove_sockets = True
                except Exception:
                    pass
    return _pool


def get_connection() -> MySQLConnection:
    pool = _get_pool()
    last_exc = None
    for _ in range(20):
        try:
            conn = pool.get_connection()
        except pooling.PoolError:
            import time as _time
            _time.sleep(0.1)
            last_exc = pooling.PoolError
            continue
        # A pooled connection can be dead (underlying _cnx None) after an idle
        # timeout or a network blip. Validate and reconnect so callers never get
        # a broken connection that raises "'NoneType' has no attribute 'cursor'".
        try:
            if not conn.is_connected():
                conn.reconnect(attempts=3, delay=0)
        except Exception:
            continue
        return conn
    raise (last_exc or RuntimeError("Could not acquire a DB connection"))


def get_db() -> Generator[MySQLConnection, None, None]:
    connection = get_connection()
    try:
        yield connection
    finally:
        connection.close()

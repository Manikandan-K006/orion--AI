from collections.abc import Generator

import mysql.connector
from mysql.connector import MySQLConnection
from mysql.connector import pooling

from backend.config import get_settings

_POOL = None


def _get_pool() -> pooling.MySQLConnectionPool:
    global _POOL
    if _POOL is None:
        settings = get_settings()
        cfg = {
            "host": settings.mysql_host,
            "port": settings.mysql_port,
            "user": settings.mysql_user,
            "password": settings.mysql_password,
            "database": settings.mysql_database,
            "autocommit": False,
            "use_pure": True,
            "pool_name": "speaksense_pool",
            "pool_size": 5,
            "pool_reset_session": True,
        }
        if settings.mysql_host not in ("localhost", "127.0.0.1"):
            cfg["ssl_disabled"] = False
        _POOL = pooling.MySQLConnectionPool(**cfg)
    return _POOL


def get_connection() -> MySQLConnection:
    # Reuse a pooled (warm) connection so we skip the per-request SSL handshake
    # to the remote DB — this is what made the host action take several seconds.
    return _get_pool().get_connection()


def get_db() -> Generator[MySQLConnection, None, None]:
    connection = get_connection()
    try:
        yield connection
    finally:
        connection.close()

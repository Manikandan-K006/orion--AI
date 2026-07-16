from collections.abc import Generator

import mysql.connector
from mysql.connector import MySQLConnection

from backend.config import get_settings


def get_connection() -> MySQLConnection:
    settings = get_settings()
    config = {
        "host": settings.mysql_host,
        "port": settings.mysql_port,
        "user": settings.mysql_user,
        "password": settings.mysql_password,
        "database": settings.mysql_database,
        "autocommit": False,
        "use_pure": True,
    }
    if settings.mysql_host not in ("localhost", "127.0.0.1"):
        config["ssl_disabled"] = False
    return mysql.connector.connect(**config)


def get_db() -> Generator[MySQLConnection, None, None]:
    connection = get_connection()
    try:
        yield connection
    finally:
        connection.close()

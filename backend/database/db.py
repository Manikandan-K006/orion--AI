from collections.abc import Generator

import mysql.connector
from mysql.connector import MySQLConnection

from backend.config import get_settings


def get_connection() -> MySQLConnection:
    settings = get_settings()
    return mysql.connector.connect(
        host=settings.mysql_host,
        port=settings.mysql_port,
        user=settings.mysql_user,
        password=settings.mysql_password,
        database=settings.mysql_database,
        autocommit=False,
    )


def get_db() -> Generator[MySQLConnection, None, None]:
    connection = get_connection()
    try:
        yield connection
    finally:
        connection.close()

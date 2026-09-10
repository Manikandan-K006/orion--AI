import sys
sys.path.insert(0, '.')
from backend.database.db import get_connection, _return

conn = get_connection()
cursor = conn.cursor()

# Test the exact query that was failing
sql = (
    "SELECT u.id, u.name, u.email, u.register_number, u.password_hash, u.role "
    "FROM users u LEFT JOIN student_profile sp ON u.id = sp.user_id "
    "WHERE TRIM(u.register_number) = %s OR TRIM(COALESCE(sp.spr_no, '')) = %s"
)
cursor.execute(sql, ('test', 'test'))
print("Login query OK! Rows:", cursor.fetchall())

# Also confirm all columns exist
cursor.execute("DESCRIBE student_profile")
print("\nstudent_profile columns:")
for row in cursor.fetchall():
    print(" ", row)

cursor.close()
_return(conn)

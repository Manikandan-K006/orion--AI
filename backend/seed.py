"""Seed the database with 10 students and proper bcrypt hashes."""
import mysql.connector
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

STUDENTS = [
    ("911724205001", "Aadithya"),
    ("911724205002", "Afra nasrin"),
    ("911724205003", "Anbu Selvam V"),
    ("911724205004", "Anbu selvan . G"),
    ("911724205005", "Avineshwaran"),
    ("911724205006", "Bala murugan"),
    ("911724205007", "Benazir"),
    ("911724205008", "Bharanidharan"),
    ("911724205009", "Bharathi"),
    ("911724205010", "Bhavishna"),
]

hash_pw = pwd_context.hash("Password123")

conn = mysql.connector.connect(
    host="localhost", port=3306, user="root",
    password="mani_password", database="speaksense_ai"
)
cursor = conn.cursor()

for reg_no, name in STUDENTS:
    email = f"{reg_no}@mzgd.edu"
    cursor.execute(
        "INSERT IGNORE INTO users (register_number, name, email, password_hash, role) VALUES (%s, %s, %s, %s, 'student')",
        (reg_no, name, email, hash_pw)
    )
    user_id = cursor.lastrowid or cursor.fetchone()
    if user_id:
        cursor.execute(
            "INSERT IGNORE INTO student_profile (user_id, department, year) VALUES (%s, 'Computer Science', 'Final Year')",
            (cursor.lastrowid,)
        )

conn.commit()
cursor.close()
conn.close()
print("Seeded 10 students with password: Password123")

"""Seed the database with all students and proper bcrypt hashes."""
import mysql.connector
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

STUDENTS = [
    ("911724205001", "ADITHYA K"),
    ("911724205002", "AFRA NASIRIN M"),
    ("911724205003", "ANBU SELVAM V"),
    ("911724205004", "ANBUSELVAN G"),
    ("911724205005", "AVINESHWARAN G R"),
    ("911724205006", "BALAMURUGAN N"),
    ("911724205007", "BENAZIR S"),
    ("911724205008", "BHARANIDHARAN M"),
    ("911724205009", "BHARATHI B"),
    ("911724205010", "BHAVISHNA K"),
    ("911724205011", "BHUVANA SRI P"),
    ("911724205012", "CHARUBALA P"),
    ("911724205014", "DINESH M"),
    ("911724205015", "FIZAL MOHAMED S"),
    ("911724205016", "GANDHI RAJAN S"),
    ("911724205017", "GOKULASUNDHARAM K"),
    ("911724205018", "HAJER S"),
    ("911724205019", "HARIHARAN S"),
    ("911724205020", "HARIHARAN V"),
    ("911724205021", "HARINI R"),
    ("911724205022", "HARITHA M"),
    ("911724205023", "HEMALATHA R"),
    ("911724205024", "HEPHZIBAH JONES A"),
    ("911724205025", "KAMINI SRI P"),
    ("911724205026", "KAVIYA M"),
    ("911724205027", "KUMARARAJA A"),
    ("911724205028", "LARITHU DHARSINI M"),
    ("911724205029", "MAHALAKSHMI R"),
    ("911724205030", "MANIKANDAN B"),
    ("911724205031", "MANIKANDAN K"),
    ("911724205032", "MERLIN Y"),
    ("911724205033", "MOHAMED SHARIK ANWAR M"),
    ("911724205035", "MURFITHA T"),
    ("911724205036", "NAGENDRA M"),
    ("911724205037", "NANDHINI J"),
    ("911724205038", "NANDHITHA P"),
    ("911724205039", "NAVEENA A"),
    ("911724205040", "NIVIKRISHNAN S"),
    ("911724205041", "PAINTAMIL PARITHI KR"),
    ("911724205042", "PRAGATHEESH S"),
    ("911724205043", "RAMYA C"),
    ("911724205044", "ROKITH M"),
    ("911724205045", "SAKKTHI SHRI S"),
    ("911724205046", "SAMEENA H"),
    ("911724205047", "SARANYA S"),
    ("911724205048", "SENTHUR MANIVASAN C"),
    ("911724205049", "SERAN S"),
    ("911724205050", "SRI DURGA K"),
    ("911724205051", "SUBHA B"),
    ("911724205052", "SUDHARSANA DEVI S"),
    ("911724205053", "SWATHI G"),
    ("911724205054", "SWETHA G"),
    ("911724205056", "THAMARAI SELVAN V"),
    ("911724205057", "THIRUKUMARAN S"),
    ("911724205058", "VARSHINI S"),
    ("911724205059", "VIJAY KANNAN N"),
    ("911724205060", "VISHAL R"),
    ("911724205061", "VISHWA"),
    ("911724205301", "RUNESH"),
    ("911724205302", "MUKHA"),
    ("911724205701", "AHAMED AASHIQ S"),
]

hash_pw = pwd_context.hash("Password123")

conn = mysql.connector.connect(
    host="your-project.aivencloud.com", port=12345, user="avnadmin",
    password="YOUR_AIVEN_PASSWORD", database="speaksense_ai",
    ssl_disabled=False,
)
cursor = conn.cursor()

for reg_no, name in STUDENTS:
    email = f"{reg_no}@mzgd.edu"
    cursor.execute(
        "INSERT IGNORE INTO users (register_number, name, email, password_hash, role) VALUES (%s, %s, %s, %s, 'student')",
        (reg_no, name, email, hash_pw)
    )
    # Get the user id (whether just inserted or already existed)
    cursor.execute("SELECT id FROM users WHERE register_number = %s", (reg_no,))
    row = cursor.fetchone()
    if row:
        uid = row[0]
        cursor.execute(
            "INSERT IGNORE INTO student_profile (user_id, department, year) VALUES (%s, 'IT', '3rd Year')",
            (uid,)
        )

conn.commit()
cursor.close()
conn.close()
print(f"Seeded {len(STUDENTS)} students with password: Password123")

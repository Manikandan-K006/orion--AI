"""Seed the database with all students and proper password hashes."""
import hashlib
import os
import mysql.connector
from backend.security import hash_password

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

salt = os.urandom(32)
hash_pw = salt.hex() + ":" + hashlib.pbkdf2_hmac("sha256", "Password123".encode("utf-8"), salt, 100000).hex()

conn = mysql.connector.connect(
    host=os.environ.get("MYSQL_HOST", "localhost"), port=int(os.environ.get("MYSQL_PORT", 3306)),
    user=os.environ.get("MYSQL_USER", "root"),
    password=os.environ.get("MYSQL_PASSWORD", "mani_password"),
    database=os.environ.get("MYSQL_DATABASE", "speaksense_ai"),
)
cursor = conn.cursor()

STUDENT_EMAILS = {
    "911724205001": "adithya9864@mountzion.ac.in",
    "911724205002": "afranasirin10017@mountzion.ac.in",
    "911724205003": "anbuselvam9911@mountzion.ac.in",
    "911724205004": "anbuselvan9715@mountzion.ac.in",
    "911724205005": "avineshwaran10004@mountzion.ac.in",
    "911724205006": "balamurugan9526@mountzion.ac.in",
    "911724205007": "benazir9752@mountzion.ac.in",
    "911724205008": "bharanidharan9608@mountzion.ac.in",
    "911724205009": "bharathi9969@mountzion.ac.in",
    "911724205010": "bhavishna9974@mountzion.ac.in",
    "911724205011": "bhuvana9754@mountzion.ac.in",
    "911724205012": "charubala9602@mountzion.ac.in",
    "911724205014": "dinesh9985@mountzion.ac.in",
    "911724205015": "fizalmohamed9730@mountzion.ac.in",
    "911724205016": "gandhirajan9580@mountzion.ac.in",
    "911724205017": "gokulasundharam9759@mountzion.ac.in",
    "911724205018": "hajer9542@mountzion.ac.in",
    "911724205019": "hariharan9665@mountzion.ac.in",
    "911724205020": "hariharan9882@mountzion.ac.in",
    "911724205021": "harini10022@mountzion.ac.in",
    "911724205022": "haritha9941@mountzion.ac.in",
    "911724205023": "hemalatha9792@mountzion.ac.in",
    "911724205024": "hephzibahjones9770@mountzion.ac.in",
    "911724205025": "kaminisri9648@mountzion.ac.in",
    "911724205026": "kaviya9835@mountzion.ac.in",
    "911724205027": "kumararaja9706@mountzion.ac.in",
    "911724205028": "larithudharsini9563@mountzion.ac.in",
    "911724205029": "mahalakshmi9982@mountzion.ac.in",
    "911724205030": "manikandan9562@mountzion.ac.in",
    "911724205031": "manikandan9928@mountzion.ac.in",
    "911724205032": "merlin9644@mountzion.ac.in",
    "911724205033": "mohamedsharikanwar9579@mountzion.ac.in",
    "911724205035": "murfitha9679@mountzion.ac.in",
    "911724205036": "nagendra9607@mountzion.ac.in",
    "911724205037": "nandhini9940@mountzion.ac.in",
    "911724205038": "nandhitha9778@mountzion.ac.in",
    "911724205039": "naveena9783@mountzion.ac.in",
    "911724205040": "nivikrishnan9906@mountzion.ac.in",
    "911724205041": "paintamilparithi9625@mountzion.ac.in",
    "911724205042": "pragatheesh9571@mountzion.ac.in",
    "911724205043": "ramya9645@mountzion.ac.in",
    "911724205044": "rokith9872@mountzion.ac.in",
    "911724205045": "sakkthishri9599@mountzion.ac.in",
    "911724205046": "sameena9559@mountzion.ac.in",
    "911724205047": "saranya9933@mountzion.ac.in",
    "911724205048": "senthurmanivasan9870@mountzion.ac.in",
    "911724205049": "seran9720@mountzion.ac.in",
    "911724205050": "sridurga9879@mountzion.ac.in",
    "911724205051": "subha9594@mountzion.ac.in",
    "911724205052": "sudharsanadevi9915@mountzion.ac.in",
    "911724205053": "swathi10013@mountzion.ac.in",
    "911724205054": "swetha9613@mountzion.ac.in",
    "911724205056": "thamaraiselvan9962@mountzion.ac.in",
    "911724205057": "thirukumaran9658@mountzion.ac.in",
    "911724205058": "varshini9570@mountzion.ac.in",
    "911724205059": "vijaykannan9689@mountzion.ac.in",
    "911724205060": "vishal9932@mountzion.ac.in",
    "911724205061": "vishwa9735@mountzion.ac.in",
    "911724205301": "runesh10323@mountzion.ac.in",
    "911724205302": "mukha10517@mountzion.ac.in",
    "911724205701": "ahamedaashiq10376@mountzion.ac.in",
}

for reg_no, name in STUDENTS:
    email = STUDENT_EMAILS.get(reg_no, f"{reg_no}@mzgd.edu")
    cursor.execute(
        "INSERT INTO users (register_number, name, email, password_hash, role) VALUES (%s, %s, %s, %s, 'student') "
        "ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), name = VALUES(name)",
        (reg_no, name, email, hash_pw)
    )
    # Get the user id (whether just inserted or already existed)
    cursor.execute("SELECT id FROM users WHERE register_number = %s", (reg_no,))
    row = cursor.fetchone()
    if row:
        uid = row[0]
        cursor.execute(
            "INSERT INTO student_profile (user_id, department, year) VALUES (%s, 'IT', '3rd Year') "
            "ON DUPLICATE KEY UPDATE department = VALUES(department), year = VALUES(year)",
            (uid,)
        )

conn.commit()

# Create admin user if not exists
admin_email = "admin@mountzion.ac.in"
admin_reg = "12345"
cursor.execute("SELECT id FROM users WHERE register_number = %s", (admin_reg,))
if not cursor.fetchone():
    admin_hash = hash_password("Mzorator@admin")
    cursor.execute(
        "INSERT INTO users (register_number, name, email, password_hash, role) VALUES (%s, %s, %s, %s, 'admin')",
        (admin_reg, "Admin", admin_email, admin_hash)
    )
    print("Admin user created: SPR 12345 / Mzorator@admin")
else:
    print("Admin user already exists")

conn.commit()
cursor.close()
conn.close()
print(f"Seeded {len(STUDENTS)} students with password: Password123")

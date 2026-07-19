import logging

import pandas
from mysql.connector import MySQLConnection

from backend.database.db import get_connection
from backend.security import hash_password

logger = logging.getLogger("student_import")

DEFAULT_PASSWORD = "Password123"

YEAR_SUFFIX = {1: "st", 2: "nd", 3: "rd"}

GENDER_MAP = {
    "male": "Male",
    "female": "Female",
    "m": "Male",
    "f": "Female",
}

COLUMNS = {"SPR_No", "Register_No", "Student_Name", "Year", "Dept", "Sec", "Gender", "DateOfBirth"}


def _normalise_gender(val: object) -> str | None:
    if val is None:
        return None
    s = str(val).strip()
    if not s:
        return None
    return GENDER_MAP.get(s.lower(), s)


def _ordinal_year(y: int) -> str:
    suffix = YEAR_SUFFIX.get(y, "th")
    return f"{y}{suffix} Year"


def _ensure_profile_columns(conn: MySQLConnection) -> None:
    cursor = conn.cursor()
    try:
        cursor.execute("SHOW COLUMNS FROM student_profile")
        existing = {row[0] for row in cursor.fetchall()}
        additions = []
        for col, definition in [
            ("section", "VARCHAR(10) DEFAULT NULL"),
            ("gender", "VARCHAR(10) DEFAULT NULL"),
            ("date_of_birth", "DATE DEFAULT NULL"),
            ("spr_no", "VARCHAR(20) DEFAULT NULL"),
        ]:
            if col not in existing:
                additions.append(f"ADD COLUMN {col} {definition}")
        if additions:
            sql = "ALTER TABLE student_profile " + ", ".join(additions)
            cursor.execute(sql)
            logger.info("Added columns to student_profile: %s", [a.split()[2] for a in additions])
    finally:
        cursor.close()


def _safe_str(val: object) -> str:
    if val is None:
        return ""
    s = str(val).strip()
    return s if s != "nan" else ""


def _safe_date(val: object) -> str | None:
    if val is None or pandas.isna(val):
        return None
    d = pandas.to_datetime(val, errors="coerce", format="mixed", dayfirst=False)
    if pandas.isna(d):
        return None
    return d.strftime("%Y-%m-%d")


def import_students_from_excel(filepath: str) -> dict:
    xl = pandas.ExcelFile(filepath)
    logger.info("Found sheets: %s", xl.sheet_names)

    rows = []
    for sheet_name in xl.sheet_names:
        df = xl.parse(sheet_name)
        if not set(df.columns).issuperset(COLUMNS):
            missing = COLUMNS - set(df.columns)
            logger.warning("Sheet '%s' missing columns: %s — skipped", sheet_name, missing)
            continue
        for _, row in df.iterrows():
            dept = _safe_str(row.get("Dept")) or sheet_name
            yr_val = row.get("Year")
            rows.append({
                "spr_no": _safe_str(row.get("SPR_No")),
                "register_number": _safe_str(row.get("Register_No")),
                "full_name": _safe_str(row.get("Student_Name")),
                "year_raw": yr_val,
                "dept": dept,
                "section": _safe_str(row.get("Sec")),
                "gender": _normalise_gender(row.get("Gender")),
                "date_of_birth": _safe_date(row.get("DateOfBirth")),
            })

    logger.info("Total rows read: %d", len(rows))

    validated: list[dict] = []
    errors: list[str] = []
    seen_in_batch: set[str] = set()

    for r in rows:
        reg = r["register_number"]
        name = r["full_name"]
        yr_raw = r["year_raw"]

        if not reg:
            errors.append(f"Row (sheet={r['dept']}, SPR={r['spr_no']}): Register_No is empty")
            continue
        if not name:
            errors.append(f"Reg {reg}: Student_Name is empty")
            continue

        year_ordinal = ""
        if pandas.notna(yr_raw):
            try:
                y = int(yr_raw)
                if y < 1 or y > 4:
                    errors.append(f"Reg {reg}: Year {y} out of range (1-4)")
                    continue
                year_ordinal = _ordinal_year(y)
            except (ValueError, TypeError):
                errors.append(f"Reg {reg}: Invalid Year '{yr_raw}'")
                continue

        if reg in seen_in_batch:
            errors.append(f"Reg {reg}: Duplicate within Excel (skipped)")
            continue
        seen_in_batch.add(reg)

        validated.append({
            **r,
            "year_str": year_ordinal,
        })

    conn = get_connection()
    try:
        _ensure_profile_columns(conn)

        cursor = conn.cursor(dictionary=True)
        try:
            cursor.execute("SELECT register_number FROM users WHERE role = 'student'")
            existing_regs = {row["register_number"] for row in cursor.fetchall()}
        finally:
            cursor.close()

        pw_hash = hash_password(DEFAULT_PASSWORD)
        imported = 0
        duplicates = 0
        dept_count: dict[str, int] = {}

        user_batch: list[tuple[str, str, str, str, str]] = []
        profile_batch: list[tuple[str, str, str, str | None, str | None, str]] = []
        insert_regs: list[str] = []

        for r in validated:
            reg = r["register_number"]
            if reg in existing_regs:
                duplicates += 1
                continue

            email = f"{reg}@mountzion.ac.in"
            user_batch.append((reg, r["full_name"], email, pw_hash, "student"))
            profile_batch.append((
                r["dept"],
                r["year_str"],
                r["section"],
                r["gender"],
                r["date_of_birth"],
                r["spr_no"],
            ))
            insert_regs.append(reg)
            dept_count[r["dept"]] = dept_count.get(r["dept"], 0) + 1

        if user_batch:
            conn.start_transaction()
            cursor = conn.cursor()
            try:
                cursor.executemany(
                    "INSERT INTO users (register_number, name, email, password_hash, role) "
                    "VALUES (%s, %s, %s, %s, %s)",
                    user_batch,
                )
                conn.commit()

                cursor.execute("SELECT LAST_INSERT_ID() AS lid")
                start_id = int(cursor.fetchone()[0])

                profile_rows: list[tuple[int, str, str, str, str | None, str | None, str]] = []
                for j, reg in enumerate(insert_regs):
                    profile_rows.append((
                        start_id + j,
                        profile_batch[j][0],
                        profile_batch[j][1],
                        profile_batch[j][2],
                        profile_batch[j][3],
                        profile_batch[j][4],
                        profile_batch[j][5],
                    ))

                cursor.executemany(
                    "INSERT INTO student_profile (user_id, department, year, section, gender, date_of_birth, spr_no) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s)",
                    profile_rows,
                )
                conn.commit()
                imported = len(user_batch)
                logger.info("Imported %d students", imported)
            except Exception:
                conn.rollback()
                raise
            finally:
                cursor.close()

        return {
            "imported": imported,
            "duplicates": duplicates,
            "errors": errors,
            "dept_count": dept_count,
            "total_read": len(rows),
            "total_validated": len(validated),
        }
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

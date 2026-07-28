import mysql.connector
from backend.database.db import get_connection

def run_migrations():
    conn = get_connection()
    cursor = conn.cursor()
    
    print("Modifying gd_live_participants status enum...")
    try:
        cursor.execute("ALTER TABLE gd_live_participants MODIFY COLUMN status ENUM('invited', 'joined', 'assigned', 'completed') NOT NULL DEFAULT 'joined'")
        conn.commit()
        print("Success: gd_live_participants modified.")
    except Exception as e:
        print(f"Error modifying gd_live_participants: {e}")
        conn.rollback()

    print("Adding columns to gd_live_sessions...")
    # Add speaking_time
    try:
        cursor.execute("ALTER TABLE gd_live_sessions ADD COLUMN speaking_time INT NOT NULL DEFAULT 120")
        conn.commit()
        print("Success: speaking_time added.")
    except Exception as e:
        print(f"speaking_time already exists or error: {e}")
        conn.rollback()

    # Add speaking_order
    try:
        cursor.execute("ALTER TABLE gd_live_sessions ADD COLUMN speaking_order TEXT")
        conn.commit()
        print("Success: speaking_order added.")
    except Exception as e:
        print(f"speaking_order already exists or error: {e}")
        conn.rollback()

    conn.close()
    print("Migration finished!")

if __name__ == '__main__':
    run_migrations()

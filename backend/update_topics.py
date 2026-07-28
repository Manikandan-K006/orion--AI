"""Replace GD and Solo Practice topics with 100 simple college topics.

Run: cd speaksense-ai-orion && backend\venv\Scripts\python.exe -m backend.update_topics
"""

from backend.database.db import get_connection

TOPICS = [
    ("My College", "college"),
    ("My Best Friend", "personal"),
    ("My Family", "personal"),
    ("My Favorite Lecturer", "favorites"),
    ("My Favorite Subject", "favorites"),
    ("My Favorite Food", "favorites"),
    ("My Favorite Game", "favorites"),
    ("My Favorite Sport", "favorites"),
    ("My Favorite Movie", "favorites"),
    ("My Favorite Place", "favorites"),
    ("My Favorite Festival", "favorites"),
    ("My Favorite Season", "favorites"),
    ("My Favorite Hobby", "favorites"),
    ("My Favorite Mobile App", "favorites"),
    ("My Favorite Social Media App", "favorites"),
    ("College Life", "college"),
    ("First Day at College", "college"),
    ("College Friends", "college"),
    ("College Classroom", "college"),
    ("College Canteen", "college"),
    ("College Library", "college"),
    ("College Bus", "college"),
    ("College Uniform", "college"),
    ("College Events", "college"),
    ("College Functions", "college"),
    ("College Holidays", "college"),
    ("College Tour", "college"),
    ("College Hostel", "college"),
    ("College Attendance", "college"),
    ("College Exams", "college"),
    ("Assignments", "academics"),
    ("Semester Exams", "academics"),
    ("Online Classes", "academics"),
    ("Practical Classes", "academics"),
    ("Group Projects", "academics"),
    ("Reading Books", "academics"),
    ("Communication Skills", "skills"),
    ("English Speaking", "skills"),
    ("Learning New Skills", "skills"),
    ("Time Management", "skills"),
    ("Mobile Phones", "technology"),
    ("Internet", "technology"),
    ("YouTube", "technology"),
    ("Social Media", "technology"),
    ("Instagram", "technology"),
    ("WhatsApp", "technology"),
    ("Online Games", "technology"),
    ("Video Games", "technology"),
    ("Artificial Intelligence", "technology"),
    ("ChatGPT", "technology"),
    ("Computers", "technology"),
    ("Online Shopping", "technology"),
    ("Online Learning", "technology"),
    ("Digital Payments", "technology"),
    ("Mobile Banking", "technology"),
    ("Watching Movies", "entertainment"),
    ("Listening to Music", "entertainment"),
    ("Playing Cricket", "sports"),
    ("Playing Football", "sports"),
    ("Indoor Games", "sports"),
    ("Outdoor Games", "sports"),
    ("Exercise", "health"),
    ("Healthy Food", "health"),
    ("Junk Food", "health"),
    ("Good Sleep", "health"),
    ("Morning Routine", "daily_life"),
    ("Good Habits", "daily_life"),
    ("Cleanliness", "daily_life"),
    ("Friendship", "values"),
    ("Teamwork", "values"),
    ("Helping Others", "values"),
    ("Being Honest", "values"),
    ("Being Kind", "values"),
    ("Discipline", "values"),
    ("Hard Work", "values"),
    ("Confidence", "values"),
    ("Leadership", "values"),
    ("Success", "values"),
    ("Failure", "values"),
    ("Saving Money", "finance"),
    ("Trees", "environment"),
    ("Nature", "environment"),
    ("Rain", "environment"),
    ("Pollution", "environment"),
    ("Saving Water", "environment"),
    ("Saving Electricity", "environment"),
    ("Planting Trees", "environment"),
    ("Keeping Our College Clean", "environment"),
    ("Public Transport", "society"),
    ("City Life", "society"),
    ("Village Life", "society"),
    ("A Day Without a Mobile Phone", "reflection"),
    ("A Day Without Internet", "reflection"),
    ("Work From Home", "career"),
    ("Part-Time Jobs for Students", "career"),
    ("Internship", "career"),
    ("My Dream Job", "career"),
    ("My Career Goal", "career"),
    ("Campus Placement", "career"),
    ("How Can We Make Our College Better?", "college"),
]


def main():
    conn = get_connection()
    cursor = conn.cursor()

    try:
        cursor.execute("SET FOREIGN_KEY_CHECKS = 0")
        print("Disabled FK checks")

        cursor.execute("DELETE FROM gd_topic_refreshes")
        print(f"Cleared gd_topic_refreshes")

        cursor.execute("DELETE FROM gd_easy_topics")
        print(f"Cleared gd_easy_topics ({cursor.rowcount} rows removed)")

        cursor.execute("DELETE FROM gd_topics")
        print(f"Cleared gd_topics ({cursor.rowcount} rows removed)")

        cursor.execute("SET FOREIGN_KEY_CHECKS = 1")
        print("Re-enabled FK checks")

        insert_gd = "INSERT INTO gd_topics (topic, category) VALUES (%s, %s)"
        insert_easy = "INSERT INTO gd_easy_topics (topic) VALUES (%s)"

        for topic_text, category in TOPICS:
            cursor.execute(insert_gd, (topic_text, category))
            cursor.execute(insert_easy, (topic_text,))

        conn.commit()
        print(f"\nInserted {len(TOPICS)} topics into gd_topics")
        print(f"Inserted {len(TOPICS)} topics into gd_easy_topics")
        print("Done!")

    except Exception as e:
        conn.rollback()
        print(f"Error: {e}")
        raise
    finally:
        cursor.close()
        conn.close()


if __name__ == "__main__":
    main()

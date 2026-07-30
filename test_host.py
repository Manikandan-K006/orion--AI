import os
import requests
import mysql.connector

api_url = os.environ.get("API_URL", "http://127.0.0.1:8000")
db_host = os.environ.get("DB_HOST", "127.0.0.1")
db_user = os.environ.get("DB_USER", "root")
db_password = os.environ.get("DB_PASSWORD", "")
db_name = os.environ.get("DB_NAME", "speaksense_ai")
admin_password = os.environ.get("ADMIN_PASSWORD", "")

res = requests.post(f'{api_url}/login/register-number', json={'register_number': '12345', 'password': admin_password})
token = res.json().get('access_token')

res = requests.post(f'{api_url}/gd-live/sessions', headers={'Authorization': 'Bearer ' + token})
session_code = res.json()['session_code']
print('Created session:', session_code)

conn = mysql.connector.connect(host=db_host, user=db_user, password=db_password, database=db_name)
cursor = conn.cursor(dictionary=True)

cursor.execute('SELECT id FROM users LIMIT 2')
users = cursor.fetchall()
u1 = users[0]['id']
u2 = users[1]['id']

cursor.execute(f'INSERT INTO gd_live_participants (session_code, user_id) VALUES ("{session_code}", {u1}), ("{session_code}", {u2})')
conn.commit()
print('Joined users')

res = requests.post(f'{api_url}/gd-live/sessions/{session_code}/host-meeting', headers={'Authorization': 'Bearer ' + token})
print('Status:', res.status_code)
print('Response:', res.text)

import urllib.request
import urllib.error
import json

base_url = "http://127.0.0.1:8000"

def make_request(url, data=None, headers=None, method='GET'):
    req_headers = {"Content-Type": "application/json"}
    if headers:
        req_headers.update(headers)
    req_data = None
    if data:
        req_data = json.dumps(data).encode('utf-8')
    req = urllib.request.Request(url, data=req_data, headers=req_headers, method=method)
    try:
        with urllib.request.urlopen(req) as response:
            return response.status, response.read(), dict(response.info())
    except urllib.error.HTTPError as e:
        return e.code, e.read(), dict(e.info())

# 1. Log in as Admin
print("Logging in as Admin...")
status, content, resp_headers = make_request(
    f"{base_url}/login/register-number",
    data={"register_number": "12345", "password": "Mzorator@admin"},
    method="POST"
)
admin_token = json.loads(content.decode('utf-8'))["access_token"]
admin_headers = {"Authorization": f"Bearer {admin_token}"}
print("Logged in as Admin.")

# 2. Get Admin's own PDF report for session 1234 (Should fail with 404 because Admin is not a student participant)
print("\n--- STEP 2: [Admin] GET /reports/gd-live/1234/pdf ---")
status, content, resp_headers = make_request(
    f"{base_url}/reports/gd-live/1234/pdf",
    headers=admin_headers
)
print("Status:", status, "(Expected: 404)")
print("Response:", content.decode('utf-8'))
assert status == 404
assert "no evaluation found" in content.decode('utf-8').lower()

# 3. Get Admin User-Specific PDF report for student user_id=57 in session 1234 (Should succeed!)
print("\n--- STEP 3: [Admin] GET /reports/gd-live/1234/pdf?user_id=57 ---")
status, content, resp_headers = make_request(
    f"{base_url}/reports/gd-live/1234/pdf?user_id=57",
    headers=admin_headers
)
print("Status:", status, "(Expected: 200)")
print("Content-Type:", resp_headers.get('Content-Type'))
print("Is PDF:", content.startswith(b"%PDF"))
print("Size:", len(content), "bytes")
assert status == 200
assert content.startswith(b"%PDF")

# 4. Get Admin Session Leaderboard Excel report for session 1234 (Should succeed!)
print("\n--- STEP 4: [Admin] GET /reports/gd-live/1234/excel ---")
status, content, resp_headers = make_request(
    f"{base_url}/reports/gd-live/1234/excel",
    headers=admin_headers
)
print("Status:", status, "(Expected: 200)")
print("Content-Type:", resp_headers.get('Content-Type'))
print("Size:", len(content), "bytes")
assert status == 200
assert any(t in resp_headers.get('Content-Type', '').lower() for t in ["spreadsheet", "excel", "openxmlformats"])

# 5. Log in as Student VISHAL R (user_id=57)
print("\nLogging in as Student VISHAL R...")
status, content, resp_headers = make_request(
    f"{base_url}/login/register-number",
    data={"register_number": "911724205060", "password": "Password123"},
    method="POST"
)
student_token = json.loads(content.decode('utf-8'))["access_token"]
student_headers = {"Authorization": f"Bearer {student_token}"}
print("Logged in as Student.")

# 6. Get Student's own PDF report (Should succeed!)
print("\n--- STEP 6: [Student] GET /reports/gd-live/1234/pdf ---")
status, content, resp_headers = make_request(
    f"{base_url}/reports/gd-live/1234/pdf",
    headers=student_headers
)
print("Status:", status, "(Expected: 200)")
print("Content-Type:", resp_headers.get('Content-Type'))
print("Is PDF:", content.startswith(b"%PDF"))
print("Size:", len(content), "bytes")
assert status == 200
assert content.startswith(b"%PDF")

# 7. Student trying to query another user's PDF report (user_id=1) (Should fail with 403!)
print("\n--- STEP 7: [Student UI Hack] GET /reports/gd-live/1234/pdf?user_id=1 ---")
status, content, resp_headers = make_request(
    f"{base_url}/reports/gd-live/1234/pdf?user_id=1",
    headers=student_headers
)
print("Status:", status, "(Expected: 403)")
print("Response:", content.decode('utf-8'))
assert status == 403

# 8. Student trying to query Excel sheet (only Admins allowed!) (Should fail with 403!)
print("\n--- STEP 8: [Student UI Hack] GET /reports/gd-live/1234/excel ---")
status, content, resp_headers = make_request(
    f"{base_url}/reports/gd-live/1234/excel",
    headers=student_headers
)
print("Status:", status, "(Expected: 403)")
print("Response:", content.decode('utf-8'))
assert status == 403

print("\n--- ALL REPORT INTEGRATION TESTS PASSED SUCCESSFULLY! ---")

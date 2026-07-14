"""Test the finish endpoint fix."""
import urllib.request, json

def req(method, path, data=None, token=None):
    h = {"Content-Type": "application/json"}
    if token:
        h["Authorization"] = "Bearer " + token
    b = json.dumps(data).encode() if data else (b"{}" if method in ("POST","PUT","PATCH") else None)
    r = urllib.request.Request("http://localhost:8000" + path, data=b, headers=h, method=method)
    resp = urllib.request.urlopen(r, timeout=10)
    return json.loads(resp.read().decode())

# Login
r = req("POST", "/login/register-number", {"register_number":"911724205001","password":"Password123"})
token = r["access_token"]
print("1. Login:", r["user"]["name"])

# Refresh topic
t = req("POST", "/gd/topics/refresh", token=token)
print("2. Topic:", t["topic"][:30])

# Create session
code = req("POST", "/gd/sessions", {"topic_id":t["id"],"team_size":6}, token)["session_code"]
print("3. Code:", code)

# User 2 join
r2 = req("POST", "/login/register-number", {"register_number":"911724205002","password":"Password123"})
t2 = r2["access_token"]
req("POST", "/gd/sessions/" + code + "/join", token=t2)
print("4. User 2 joined")

# Start
req("POST", "/gd/sessions/" + code + "/start", token=token)
print("5. Started")

# Submit both
req("POST", "/gd/sessions/" + code + "/submit", {"transcript":"Test transcript one."}, token)
req("POST", "/gd/sessions/" + code + "/submit", {"transcript":"Test transcript two."}, token=t2)
print("6. Both submitted")

# Finish - the bug was here
req("POST", "/gd/sessions/" + code + "/finish", token=token)
print("7. Finished [OK]")

# Verify
s = req("GET", "/gd/sessions/" + code, token=token)
print("8. Status:", s["status"])
assert s["status"] == "completed"
print("[PASS] Finish endpoint works correctly")

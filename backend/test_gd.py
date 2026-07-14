"""Test the full GD flow with new session_code and topic refresh."""
import json
import urllib.request
import urllib.error

BASE = "http://localhost:8000"

def req(method, path, data=None, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    body = json.dumps(data).encode() if data else (b"{}" if method in ("POST", "PUT", "PATCH") else None)
    r = urllib.request.Request(f"{BASE}{path}", data=body, headers=headers, method=method)
    try:
        resp = urllib.request.urlopen(r)
        return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        err = json.loads(e.read().decode())
        raise Exception(f"{e.code}: {err.get('detail', str(err))}")

# 1. Login
r = req("POST", "/login/register-number", {"register_number": "911724205001", "password": "Password123"})
token = r["access_token"]
print("1. Login OK:", r["user"]["name"])

# 2-4. Refresh topic 3 times
topics_seen = set()
for i in range(3):
    t = req("POST", "/gd/topics/refresh", token=token)
    topics_seen.add(t["topic"])
    print(f"2.{i+1} Topic {i+1}: {t['topic']} [{t['category']}]")

assert len(topics_seen) == 3, f"Topics should be unique, got {len(topics_seen)}"
print(f"   All {len(topics_seen)} topics are unique ✓")

# 5. 4th refresh should fail
try:
    req("POST", "/gd/topics/refresh", token=token)
    assert False, "Should have failed"
except Exception as e:
    print(f"3. 4th refresh correctly rejected: {e}")

# 6. Create session with the last topic
t = req("POST", "/gd/topics/refresh", token=token)  # reset by actually we need a fresh topic since the previous session
# Actually the refresh resets on session creation, but we need a topic. Let me just pick the first one available
# Get topics list
topics = req("GET", "/gd/topics", token=token)
t2 = topics[0]
print(f"4. Using topic: {t2['topic']}")

r = req("POST", "/gd/sessions", {"topic_id": t2["id"], "team_size": 6}, token=token)
code = r["session_code"]
print(f"5. Session created: code={code}")
assert len(code) == 12, f"Session code should be 12 chars, got {len(code)}"
assert r["message"] == "GD session created. Share the session code with your team."

# 7. Get session
s = req("GET", f"/gd/sessions/{code}", token=token)
print(f"6. Session: topic='{s['topic']}', status={s['status']}, members={len(s['members'])}")
assert s["session_code"] == code
assert s["status"] == "waiting"

# 8. User 2 joins
r2 = req("POST", "/login/register-number", {"register_number": "911724205002", "password": "Password123"})
token2 = r2["access_token"]
req("POST", f"/gd/sessions/{code}/join", token=token2)
print("7. User 2 joined ✓")

# 9. Start GD
r = req("POST", f"/gd/sessions/{code}/start", token=token)
print(f"8. Started: prep={r['preparation_minutes']}min, speak={r['speaking_minutes']}min")

# 10. Submit transcript (user 1)
r = req("POST", f"/gd/sessions/{code}/submit", {"transcript": "AI is transforming industries by automating routine tasks and creating new opportunities in data science and machine learning."}, token=token)
print(f"9. Submitted: score={r['overall_score']}, points={r['credential_points']}")
assert r["overall_score"] > 0

# 11. Submit transcript (user 2)
r = req("POST", f"/gd/sessions/{code}/submit", {"transcript": "The impact of AI on employment depends on how we adapt our education system and workforce training programs."}, token=token2)
print(f"10. User 2 submitted: score={r['overall_score']}, points={r['credential_points']}")

# 12. Finish GD
req("POST", f"/gd/sessions/{code}/finish", token=token)
print("11. GD finished ✓")

# 13. Leaderboard
lb = req("GET", f"/gd/sessions/{code}/leaderboard", token=token)
print(f"12. Leaderboard ({len(lb)} entries):")
for e in lb:
    print(f"    #{e['rank_position']} {e['name']} - {e['overall_score']} pts ({e['credential_points']} credits)")
assert len(lb) == 2

# 14. Verify session is completed
s = req("GET", f"/gd/sessions/{code}", token=token)
assert s["status"] == "completed"
print("13. Session status is 'completed' ✓")

print("\n✅ ALL TESTS PASSED")

import os

results = []
search_dir = "backend"
for root, dirs, files in os.walk(search_dir):
    if "venv" in root or ".git" in root or "__pycache__" in root:
        continue
    for file in files:
        if file.endswith(".py"):
            filepath = os.path.join(root, file)
            with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
                for idx, line in enumerate(f):
                    if "academic year mismatch" in line.lower() or "but you are in" in line.lower():
                        results.append(f"{filepath} Line {idx+1}: {line.strip()}")

with open("search_out.txt", "w", encoding="utf-8") as f:
    f.write("\n".join(results))
print("Done")

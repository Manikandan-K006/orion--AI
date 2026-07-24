with open("frontend/app/page.tsx", "r", encoding="utf-8") as f:
    lines = [f"Line {idx+1}: {line.strip()}" for idx, line in enumerate(f) if "loadgdlivesessions" in line.lower()]
with open("search_out.txt", "w", encoding="utf-8") as f:
    f.write("\n".join(lines))

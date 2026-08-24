from pathlib import Path

from backend.config import get_settings


def generate_pdf_report(session_id: int, student_name: str, score: float, summary: str) -> str:
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas

    settings = get_settings()
    report_dir = Path(settings.report_dir)
    report_dir.mkdir(parents=True, exist_ok=True)
    report_path = report_dir / f"interview_report_{session_id}.pdf"

    pdf = canvas.Canvas(str(report_path), pagesize=A4)
    width, height = A4
    pdf.setFont("Helvetica-Bold", 18)
    pdf.drawString(72, height - 72, "SpeakSense AI Interview Report")
    pdf.setFont("Helvetica", 12)
    pdf.drawString(72, height - 120, f"Student: {student_name}")
    pdf.drawString(72, height - 145, f"Session ID: {session_id}")
    pdf.drawString(72, height - 170, f"Overall Score: {score}/100")
    pdf.drawString(72, height - 210, "Summary:")
    text = pdf.beginText(72, height - 235)
    text.setFont("Helvetica", 11)
    for line in summary.split(". "):
        text.textLine(line.strip())
    pdf.drawText(text)
    pdf.save()
    return str(report_path)


def generate_gd_pdf_report(session_code: str, student_name: str, topic: str, score: float, summary: str) -> str:
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas

    settings = get_settings()
    report_dir = Path(settings.report_dir)
    report_dir.mkdir(parents=True, exist_ok=True)
    report_path = report_dir / f"gd_report_{session_code}.pdf"

    pdf = canvas.Canvas(str(report_path), pagesize=A4)
    width, height = A4
    pdf.setFont("Helvetica-Bold", 18)
    pdf.drawString(72, height - 72, "SpeakSense AI Group Discussion Report")
    pdf.setFont("Helvetica", 12)
    pdf.drawString(72, height - 110, f"Student: {student_name}")
    pdf.drawString(72, height - 130, f"Session Code: {session_code}")
    pdf.drawString(72, height - 150, f"Topic: {topic}")
    pdf.drawString(72, height - 170, f"Overall Score: {score}/100")
    pdf.drawString(72, height - 210, "Summary & Key Feedback:")
    text = pdf.beginText(72, height - 235)
    text.setFont("Helvetica", 11)
    for line in summary.split(". "):
        if line.strip():
            text.textLine("• " + line.strip())
    pdf.drawText(text)
    pdf.save()
    return str(report_path)


def generate_gd_live_pdf_report(session_code: str, student_name: str, topic: str, eval_data: dict) -> str:
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas
    from reportlab.lib import colors
    import re

    settings = get_settings()
    report_dir = Path(settings.report_dir)
    report_dir.mkdir(parents=True, exist_ok=True)
    report_path = report_dir / f"gd_live_report_{session_code}_{eval_data.get('user_id')}.pdf"

    pdf = canvas.Canvas(str(report_path), pagesize=A4)
    width, height = A4
    
    # Draw header with deep indigo background
    pdf.setFillColor(colors.HexColor("#1e1b4b")) # deep indigo
    pdf.rect(0, height - 120, width, 120, fill=True, stroke=False)
    
    # Title text
    pdf.setFillColor(colors.white)
    pdf.setFont("Helvetica-Bold", 20)
    pdf.drawString(54, height - 55, "Orion AI Group Discussion")
    pdf.setFont("Helvetica", 11)
    pdf.drawString(54, height - 76, f"Automated Speech Analytics & Performance Report")
    pdf.drawString(54, height - 94, f"Session Code: {session_code}")
    
    # Student and Topic Info
    pdf.setFillColor(colors.HexColor("#0f172a")) # Slate-900
    pdf.setFont("Helvetica-Bold", 12)
    pdf.drawString(54, height - 150, f"Student Name: {student_name}")
    pdf.setFont("Helvetica", 10)
    pdf.drawString(54, height - 170, f"Topic: {topic}")
    
    # Draw horizontal divider
    pdf.setStrokeColor(colors.HexColor("#e2e8f0"))
    pdf.setLineWidth(1)
    pdf.line(54, height - 185, width - 54, height - 185)
    
    # Score Section
    pdf.setFont("Helvetica-Bold", 13)
    pdf.drawString(54, height - 210, "Core Speaking Metrics")
    
    # Left Column metrics, Right Column metrics
    metrics_left = [
        ("Overall Score", f"{eval_data.get('overall_score', 0):.1f}%"),
        ("Grammar Score", f"{eval_data.get('grammar_score', 0):.1f}%"),
        ("Fluency Score", f"{eval_data.get('fluency_score', 0):.1f}%"),
        ("Accent/Clarity Score", f"{eval_data.get('accent_score', 0):.1f}%"),
        ("Vocabulary Score", f"{eval_data.get('content_quality', 0):.1f}%"),
        ("Topic Relevance", f"{eval_data.get('relevance_score', 0):.1f}%"),
    ]
    metrics_right = [
        ("Originality", f"{eval_data.get('originality_score', 85.0):.1f}%"),
        ("Critical Thinking", f"{eval_data.get('critical_thinking_score', 85.0):.1f}%"),
        ("Topic Understanding", f"{eval_data.get('topic_understanding_score', 85.0):.1f}%"),
        ("Confidence Score", f"{eval_data.get('confidence_score', 85.0):.1f}%"),
        ("Speech Speed (WPM)", f"{eval_data.get('speech_speed_wpm', 0)} WPM"),
        ("Filler Words Used", f"{eval_data.get('filler_words_count', 0)}"),
    ]
    
    y = height - 235
    for i, (label, val) in enumerate(metrics_left):
        pdf.setFont("Helvetica", 10)
        pdf.setFillColor(colors.HexColor("#475569"))
        pdf.drawString(54, y, label)
        pdf.setFont("Helvetica-Bold", 10)
        pdf.setFillColor(colors.HexColor("#0f172a"))
        pdf.drawString(180, y, val)
        y -= 20
        
    y = height - 235
    for i, (label, val) in enumerate(metrics_right):
        pdf.setFont("Helvetica", 10)
        pdf.setFillColor(colors.HexColor("#475569"))
        pdf.drawString(300, y, label)
        pdf.setFont("Helvetica-Bold", 10)
        pdf.setFillColor(colors.HexColor("#0f172a"))
        pdf.drawString(440, y, val)
        y -= 20
        
    # Transcript & Feedback divider
    y = height - 370
    pdf.line(54, y, width - 54, y)
    
    # Detailed Feedback
    y -= 20
    pdf.setFont("Helvetica-Bold", 13)
    pdf.drawString(54, y, "Qualitative Performance Feedback")
    
    y -= 20
    bullets = [
        ("Strengths", eval_data.get("strengths") or "Clear structure; smooth delivery; good flow of vocabulary."),
        ("Weaknesses", eval_data.get("weaknesses") or "Could expand on opposing views; slightly high usage of helper words."),
        ("Improvement Tips", eval_data.get("improvement_tips") or "Try debating structured scenarios solo; practice pacing to reduce fillers."),
        ("Recommendations", eval_data.get("recommendations") or "Keep speaking at this pace, practice structured arguments."),
        ("Missing Discussion Points", eval_data.get("missing_discussion_points") or "No critical topics missed.")
    ]
    
    for title, content in bullets:
        pdf.setFont("Helvetica-Bold", 10)
        pdf.setFillColor(colors.HexColor("#4338ca")) # Indigo-700
        pdf.drawString(54, y, f"{title}:")
        y -= 14
        pdf.setFont("Helvetica", 9)
        pdf.setFillColor(colors.HexColor("#334155")) # slate-700
        
        # Word wrap content lines
        words = str(content).split(" ")
        line = ""
        for w in words:
            if pdf.stringWidth(line + w, "Helvetica", 9) < (width - 108):
                line += w + " "
            else:
                pdf.drawString(54, y, line.strip())
                y -= 12
                line = w + " "
        if line:
            pdf.drawString(54, y, line.strip())
            y -= 14
            
        y -= 6
        
    # Save PDF
    pdf.save()
    return str(report_path)


def generate_overall_pdf_report(
    user_id: int,
    student_name: str,
    register_number: str,
    progress: dict,
    solo_history: list[dict],
    gd_sessions_completed: int,
) -> str:
    """Generate a comprehensive Overall Report & Analytics PDF for a student."""
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas
    from reportlab.lib import colors
    from datetime import datetime

    settings = get_settings()
    report_dir = Path(settings.report_dir)
    report_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    report_path = report_dir / f"overall_report_{user_id}_{timestamp}.pdf"

    pdf = canvas.Canvas(str(report_path), pagesize=A4)
    width, height = A4

    # ── Header bar ────────────────────────────────────────────────────
    pdf.setFillColor(colors.HexColor("#1e1b4b"))
    pdf.rect(0, height - 115, width, 115, fill=True, stroke=False)

    pdf.setFillColor(colors.white)
    pdf.setFont("Helvetica-Bold", 20)
    pdf.drawString(54, height - 50, "Orion AI — Overall Report & Analytics")
    pdf.setFont("Helvetica", 11)
    pdf.drawString(54, height - 70, "Comprehensive Communication Performance Summary")
    pdf.drawString(54, height - 88, f"Generated: {datetime.now().strftime('%d %B %Y, %I:%M %p')}")

    # ── Student info ───────────────────────────────────────────────────
    pdf.setFillColor(colors.HexColor("#0f172a"))
    pdf.setFont("Helvetica-Bold", 12)
    pdf.drawString(54, height - 140, f"Student Name  :  {student_name}")
    pdf.setFont("Helvetica", 11)
    pdf.drawString(54, height - 158, f"Register No   :  {register_number or 'N/A'}")

    # Divider
    pdf.setStrokeColor(colors.HexColor("#e2e8f0"))
    pdf.setLineWidth(1)
    pdf.line(54, height - 172, width - 54, height - 172)

    # ── Section: Key Metrics ───────────────────────────────────────────
    y = height - 200
    pdf.setFont("Helvetica-Bold", 13)
    pdf.setFillColor(colors.HexColor("#4338ca"))
    pdf.drawString(54, y, "Key Performance Metrics")

    y -= 22
    avg_score = float(progress.get("average_score") or 0)
    total_credits = float(progress.get("total_credits") or 0)
    total_sessions = int(progress.get("interviews_completed") or 0)
    solo_count = len(solo_history)

    kpi_items = [
        ("Overall Average Score", f"{avg_score:.1f}%"),
        ("Total Credential Points", f"{total_credits:.0f} pts"),
        ("Total Sessions Completed", str(total_sessions)),
        ("Solo AI Practice Sessions", str(solo_count)),
        ("GD Live Sessions Completed", str(gd_sessions_completed)),
    ]

    for label, value in kpi_items:
        pdf.setFont("Helvetica", 10)
        pdf.setFillColor(colors.HexColor("#475569"))
        pdf.drawString(64, y, f"•  {label}")
        pdf.setFont("Helvetica-Bold", 10)
        pdf.setFillColor(colors.HexColor("#0f172a"))
        pdf.drawString(300, y, value)
        y -= 18

    # ── Divider ────────────────────────────────────────────────────────
    y -= 6
    pdf.setStrokeColor(colors.HexColor("#e2e8f0"))
    pdf.line(54, y, width - 54, y)
    y -= 20

    # ── Section: Solo Practice History ────────────────────────────────
    if solo_history:
        pdf.setFont("Helvetica-Bold", 13)
        pdf.setFillColor(colors.HexColor("#4338ca"))
        pdf.drawString(54, y, "Solo Practice History (Most Recent 5 Sessions)")
        y -= 18

        headers = ["Session", "Overall", "Fluency", "Grammar", "Accent", "Delivery"]
        col_x = [54, 160, 235, 305, 375, 440]
        pdf.setFont("Helvetica-Bold", 9)
        pdf.setFillColor(colors.HexColor("#334155"))
        for i, h in enumerate(headers):
            pdf.drawString(col_x[i], y, h)
        y -= 14

        pdf.setStrokeColor(colors.HexColor("#cbd5e1"))
        pdf.line(54, y + 2, width - 54, y + 2)
        y -= 4

        for idx, sess in enumerate(solo_history[:5], start=1):
            pdf.setFont("Helvetica", 9)
            pdf.setFillColor(colors.HexColor("#0f172a"))
            row = [
                f"#{idx}",
                f"{float(sess.get('overall_score') or 0):.1f}%",
                f"{float(sess.get('fluency_score') or 0):.1f}%",
                f"{float(sess.get('grammar_score') or 0):.1f}%",
                f"{float(sess.get('accent_score') or 0):.1f}%",
                f"{float(sess.get('delivery_score') or 0):.1f}%",
            ]
            for i, cell in enumerate(row):
                pdf.drawString(col_x[i], y, cell)
            y -= 16
            if y < 100:
                pdf.showPage()
                y = height - 60

        y -= 10
        pdf.setStrokeColor(colors.HexColor("#e2e8f0"))
        pdf.line(54, y, width - 54, y)
        y -= 20

        # Latest session feedback
        latest = solo_history[0]
        if latest.get("weaknesses") or latest.get("improvement_tips"):
            pdf.setFont("Helvetica-Bold", 11)
            pdf.setFillColor(colors.HexColor("#4338ca"))
            pdf.drawString(54, y, "Latest Session AI Feedback")
            y -= 16

            for section_label, field in [("Weaknesses", "weaknesses"), ("Improvement Tips", "improvement_tips")]:
                content = latest.get(field)
                if not content:
                    continue
                pdf.setFont("Helvetica-Bold", 10)
                pdf.setFillColor(colors.HexColor("#334155"))
                pdf.drawString(64, y, f"{section_label}:")
                y -= 13
                pdf.setFont("Helvetica", 9)
                pdf.setFillColor(colors.HexColor("#475569"))
                words = str(content).split(" ")
                line = ""
                for w in words:
                    if pdf.stringWidth(line + w, "Helvetica", 9) < (width - 128):
                        line += w + " "
                    else:
                        pdf.drawString(72, y, line.strip())
                        y -= 12
                        line = w + " "
                        if y < 80:
                            pdf.showPage()
                            y = height - 60
                if line.strip():
                    pdf.drawString(72, y, line.strip())
                    y -= 14
                y -= 4
    else:
        pdf.setFont("Helvetica", 10)
        pdf.setFillColor(colors.HexColor("#94a3b8"))
        pdf.drawString(54, y, "No solo practice sessions completed yet.")
        y -= 30

    # ── Footer ─────────────────────────────────────────────────────────
    if y > 80:
        pdf.setStrokeColor(colors.HexColor("#e2e8f0"))
        pdf.line(54, 60, width - 54, 60)
        pdf.setFont("Helvetica", 8)
        pdf.setFillColor(colors.HexColor("#94a3b8"))
        pdf.drawString(54, 45, "This report was automatically generated by Orion AI — SpeakSense Communication Platform.")
        pdf.drawCentredString(width / 2, 32, f"Confidential | {student_name} | {datetime.now().strftime('%d %B %Y')}")

    pdf.save()
    return str(report_path)


def generate_gd_live_excel_report(session_code: str, evaluations: list[dict]) -> str:
    import pandas as pd
    settings = get_settings()
    report_dir = Path(settings.report_dir)
    report_dir.mkdir(parents=True, exist_ok=True)
    report_path = report_dir / f"gd_live_session_report_{session_code}.xlsx"
    
    data = []
    for ev in evaluations:
        data.append({
            "Session Code": session_code,
            "Team Number": ev.get("team_number"),
            "Student Register No": ev.get("register_number"),
            "Student Name": ev.get("name"),
            "Overall Score": ev.get("overall_score"),
            "Grammar Score": ev.get("grammar_score"),
            "Fluency Score": ev.get("fluency_score"),
            "Accent Clarity": ev.get("accent_score"),
            "Vocabulary Score": ev.get("content_quality"),
            "Topic Relevance": ev.get("relevance_score"),
            "Originality": ev.get("originality_score"),
            "Critical Thinking": ev.get("critical_thinking_score"),
            "Topic Understanding": ev.get("topic_understanding_score"),
            "Confidence": ev.get("confidence_score"),
            "WPM (Speech Speed)": ev.get("speech_speed_wpm"),
            "Filler Words Count": ev.get("filler_words_count"),
            "Pauses Count": ev.get("pauses_count"),
            "Strengths": ev.get("strengths"),
            "Weaknesses": ev.get("weaknesses"),
            "Improvement Tips": ev.get("improvement_tips")
        })
        
    df = pd.DataFrame(data)
    df.to_excel(report_path, index=False)
    return str(report_path)


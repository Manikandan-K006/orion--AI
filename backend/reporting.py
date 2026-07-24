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


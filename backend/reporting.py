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

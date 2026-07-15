import logging
import smtplib
from email.mime.text import MIMEText

from backend.config import get_settings

logger = logging.getLogger(__name__)


def send_invitation_email(to_email: str, to_name: str, from_name: str, session_code: str, topic: str) -> bool:
    settings = get_settings()
    if not settings.smtp_host or not settings.smtp_user:
        logger.warning("SMTP not configured, skipping email to %s", to_email)
        return False

    frontend_url = settings.frontend_url
    subject = f"GD Invitation: Join {from_name}'s Group Discussion"
    body = f"""Hi {to_name},

You've been invited by {from_name} to join a Group Discussion session!

Topic: {topic}
Session Code: {session_code}

Join here: {frontend_url}

Login with your register number and use the code above to join the session.

Happy discussing!
MZ Orator Team"""

    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = subject
    msg["From"] = settings.smtp_from_email or settings.smtp_user
    msg["To"] = to_email

    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as server:
            server.starttls()
            server.login(settings.smtp_user, settings.smtp_password)
            server.send_message(msg)
        logger.info("Invitation email sent to %s", to_email)
        return True
    except Exception as e:
        logger.error("Failed to send email to %s: %s", to_email, e)
        return False

import logging

from backend.config import get_settings

logger = logging.getLogger(__name__)


def send_invitation_email(to_email: str, to_name: str, from_name: str, session_code: str, topic: str) -> bool:
    settings = get_settings()
    if not settings.sendgrid_api_key:
        logger.warning("SENDGRID_API_KEY not configured, skipping email to %s", to_email)
        return False

    import sendgrid
    from sendgrid.helpers.mail import Mail

    frontend_url = settings.frontend_url
    subject = f"GD Invitation: {from_name} invited you to discuss {topic}"
    body = f"""Hi {to_name},

{from_name} has invited you to join a Group Discussion session!

Topic: {topic}
Session Code: {session_code}

Join here: {frontend_url}

Login with your register number, go to Dashboard and use the code above, or accept the invitation from the "Received Invitations" section.

Happy discussing!
MZ Orator Team"""

    message = Mail(
        from_email=settings.sendgrid_from_email,
        to_emails=to_email,
        subject=subject,
        plain_text_content=body,
    )

    try:
        sg = sendgrid.SendGridAPIClient(settings.sendgrid_api_key)
        response = sg.send(message)
        logger.info("Invitation email sent to %s (status: %s)", to_email, response.status_code)
        return 200 <= response.status_code < 300
    except Exception as e:
        logger.error("Failed to send email to %s: %s", to_email, e)
        return False

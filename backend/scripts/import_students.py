#!/usr/bin/env python
"""Import all student records from an Excel workbook into the database.

Usage:
    python -m backend.scripts.import_students <path-to-excel>

Example (run from project root):
    cd C:/Users/manii/OneDrive/Desktop/speaksense-ai-orion
    python -m backend.scripts.import_students C:/Users/manii/Downloads/Student_records.xlsx
"""
import logging
import sys

import pandas

from backend.app.services.student_import_service import import_students_from_excel

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("import_cli")


def print_summary(result: dict) -> None:
    sep = "-" * 36
    lines = [sep]
    for dept in sorted(result["dept_count"]):
        lines.append(f"{dept:<12}: {result['dept_count'][dept]} Students")
    lines.append(sep)
    lines.append(f"{'Total Imported':<12}: {result['imported']}")
    lines.append(f"{'Duplicates':<12}: {result['duplicates']}")
    lines.append(f"{'Errors':<12}: {len(result['errors'])}")
    lines.append(sep)

    if result["errors"]:
        lines.append("")
        lines.append("Validation Errors:")
        for err in result["errors"]:
            lines.append(f"  - {err}")

    print("\n".join(lines))


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    filepath = sys.argv[1]
    logger.info("Starting import from: %s", filepath)

    result = import_students_from_excel(filepath)
    print_summary(result)

    total_ok = result["imported"] + result["duplicates"]
    logger.info(
        "Import complete: %d imported, %d duplicates, %d errors (out of %d rows)",
        result["imported"],
        result["duplicates"],
        len(result["errors"]),
        result["total_read"],
    )


if __name__ == "__main__":
    main()

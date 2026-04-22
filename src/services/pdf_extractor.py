import base64
import fitz  # PyMuPDF


def get_page_count(pdf_bytes: bytes) -> int:
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    return doc.page_count


def render_page_to_base64(pdf_bytes: bytes, page_num: int, dpi: int = 150) -> str:
    """Render a single PDF page to a base64-encoded PNG.

    page_num is 1-based (matches user expectation); fitz uses 0-based indexing.
    """
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    if page_num < 1 or page_num > doc.page_count:
        raise ValueError(f"Page {page_num} out of range (1–{doc.page_count})")
    page = doc[page_num - 1]
    matrix = fitz.Matrix(dpi / 72, dpi / 72)
    pixmap = page.get_pixmap(matrix=matrix)
    return base64.b64encode(pixmap.tobytes("png")).decode()

"""Dependency-free text chunking used before embedding documents."""


def chunk_text(text: str, *, chunk_size: int = 1000, chunk_overlap: int = 150) -> list[str]:
    """Split text into overlapping chunks, preferring whitespace boundaries."""
    if chunk_size <= 0:
        raise ValueError("chunk_size must be greater than zero")
    if chunk_overlap < 0 or chunk_overlap >= chunk_size:
        raise ValueError("chunk_overlap must be at least zero and smaller than chunk_size")

    normalized = " ".join(text.split())
    if not normalized:
        return []

    chunks: list[str] = []
    start = 0
    text_length = len(normalized)
    while start < text_length:
        end = min(start + chunk_size, text_length)
        if end < text_length:
            boundary = normalized.rfind(" ", start + 1, end + 1)
            if boundary > start:
                end = boundary

        chunk = normalized[start:end].strip()
        if chunk:
            chunks.append(chunk)
        if end >= text_length:
            break
        next_start = end - chunk_overlap
        # Do not begin the next chunk in the middle of a word. If the overlap
        # falls inside one long token, preserve forward progress instead.
        if normalized[next_start] == " ":
            next_start += 1
        else:
            while next_start > start and normalized[next_start - 1] != " ":
                next_start -= 1
        start = next_start if next_start > start else end

    return chunks

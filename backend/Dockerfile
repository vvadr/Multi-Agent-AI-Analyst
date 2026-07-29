# Must satisfy `requires-python = ">=3.11,<3.14"` in pyproject.toml, and should
# match the interpreter Backend CI tests on (setup-python 3.13). A bump to
# 3.14 fails the build outright: pip refuses the install with
# "requires a different Python". Raise the constraint in pyproject.toml first,
# then this, then the CI Python version — in that order.
FROM python:3.13.5-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY pyproject.toml README.md alembic.ini ./
COPY app ./app
COPY migrations ./migrations
RUN python -m pip install --upgrade pip && python -m pip install .

RUN groupadd --system analyst \
    && useradd --system --gid analyst --home-dir /app --shell /usr/sbin/nologin analyst
USER analyst

EXPOSE 8000

CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]

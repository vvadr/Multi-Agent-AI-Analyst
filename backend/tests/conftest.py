import os

# Tests must never load the developer's real dotenv files.
os.environ["APP_ENV"] = "test"
os.environ.pop("ENV_FILE", None)


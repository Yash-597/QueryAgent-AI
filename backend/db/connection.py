import sqlite3
from sqlalchemy import create_engine
import os
from dotenv import load_dotenv

load_dotenv()

DB_PATH = os.getenv("DATABASE_PATH", "data/chinook.db")

def get_ro_connection():
    """Returns a read-only SQLite connection for query execution."""
    # The uri=True and ?mode=ro flags enforce read-only at the C-library level.
    abs_path = os.path.abspath(DB_PATH)
    return sqlite3.connect(f"file:{abs_path}?mode=ro", uri=True)

def get_inspection_engine():
    """Returns a SQLAlchemy engine strictly for schema reflection."""
    return create_engine(f"sqlite:///{DB_PATH}")
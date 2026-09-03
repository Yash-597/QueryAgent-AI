import sqlite3
from sqlalchemy import inspect
from backend.db.connection import get_inspection_engine, get_ro_connection

class DatabaseSchemaProvider:
    def __init__(self):
        self.engine = get_inspection_engine()
        self.inspector = inspect(self.engine)
        self._valid_tables = set(self.inspector.get_table_names())

    def get_table_names(self) -> list[str]:
        return list(self._valid_tables)

    def get_columns(self, table_name: str) -> list[dict]:
        """Returns column names and types for the interactive schema explorer."""
        if table_name not in self._valid_tables:
            return []
        try:
            return [
                {"name": col["name"], "type": str(col["type"])}
                for col in self.inspector.get_columns(table_name)
            ]
        except Exception:
            return []

    def get_table_schema(self, table_names: list[str] = None) -> str:
        """Returns DDL and sample rows for specified tables (or all if None)."""
        tables_to_inspect = table_names or self.get_table_names()
        schema_text = []

        with get_ro_connection() as conn:
            cursor = conn.cursor()
            
            for table in tables_to_inspect:
                # Validate table name against known tables to prevent injection
                if table not in self._valid_tables:
                    continue

                # 1. Get Table Creation DDL (parameterized query)
                cursor.execute(
                    "SELECT sql FROM sqlite_master WHERE type='table' AND name=?",
                    (table,)
                )
                create_stmt = cursor.fetchone()
                if create_stmt:
                    schema_text.append(f"{create_stmt[0]};")
                
                # 2. Get Sample Rows to help LLM understand data formats
                # Table name is safe here — validated against _valid_tables above
                try:
                    cursor.execute(f"SELECT * FROM [{table}] LIMIT 3")
                    rows = cursor.fetchall()
                    if rows:
                        columns = [description[0] for description in cursor.description]
                        schema_text.append(f"/* Sample rows for {table}:")
                        schema_text.append(f"   Columns: {', '.join(columns)}")
                        for row in rows:
                            schema_text.append(f"   {row}")
                        schema_text.append("*/\n")
                except sqlite3.Error:
                    continue

        return "\n".join(schema_text)
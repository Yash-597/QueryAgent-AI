import sqlglot
from sqlglot import exp

class SQLSecurityGuard:
    @staticmethod
    def validate_and_sanitize(sql: str, max_limit: int = 100) -> str:
        """
        Parses SQL to an AST. 
        Blocks mutations and auto-injects/caps LIMIT.
        Raises ValueError if invalid.
        """
        try:
            # Parse the query expecting SQLite dialect
            parsed = sqlglot.parse_one(sql, read="sqlite")
        except Exception as e:
            raise ValueError(f"Failed to parse SQL or multiple statements detected: {str(e)}")

        # 1. Enforce SELECT only
        if not isinstance(parsed, exp.Select):
            raise ValueError("Only SELECT queries are permitted.")

        # 2. Check for blocked expressions anywhere in the AST
        # (Defense in depth, though parsing as exp.Select catches most)
        for node in parsed.find_all(exp.Expression):
            if isinstance(node, (exp.Insert, exp.Update, exp.Delete, exp.Drop, exp.Alter, exp.Command)):
                raise ValueError("Mutation and DDL commands are strictly forbidden.")

        # 3. Auto-inject or cap LIMIT
        current_limit = parsed.args.get("limit")
        
        if current_limit is None:
            # Inject LIMIT 100
            parsed = parsed.limit(max_limit)
        else:
            # Cap existing LIMIT
            try:
                limit_val = int(current_limit.expression.name)
                if limit_val > max_limit:
                    parsed.args["limit"].set("expression", exp.Literal.number(max_limit))
            except (ValueError, AttributeError):
                # If limit is complex/dynamic, override it for safety
                parsed.args["limit"].set("expression", exp.Literal.number(max_limit))

        # Return sanitized SQL string
        return parsed.sql(dialect="sqlite")
import os
from pathlib import Path
from dotenv import load_dotenv

# Find and load .env from either backend/ or root folder
env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(dotenv_path=env_path)
load_dotenv() # Fallback for root .env

from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.types import interrupt

from backend.agent.state import AgentState
from backend.agent.prompts import QUERY_PLANNER_PROMPT, SQL_GENERATOR_PROMPT, RESULT_FORMATTER_PROMPT
from backend.db.schema import DatabaseSchemaProvider
from backend.db.security import SQLSecurityGuard
from backend.db.connection import get_ro_connection

# Initialize the Gemini Models for different tasks
api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")

planner_llm = ChatGoogleGenerativeAI(
    model=os.getenv("PLANNER_MODEL", os.getenv("GOOGLE_MODEL", "gemini-3.7-flash")),
    google_api_key=api_key,
    temperature=0
)

sql_llm = ChatGoogleGenerativeAI(
    model=os.getenv("SQL_MODEL", os.getenv("GOOGLE_MODEL", "gemini-3.7-flash")),
    google_api_key=api_key,
    temperature=0
)

formatter_llm = ChatGoogleGenerativeAI(
    model=os.getenv("FORMATTER_MODEL", os.getenv("GOOGLE_MODEL", "gemini-3.8-flash")),
    google_api_key=api_key,
    temperature=0
)
schema_provider = DatabaseSchemaProvider()

def schema_discovery_node(state: AgentState):
    return {"step": "schema_discovery", "schema_info": ", ".join(schema_provider.get_table_names()), "retry_count": state.get("retry_count", 0)}

def query_planner_node(state: AgentState):
    print("\n========== QUERY PLANNER START ==========")
    prompt = QUERY_PLANNER_PROMPT.format(
        user_query=state["user_query"],
        table_names=state["schema_info"]
    )
    print("Calling Gemini for query planning...")
    
    response = planner_llm.invoke([HumanMessage(content=prompt)])
    
    print("Gemini response received!")
    if isinstance(response.content, list):
        content_str = "".join(
            item["text"] if isinstance(item, dict) and "text" in item else str(item)
            for item in response.content
        )
    else:
        content_str = str(response.content)

    # Parse the comma-separated table names from the LLM response
    table_names = [t.strip() for t in content_str.strip().split(",") if t.strip()]
    print("Planned tables:", table_names)

    # Fetch the full DDL + sample rows for the relevant tables
    full_schema = schema_provider.get_table_schema(table_names)
    print("Schema info length:", len(full_schema))
    
    return {
        "step": "query_planner",
        "relevant_tables": table_names,
        "schema_info": full_schema
    }

def sql_generator_node(state: AgentState):
    # Build conversation history context for follow-up questions
    history = state.get("conversation_history") or []
    history_section = ""
    if history:
        lines = ["\nConversation History (use for context on follow-up questions):"]
        for h in history[-3:]:  # last 3 exchanges
            lines.append(f"  Q: {h['query']}")
            lines.append(f"  SQL: {h['sql']}")
            lines.append(f"  Result: {h['summary'][:200]}")
            lines.append("")
        history_section = "\n".join(lines)

    prompt = SQL_GENERATOR_PROMPT.format(
        user_query=state["user_query"],
        schema_info=state["schema_info"],
        history_section=history_section
    )

    if state.get("error"):
        import re
        error_msg = state['error']
        retry_block = f"\n\n⚠️ RETRY — Your previous query failed with this error:\n  {error_msg}\n"

        # "no such column" → extract the bad name and explicitly forbid it
        bad_col_match = re.search(r"no such column[: ]+([\w.]+)", error_msg, re.IGNORECASE)
        if bad_col_match:
            bad_col = bad_col_match.group(1)
            retry_block += (
                f"The column '{bad_col}' does NOT exist in the database.\n"
                f"You MUST ONLY use column names that are explicitly listed in "
                f"the Schema Context above. Do not guess, infer, or invent column names.\n"
                f"Re-read the schema carefully and rewrite the query using only real columns.\n"
            )
        else:
            retry_block += (
                "Fix the error and rewrite the query. "
                "Only use tables and columns that appear in the Schema Context.\n"
            )
        prompt += retry_block

    response = sql_llm.invoke([HumanMessage(content=prompt)])

    # Gemini may return content as a list of dictionaries
    if isinstance(response.content, list):
        content = "".join(
            item["text"]
            for item in response.content
            if isinstance(item, dict) and "text" in item
        )
    else:
        content = response.content

    print("SQL GENERATOR RESPONSE:", content)

    # Remove markdown code fences
    raw_sql = (
        content
        .replace("```sql", "")
        .replace("```", "")
        .strip()
    )

    print("GENERATED SQL:", raw_sql)

    return {
        "step": "sql_generator",
        "generated_sql": raw_sql
    }

def safety_validator_node(state: AgentState):
    try:
        sanitized_sql = SQLSecurityGuard.validate_and_sanitize(state["generated_sql"])
        return {"step": "safety_validator", "validation_result": "valid", "generated_sql": sanitized_sql, "error": ""}
    except Exception as e:
        return {"step": "safety_validator", "validation_result": "invalid", "error": str(e), "retry_count": state.get("retry_count", 0) + 1}

def human_review_node(state: AgentState):
    decision = interrupt({"sql": state["generated_sql"], "message": "Approve or edit this query."})
    
    if decision.get("approved"):
        return {"step": "human_review", "generated_sql": decision.get("edited_sql", state["generated_sql"]), "error": ""}
    return {"step": "human_review", "error": f"Rejected: {decision.get('feedback')}", "retry_count": state.get("retry_count", 0) + 1}

def query_executor_node(state: AgentState):
    print("\n========== QUERY EXECUTOR START ==========")
    print("SQL:", state["generated_sql"])

    try:
        print("1. Opening read-only connection...")

        with get_ro_connection() as conn:
            print("2. Connection opened")

            cursor = conn.cursor()

            print("3. Executing SQL...")
            cursor.execute(state["generated_sql"])

            print("4. SQL executed successfully")

            rows = cursor.fetchall()

            print("5. Rows fetched:", rows)

            columns = [desc[0] for desc in cursor.description]

            result_str = (
                f"Columns: {columns}\n"
                f"Rows: {rows}"
            )

            # Build structured results for frontend table rendering
            serialized_rows = [
                [str(cell) if cell is not None else "" for cell in row]
                for row in rows
            ]

            print("6. Result created")
            print("========== QUERY EXECUTOR END ==========\n")

            return {
                "step": "query_executor",
                "query_results": result_str,
                "raw_results": {"columns": columns, "rows": serialized_rows},
                "error": ""
            }

    except Exception as e:
        print("!!! QUERY EXECUTOR ERROR:", e)

        return {
            "step": "query_executor",
            "error": str(e),
            "retry_count": state.get("retry_count", 0) + 1
        }

def result_formatter_node(state: AgentState):
    print("\n========== RESULT FORMATTER START ==========")

    # ── Hard failure after max retries ──
    if state.get("error") and state.get("retry_count", 0) >= 3:
        return {
            "step": "result_formatter",
            "messages": [{"role": "system", "content": f"❌ Query failed after 3 retries.\n\n**Error:** {state['error']}"}]
        }

    # ── Empty result set — no need to call the LLM ──
    raw = state.get("raw_results") or {}
    if isinstance(raw.get("rows"), list) and len(raw["rows"]) == 0:
        sql = state.get("generated_sql", "")
        msg = (
            "The query ran successfully but returned **no results**.\n\n"
            "Possible reasons:\n"
            "- The data you're looking for doesn't exist in the database\n"
            "- A filter or condition was too restrictive\n"
            "- The column used for filtering may not contain that value\n\n"
            f"You can open the **SQL** tab to review the exact query that was executed."
        )
        return {
            "step": "result_formatter",
            "raw_results": raw,
            "generated_sql": sql,
            "conversation_history": list(state.get("conversation_history") or []),
            "messages": [{"role": "system", "content": msg}]
        }

    prompt = RESULT_FORMATTER_PROMPT.format(
        user_query=state["user_query"],
        generated_sql=state["generated_sql"],
        query_results=state["query_results"]
    )

    print("Calling Gemini formatter...")

    response = formatter_llm.invoke([
        HumanMessage(content=prompt)
    ])

    print("Formatter response type:", type(response.content))
    print("Formatter response:", response.content)

    # Gemini can return content as a list of blocks
    if isinstance(response.content, list):
        text_parts = []

        for item in response.content:
            if isinstance(item, str):
                text_parts.append(item)

            elif isinstance(item, dict) and "text" in item:
                text_parts.append(item["text"])

        formatted_text = "".join(text_parts)

    else:
        formatted_text = str(response.content)

    print("FINAL FORMATTER TEXT:", formatted_text)

    # Persist this exchange to conversation history for multi-turn memory
    history = list(state.get("conversation_history") or [])
    history.append({
        "query": state.get("user_query", ""),
        "sql": state.get("generated_sql", ""),
        "summary": formatted_text[:300]   # keep summary short for prompt context
    })

    return {
        "step": "result_formatter",
        "raw_results": state.get("raw_results", {}),
        "generated_sql": state.get("generated_sql", ""),
        "conversation_history": history[-5:],  # retain last 5 exchanges
        "messages": [
            {"role": "system", "content": formatted_text}
        ]
    }
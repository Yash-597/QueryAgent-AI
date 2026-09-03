from typing import TypedDict, Annotated
from langgraph.graph.message import add_messages
from langchain_core.messages import AnyMessage

class AgentState(TypedDict):
    messages: Annotated[list[AnyMessage], add_messages]
    user_query: str
    schema_info: str
    relevant_tables: list[str]
    generated_sql: str
    validation_result: str
    query_results: str
    raw_results: dict          # {"columns": [...], "rows": [...]} for frontend tables
    conversation_history: list # [{"query","sql","summary"}, ...] for multi-turn memory
    error: str
    step: str
    retry_count: int
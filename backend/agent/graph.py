from langgraph.graph import StateGraph, START, END
from langgraph.checkpoint.memory import MemorySaver
from backend.agent.state import AgentState
from backend.agent.nodes import (
    schema_discovery_node, query_planner_node, sql_generator_node,
    safety_validator_node, human_review_node, query_executor_node, result_formatter_node
)

def route_after_validation(state: AgentState):
    if state["validation_result"] == "valid": return "human_review"
    if state["retry_count"] >= 3: return "result_formatter"
    return "sql_generator"

def route_after_review(state: AgentState):
    return "query_executor" if not state.get("error") else "sql_generator"

def route_after_execution(state: AgentState):
    print("\n========== ROUTE AFTER EXECUTION ==========")
    print("ERROR:", state.get("error"))
    print("RETRY COUNT:", state.get("retry_count"))
    
    if not state.get("error") or state["retry_count"] >= 3:
        print("ROUTING → result_formatter")
        return "result_formatter"

    print("ROUTING → sql_generator")
    return "sql_generator"

def build_graph():
    builder = StateGraph(AgentState)
    
    nodes = {
        "schema_discovery": schema_discovery_node, "query_planner": query_planner_node,
        "sql_generator": sql_generator_node, "safety_validator": safety_validator_node,
        "human_review": human_review_node, "query_executor": query_executor_node,
        "result_formatter": result_formatter_node
    }
    for name, func in nodes.items(): builder.add_node(name, func)
    
    builder.add_edge(START, "schema_discovery")
    builder.add_edge("schema_discovery", "query_planner")
    builder.add_edge("query_planner", "sql_generator")
    builder.add_edge("sql_generator", "safety_validator")
    
    builder.add_conditional_edges("safety_validator", route_after_validation)
    builder.add_conditional_edges("human_review", route_after_review)
    builder.add_conditional_edges("query_executor", route_after_execution)
    builder.add_edge("result_formatter", END)
    
    return builder.compile(checkpointer=MemorySaver())
import json
import asyncio
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional

from backend.agent.graph import build_graph
from backend.db.schema import DatabaseSchemaProvider
from langgraph.types import Command

# Initialize the FastAPI app
app = FastAPI(title="Intelligent SQL Agent API")

# Allow the frontend to communicate with the backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # For local development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize our singletons
agent_graph = build_graph()
schema_provider = DatabaseSchemaProvider()

# --- Pydantic Models for Request Validation ---
class ChatRequest(BaseModel):
    message: str
    thread_id: str

class ResumeRequest(BaseModel):
    thread_id: str
    approved: bool
    edited_sql: Optional[str] = None
    feedback: Optional[str] = None

# --- Standard REST Endpoints ---
@app.get("/api/health")
async def health_check():
    return {"status": "healthy", "agent": "ready"}

@app.get("/api/schema")
async def get_schema():
    """Returns the list of tables for the frontend Schema Explorer."""
    try:
        return {"tables": schema_provider.get_table_names()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- SSE Streaming Endpoints ---
@app.post("/api/chat/stream")
async def chat_stream(request: ChatRequest):
    """Starts the LangGraph agent and streams node updates to the frontend."""
    async def event_generator():
        # The thread_id allows LangGraph's MemorySaver to track this specific conversation
        config = {"configurable": {"thread_id": request.thread_id}}
        initial_state = {"user_query": request.message, "messages": []}
        
        try:
            # astream() executes the graph asynchronously and yields updates
            async for event in agent_graph.astream(initial_state, config, stream_mode="updates"):
                # Handle standard node updates
                for node_name, node_state in event.items():
                    # SSE format strictly requires 'data: {json_payload}\n\n'
                    yield f"data: {json.dumps({'type': 'node_update', 'node': node_name, 'state': node_state})}\n\n"
                    await asyncio.sleep(0.05) # Tiny sleep to force buffer flush
                    
            yield "data: {\"type\": \"done\"}\n\n"
            
        except Exception as e:
            # If the graph hits an interrupt(), it throws a specific error in LangGraph 0.2.x
            # We catch it, or standard errors, and pass them to the UI.
            yield f"data: {json.dumps({'type': 'interrupt_or_error', 'message': str(e)})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")

@app.post("/api/chat/resume")
async def chat_resume(request: ResumeRequest):
    """Resumes the graph execution after the Human-in-the-Loop decision."""
    config = {"configurable": {"thread_id": request.request_id if hasattr(request, 'request_id') else request.thread_id}}
    
    # Package the human's decision
    resume_data = {
        "approved": request.approved,
        "edited_sql": request.edited_sql,
        "feedback": request.feedback
    }
    
    async def resume_generator():
        try:
            # We use Command(resume=...) to tell LangGraph to wake up and continue
            async for event in agent_graph.astream(Command(resume=resume_data), config, stream_mode="updates"):
                for node_name, node_state in event.items():
                    yield f"data: {json.dumps({'type': 'node_update', 'node': node_name, 'state': node_state})}\n\n"
                    await asyncio.sleep(0.05)
            yield "data: {\"type\": \"done\"}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(resume_generator(), media_type="text/event-stream")
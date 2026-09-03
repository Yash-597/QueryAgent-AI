# QueryAgent AI: Autonomous NL2SQL Agent

![Python](https://img.shields.io/badge/Python-3.11+-blue.svg)
![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688.svg)
![LangGraph](https://img.shields.io/badge/LangGraph-0.2+-orange.svg)
![Gemini](https://img.shields.io/badge/Gemini-Pro-blue)

An autonomous, self-correcting AI agent that securely translates natural language into executed SQL queries. Built using a multi-agent **LangGraph** pipeline, **FastAPI**, and **Google Gemini**, this project allows users to chat with their database in plain English, visualize results instantly, and maintain a secure, read-only environment.

---

## ✨ Key Features

* **🧠 Multi-Agent Pipeline:** Utilizes a dynamic 7-node state machine (Schema Discovery → Planning → Generation → Validation → Review → Execution → Formatting) powered by LangGraph.
* **🛡️ Self-Correcting Execution & Security:** Parses SQL via Abstract Syntax Trees (using SQLGlot) to block mutations (`DROP`, `UPDATE`, etc.) and automatically injects `LIMIT` constraints. Any SQLite execution errors are automatically routed back to the LLM for iterative self-debugging.
* **👤 Human-in-the-Loop (HITL):** Pauses execution via LangGraph interrupts, allowing users to review, edit, and approve generated SQL in a syntax-highlighted editor before execution.
* **⚡ Real-Time SSE Backend:** Uses Server-Sent Events (SSE) to stream complex agent state updates and typing effects in real-time to the client.
* **📊 Interactive Data UI:** Features auto-generated Chart.js data visualizations, sortable tables, CSV/JSON exports, and an interactive schema explorer.
* **🔄 Multi-Turn Memory:** Maintains conversation history and schema metadata in the agent state, enabling context-aware follow-up queries.

---

## 🛠️ Tech Stack

* **AI & Orchestration:** LangGraph, LangChain, Google Gemini API
* **Backend & API:** Python, FastAPI, Uvicorn, Server-Sent Events (SSE)
* **Database & Security:** SQLite, SQLAlchemy, SQLGlot (AST Parsing)
* **Frontend:** Vanilla JavaScript, HTML/CSS, Chart.js, Marked.js, Highlight.js

---

## 🚀 Getting Started

### 1. Prerequisites
* Python 3.11 or higher
* A Google Gemini API Key

### 2. Clone the Repository
```bash
git clone https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
cd sql-agent
```

### 3. Install Dependencies
```bash
# It is recommended to use a virtual environment
python -m venv venv
source venv/bin/activate  # On Windows use: venv\Scripts\activate

pip install -r backend/requirements.txt
```

### 4. Environment Variables
Create a `.env` file in the `backend/` directory and add your Gemini API Key:
```env
# backend/.env
GEMINI_API_KEY="your_api_key_here"

# Optional Model Configuration (defaults shown)
GOOGLE_MODEL=gemini-3.7-flash
PLANNER_MODEL=gemini-3.5-flash
SQL_MODEL=gemini-3.7-flash
FORMATTER_MODEL=gemini-3.6-flash
DATABASE_PATH=backend/data/chinook.db
```

### 5. Run the Application
Start the FastAPI backend server:
```bash
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

Once the server is running, simply open `frontend/index.html` in your web browser. No frontend build step is required!

---

## 📂 Project Structure

```
sql-agent/
│
├── backend/
│   ├── agent/
│   │   ├── graph.py       # LangGraph state machine definition
│   │   ├── nodes.py       # Agent node functions (planner, generator, etc.)
│   │   ├── prompts.py     # System prompts for LLMs
│   │   └── state.py       # TypedDict for AgentState
│   ├── data/
│   │   └── chinook.db     # Sample SQLite database
│   ├── db/
│   │   ├── connection.py  # Read-only SQLite connection logic
│   │   ├── schema.py      # SQLAlchemy inspector & schema fetching
│   │   └── security.py    # SQLGlot AST parsing and sanitization
│   ├── main.py            # FastAPI endpoints (SSE streams & API)
│   └── requirements.txt
│
└── frontend/
    ├── index.html         # Main UI layout
    ├── styles.css         # Custom UI styling & themes
    └── app.js             # Vanilla JS client for SSE and DOM manipulation
```

---

## 🤝 Contributing
Contributions, issues, and feature requests are welcome! Feel free to check the issues page.

## 📝 License
This project is [MIT](LICENSE) licensed.

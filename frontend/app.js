// ── Constants ──────────────────────────────────────────────────────────────
const API_BASE = 'http://localhost:8000';
const currentThreadId = crypto.randomUUID();
const chatHistory   = document.getElementById('chat-history');
const inspectorPanel = document.getElementById('inspector-panel');
const sqlEditor      = document.getElementById('sql-editor');

let pendingSql   = '';
let allSchemaData = [];

// ── Markdown (marked.js, compatible with v4 + v5+) ────────────────────────
try {
    if (typeof marked !== 'undefined') {
        if (typeof marked.use === 'function') marked.use({ breaks: true, gfm: true });
        else if (typeof marked.setOptions === 'function') marked.setOptions({ breaks: true, gfm: true });
    }
} catch (e) { console.warn('marked config:', e); }

function renderMarkdown(text) {
    try { return marked.parse(text); }
    catch (_) {
        return text
            .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
            .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
            .replace(/\*(.+?)\*/g,'<em>$1</em>')
            .replace(/\n/g,'<br>');
    }
}

// ── Schema Explorer ────────────────────────────────────────────────────────
async function loadSchema() {
    try {
        const res  = await fetch(`${API_BASE}/api/schema`);
        const data = await res.json();
        allSchemaData = data.tables;   // [{name, columns:[{name,type}]}]
        document.getElementById('schema-count').textContent = `${allSchemaData.length} tables`;
        renderSchemaExplorer(allSchemaData);
        wireSchemaSearch();
    } catch (e) {
        document.getElementById('schema-list').innerHTML = '<li class="schema-error">⚠ Could not load schema</li>';
    }
}

function renderSchemaExplorer(tables) {
    const list = document.getElementById('schema-list');
    list.innerHTML = '';

    if (tables.length === 0) {
        list.innerHTML = '<li class="schema-error">No tables match</li>';
        return;
    }

    tables.forEach(table => {
        const li = document.createElement('li');
        li.className = 'schema-table-item';

        // ── Header row ──
        const header = document.createElement('div');
        header.className = 'schema-table-header';
        header.innerHTML = `
            <span class="schema-chevron">▶</span>
            <span class="schema-table-name">⊞ ${table.name}</span>
            <button class="schema-query-btn" title="Query this table">↗</button>
        `;

        // ── Column list (hidden until expanded) ──
        const colList = document.createElement('ul');
        colList.className = 'schema-column-list';

        (table.columns || []).forEach(col => {
            const colLi = document.createElement('li');
            colLi.className = 'schema-col-item';
            colLi.innerHTML = `<span class="col-name">${col.name}</span><span class="col-type">${col.type}</span>`;
            colList.appendChild(colLi);
        });

        // Toggle expand / collapse
        header.addEventListener('click', e => {
            if (e.target.closest('.schema-query-btn')) return;
            const open = li.classList.toggle('open');
            header.querySelector('.schema-chevron').textContent = open ? '▼' : '▶';
        });

        // "↗" fills the chat input
        header.querySelector('.schema-query-btn').addEventListener('click', e => {
            e.stopPropagation();
            const input = document.getElementById('chat-input');
            input.value = `Show me the first 10 rows of ${table.name}`;
            input.focus();
        });

        li.appendChild(header);
        li.appendChild(colList);
        list.appendChild(li);
    });
}

function wireSchemaSearch() {
    document.getElementById('schema-search').addEventListener('input', e => {
        const q = e.target.value.toLowerCase().trim();
        const filtered = q
            ? allSchemaData.filter(t =>
                t.name.toLowerCase().includes(q) ||
                (t.columns || []).some(c => c.name.toLowerCase().includes(q))
              )
            : allSchemaData;
        renderSchemaExplorer(filtered);
    });
}

// ── Message helpers ────────────────────────────────────────────────────────
function appendMessage(role, text, id = null) {
    const div = document.createElement('div');
    div.className = `message msg-${role}`;
    div.innerText  = text;
    if (id) div.id = id;
    chatHistory.appendChild(div);
    chatHistory.scrollTop = chatHistory.scrollHeight;
}

// ── Export (CSV / JSON) ────────────────────────────────────────────────────
function exportCSV(columns, rows) {
    const header = columns.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',');
    const body   = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(','));
    download(new Blob([[header, ...body].join('\n')], { type:'text/csv;charset=utf-8;' }), 'results.csv');
}

function exportJSON(columns, rows) {
    const data = rows.map(row => Object.fromEntries(columns.map((c, i) => [c, row[i]])));
    download(new Blob([JSON.stringify(data, null, 2)], { type:'application/json' }), 'results.json');
}

function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a   = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ── Copy to clipboard ──────────────────────────────────────────────────────
function copyToClipboard(text, btn) {
    const original = btn.textContent;
    const reset = () => { btn.textContent = original; btn.classList.remove('copied'); };

    navigator.clipboard.writeText(text)
        .then(() => { btn.textContent = '✓ Copied!'; btn.classList.add('copied'); setTimeout(reset, 2000); })
        .catch(() => {
            // fallback for non-HTTPS
            const ta = Object.assign(document.createElement('textarea'), { value: text });
            Object.assign(ta.style, { position:'fixed', opacity:'0' });
            document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
            btn.textContent = '✓ Copied!'; btn.classList.add('copied'); setTimeout(reset, 2000);
        });
}

// ── Chart (Chart.js) ──────────────────────────────────────────────────────
function isNum(v) { return v !== '' && v !== null && !isNaN(parseFloat(v)) && isFinite(parseFloat(v)); }

function buildChartPanel(columns, rows) {
    if (!columns || rows.length === 0) return noChartMsg('No data to chart.');

    const sample = rows.slice(0, Math.min(rows.length, 15));

    // Classify each column: numeric or categorical
    const numericIdxs   = columns.map((_, i) => sample.filter(r => isNum(r[i])).length >= sample.length * 0.8 ? i : -1).filter(i => i >= 0);
    const categoricalIdxs = columns.map((_, i) => i).filter(i => !numericIdxs.includes(i));

    if (numericIdxs.length === 0) return noChartMsg('No numeric column detected — cannot render chart.');

    const labelIdx = categoricalIdxs[0] ?? (numericIdxs[0] === 0 ? 1 : 0);
    const dataIdx  = numericIdxs[0];

    const labels  = rows.map(r => String(r[labelIdx] ?? '').substring(0, 28));
    const data    = rows.map(r => parseFloat(r[dataIdx]) || 0);
    const horiz   = rows.length > 10;

    // Gradient color palette
    const palette = data.map((_, i) => `hsla(${(210 + i * 22) % 360}, 70%, 60%, 0.8)`);

    const wrapper = document.createElement('div');
    wrapper.className = 'chart-wrapper';
    const canvas  = document.createElement('canvas');
    wrapper.appendChild(canvas);

    // Delay until canvas is in DOM
    setTimeout(() => {
        try {
            new Chart(canvas, {
                type: 'bar',
                data: {
                    labels,
                    datasets: [{
                        label: columns[dataIdx],
                        data,
                        backgroundColor: palette,
                        borderColor: palette.map(c => c.replace('0.8)', '1)')),
                        borderWidth: 1,
                        borderRadius: horiz ? 3 : 5,
                    }]
                },
                options: {
                    indexAxis: horiz ? 'y' : 'x',
                    responsive: true,
                    maintainAspectRatio: true,
                    plugins: {
                        legend: { labels: { color: '#e2e8f0', font: { family: 'Inter', size: 12 } } },
                        tooltip: {
                            backgroundColor: 'rgba(10,14,26,0.95)',
                            titleColor: '#e2e8f0', bodyColor: '#94a3b8',
                            borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1,
                        }
                    },
                    scales: {
                        x: { ticks: { color: '#94a3b8', font: { size: 11 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
                        y: { ticks: { color: '#94a3b8', font: { size: 11 } }, grid: { color: 'rgba(255,255,255,0.04)' } }
                    }
                }
            });
        } catch (e) {
            wrapper.innerHTML = `<div class="chart-no-data">Chart error: ${e.message}</div>`;
        }
    }, 80);

    return wrapper;
}

function noChartMsg(msg) {
    const d = document.createElement('div');
    d.className = 'chart-no-data';
    d.textContent = msg;
    return d;
}

// ── Result Card (tabbed) ───────────────────────────────────────────────────
function buildResultCard(content, rawResults, sql) {
    const container = document.createElement('div');
    container.className = 'message msg-system result-card';

    const tabBar = document.createElement('div');
    tabBar.className = 'result-tabs';

    const tabs      = [];
    const panels    = [];
    const lazyInits = [];  // functions called lazily on first tab-click

    // ── 1. Summary tab ──
    const summaryPanel = document.createElement('div');
    summaryPanel.className = 'result-panel active';
    summaryPanel.innerHTML = renderMarkdown(content || 'No result generated.');
    tabs.push(makeTab('💬 Summary', true));
    panels.push(summaryPanel);
    lazyInits.push(null);

    // ── 2. Table tab ──
    const hasTable = rawResults?.columns?.length > 0 && rawResults?.rows?.length > 0;
    if (hasTable) {
        const tablePanel = document.createElement('div');
        tablePanel.className = 'result-panel';
        tablePanel.appendChild(buildDataTable(rawResults.columns, rawResults.rows));
        tabs.push(makeTab(`📊 Table (${rawResults.rows.length})`, false));
        panels.push(tablePanel);
        lazyInits.push(null);
    }

    // ── 3. Chart tab ──
    if (hasTable) {
        const chartPanel = document.createElement('div');
        chartPanel.className = 'result-panel chart-panel-wrap';
        let chartBuilt = false;
        tabs.push(makeTab('📈 Chart', false));
        panels.push(chartPanel);
        lazyInits.push(() => {
            if (!chartBuilt) {
                chartBuilt = true;
                chartPanel.appendChild(buildChartPanel(rawResults.columns, rawResults.rows));
            }
        });
    }

    // ── 4. SQL tab ──
    if (sql) {
        const sqlPanel = document.createElement('div');
        sqlPanel.className = 'result-panel';

        const sqlHeader = document.createElement('div');
        sqlHeader.className = 'sql-panel-header';
        const copyBtn = document.createElement('button');
        copyBtn.className = 'copy-btn-sm';
        copyBtn.textContent = '📋 Copy';
        copyBtn.addEventListener('click', () => copyToClipboard(sql, copyBtn));
        sqlHeader.appendChild(copyBtn);

        const pre  = document.createElement('pre');
        const code = document.createElement('code');
        code.className   = 'language-sql';
        code.textContent = sql;
        pre.appendChild(code);

        if (typeof hljs !== 'undefined') hljs.highlightElement(code);

        sqlPanel.appendChild(sqlHeader);
        sqlPanel.appendChild(pre);
        tabs.push(makeTab('🔧 SQL', false));
        panels.push(sqlPanel);
        lazyInits.push(null);
    }

    // Wire tab switching
    tabs.forEach((tab, i) => {
        tab.addEventListener('click', () => {
            tabs.forEach(t   => t.classList.remove('active'));
            panels.forEach(p => p.classList.remove('active'));
            tab.classList.add('active');
            panels[i].classList.add('active');
            if (lazyInits[i]) lazyInits[i]();
        });
        tabBar.appendChild(tab);
    });

    container.appendChild(tabBar);
    panels.forEach(p => container.appendChild(p));
    return container;
}

function makeTab(label, isActive) {
    const btn = document.createElement('button');
    btn.className   = 'result-tab' + (isActive ? ' active' : '');
    btn.textContent = label;
    return btn;
}

// ── Data Table ─────────────────────────────────────────────────────────────
function buildDataTable(columns, rows) {
    const wrapper = document.createElement('div');
    wrapper.className = 'table-wrapper';

    // ── Toolbar (Export buttons) ──
    const toolbar = document.createElement('div');
    toolbar.className = 'table-toolbar';

    const csvBtn = makeExportBtn('⬇ CSV', 'Export as CSV', () => exportCSV(columns, rows));
    const jsnBtn = makeExportBtn('⬇ JSON', 'Export as JSON', () => exportJSON(columns, rows));
    toolbar.append(csvBtn, jsnBtn);
    wrapper.appendChild(toolbar);

    // ── Table ──
    const table = document.createElement('table');
    table.className = 'data-table';

    const thead = document.createElement('thead');
    const hRow  = document.createElement('tr');
    let sortCol = -1, sortAsc = true;

    columns.forEach((col, idx) => {
        const th = document.createElement('th');
        th.textContent = col;
        th.title = 'Click to sort';
        th.addEventListener('click', () => {
            if (sortCol === idx) sortAsc = !sortAsc;
            else { sortCol = idx; sortAsc = true; }
            hRow.querySelectorAll('th').forEach(h => h.classList.remove('sort-asc','sort-desc'));
            th.classList.add(sortAsc ? 'sort-asc' : 'sort-desc');
            const sorted = [...rows].sort((a, b) => {
                const na = parseFloat(a[idx]), nb = parseFloat(b[idx]);
                if (!isNaN(na) && !isNaN(nb)) return sortAsc ? na - nb : nb - na;
                return sortAsc ? String(a[idx]).localeCompare(String(b[idx])) : String(b[idx]).localeCompare(String(a[idx]));
            });
            renderRows(tbody, sorted);
        });
        hRow.appendChild(th);
    });
    thead.appendChild(hRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    renderRows(tbody, rows);
    table.appendChild(tbody);

    const badge = document.createElement('div');
    badge.className   = 'table-badge';
    badge.textContent = `${rows.length} row${rows.length !== 1 ? 's' : ''} returned`;

    wrapper.append(table, badge);
    return wrapper;
}

function makeExportBtn(label, title, onClick) {
    const btn = document.createElement('button');
    btn.className = 'export-btn';
    btn.textContent = label;
    btn.title = title;
    btn.addEventListener('click', onClick);
    return btn;
}

function renderRows(tbody, rows) {
    tbody.innerHTML = '';
    rows.forEach((row, rIdx) => {
        const tr = document.createElement('tr');
        tr.style.animationDelay = `${Math.min(rIdx * 18, 400)}ms`;
        row.forEach(cell => {
            const td = document.createElement('td');
            td.textContent = cell;
            if (isNum(cell)) td.classList.add('numeric');
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });
}

// ── Step Progress ──────────────────────────────────────────────────────────
const PIPELINE_STEPS = [
    { key:'schema_discovery', label:'Schema',   icon:'🗂️' },
    { key:'query_planner',    label:'Planning', icon:'🧠' },
    { key:'sql_generator',    label:'SQL Gen',  icon:'⚙️' },
    { key:'safety_validator', label:'Validate', icon:'🛡️' },
    { key:'human_review',     label:'Review',   icon:'👤' },
    { key:'query_executor',   label:'Execute',  icon:'▶️' },
    { key:'result_formatter', label:'Format',   icon:'✨' },
];

function buildStepProgress() {
    const container = document.createElement('div');
    container.className = 'step-progress';
    PIPELINE_STEPS.forEach((s, i) => {
        const step = document.createElement('div');
        step.className    = 'step-item';
        step.dataset.key  = s.key;
        step.innerHTML    = `<div class="step-icon">${s.icon}</div><div class="step-label">${s.label}</div>`;
        container.appendChild(step);
        if (i < PIPELINE_STEPS.length - 1) {
            const conn = document.createElement('div');
            conn.className = 'step-connector';
            container.appendChild(conn);
        }
    });
    return container;
}

function updateStepProgress(container, activeNode) {
    const items = container.querySelectorAll('.step-item');
    const conns = container.querySelectorAll('.step-connector');
    let passed  = false;
    items.forEach((item, i) => {
        item.classList.remove('active','completed');
        conns[i - 1]?.classList.remove('completed');
        if (item.dataset.key === activeNode) { item.classList.add('active'); passed = true; }
        else if (!passed)                    { item.classList.add('completed'); conns[i-1]?.classList.add('completed'); }
    });
}

// ── Stream Graph ───────────────────────────────────────────────────────────
async function streamGraph(endpoint, bodyData) {
    const progressWrapper = document.createElement('div');
    progressWrapper.className = 'message msg-system';
    const stepProgress    = buildStepProgress();
    progressWrapper.appendChild(stepProgress);
    chatHistory.appendChild(progressWrapper);
    chatHistory.scrollTop = chatHistory.scrollHeight;

    let latestRaw = null;
    let latestSql = null;

    try {
        const resp   = await fetch(`${API_BASE}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bodyData)
        });
        const reader  = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer    = '';

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n\n');
            buffer = lines.pop();

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                let data;
                try { data = JSON.parse(line.substring(6)); } catch { continue; }

                if (data.type === 'node_update') {
                    updateStepProgress(stepProgress, data.node);
                    chatHistory.scrollTop = chatHistory.scrollHeight;

                    if (data.state.generated_sql) { pendingSql = data.state.generated_sql; latestSql = data.state.generated_sql; }
                    if (data.state.raw_results)    latestRaw  = data.state.raw_results;

                    if (data.node === 'result_formatter' && data.state.messages) {
                        const lastMsg = data.state.messages.at(-1);
                        let content   = lastMsg.content || lastMsg.kwargs?.content;
                        if (Array.isArray(content))
                            content = content.map(i => (typeof i === 'string' ? i : (i.text || ''))).join('');

                        if (data.state.raw_results)    latestRaw = data.state.raw_results;
                        if (data.state.generated_sql) latestSql = data.state.generated_sql;

                        progressWrapper.replaceWith(buildResultCard(content, latestRaw, latestSql));
                        chatHistory.scrollTop = chatHistory.scrollHeight;
                    }

                } else if (data.type === 'interrupt_or_error') {
                    console.error('Backend:', data.message);
                    if (pendingSql) {
                        progressWrapper.innerHTML = '';
                        const note = document.createElement('div');
                        note.className = 'interrupt-notice';
                        note.innerHTML = '⏸️ <strong>Waiting for human approval…</strong>';
                        progressWrapper.appendChild(note);
                        sqlEditor.value = pendingSql;
                        inspectorPanel.style.display = 'flex';
                    } else {
                        progressWrapper.innerHTML  = '';
                        progressWrapper.className  = 'message msg-system msg-error';
                        progressWrapper.textContent = '❌ Backend Error: ' + data.message;
                    }
                }
            }
        }
    } catch (e) {
        progressWrapper.innerHTML  = '';
        progressWrapper.className  = 'message msg-system msg-error';
        progressWrapper.textContent = 'Connection error: ' + e.message;
    }
}

// ── Event Listeners ────────────────────────────────────────────────────────
document.getElementById('send-btn').onclick = () => {
    const input = document.getElementById('chat-input');
    if (!input.value.trim()) return;
    appendMessage('user', input.value);
    streamGraph('/api/chat/stream', { message: input.value, thread_id: currentThreadId });
    input.value = '';
};

document.getElementById('chat-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); document.getElementById('send-btn').click(); }
});

document.getElementById('approve-btn').onclick = () => {
    inspectorPanel.style.display = 'none';
    streamGraph('/api/chat/resume', { thread_id: currentThreadId, approved: true, edited_sql: sqlEditor.value });
};

document.getElementById('reject-btn').onclick = () => {
    inspectorPanel.style.display = 'none';
    streamGraph('/api/chat/resume', {
        thread_id: currentThreadId, approved: false,
        edited_sql: sqlEditor.value,
        feedback: document.getElementById('feedback-input').value
    });
};

document.getElementById('copy-sql-btn').addEventListener('click', () => {
    copyToClipboard(sqlEditor.value, document.getElementById('copy-sql-btn'));
});

// ── Boot ───────────────────────────────────────────────────────────────────
loadSchema();
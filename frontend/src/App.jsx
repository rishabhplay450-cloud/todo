import { useEffect, useMemo, useState } from 'react'
import './App.css'

const API_BASE = import.meta.env.VITE_API_BASE_URL || (import.meta.env.DEV ? 'http://localhost:4000' : 'https://todo-backend-bafc.onrender.com')
const TOKEN_KEY = 'todo_auth_token'

const defaultTodoForm = {
  title: '',
  description: '',
  priority: 'medium',
  status: 'todo',
  due_date: '',
  project_id: '',
  label_ids: [],
  subtasksText: '',
}

const defaultFilters = {
  search: '',
  status: '',
  priority: '',
  projectId: '',
  labelId: '',
  sortBy: 'created_at',
  sortOrder: 'desc',
  overdue: false,
}

const defaultAuthForm = {
  name: '',
  email: '',
  password: '',
}

const priorityRank = {
  low: 1,
  medium: 2,
  high: 3,
  urgent: 4,
}

async function fetchJson(path, options = {}, token = null) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  })

  if (!response.ok) {
    let message = 'Request failed'
    try {
      const payload = await response.json()
      message = payload.error || message
    } catch {
      message = response.statusText || message
    }
    throw new Error(message)
  }

  if (response.status === 204) {
    return null
  }

  return response.json()
}

function toLocalInputDate(dateValue) {
  if (!dateValue) {
    return ''
  }

  const date = new Date(dateValue)
  if (Number.isNaN(date.getTime())) {
    return ''
  }

  const offset = date.getTimezoneOffset()
  const localDate = new Date(date.getTime() - offset * 60000)
  return localDate.toISOString().slice(0, 16)
}

function formatDate(dateValue) {
  if (!dateValue) {
    return 'No due date'
  }

  const date = new Date(dateValue)
  if (Number.isNaN(date.getTime())) {
    return 'Invalid date'
  }

  return date.toLocaleString()
}

function App() {
  const [authMode, setAuthMode] = useState('login')
  const [authForm, setAuthForm] = useState(defaultAuthForm)
  const [authToken, setAuthToken] = useState('')
  const [currentUser, setCurrentUser] = useState(null)
  const [appViewMode, setAppViewMode] = useState(null)

  const [todos, setTodos] = useState([])
  const [projects, setProjects] = useState([])
  const [labels, setLabels] = useState([])
  const [todoForm, setTodoForm] = useState(defaultTodoForm)
  const [filters, setFilters] = useState(defaultFilters)
  const [projectName, setProjectName] = useState('')
  const [projectColor, setProjectColor] = useState('#64748b')
  const [labelName, setLabelName] = useState('')
  const [labelColor, setLabelColor] = useState('#0ea5e9')
  const [newSubtaskTitles, setNewSubtaskTitles] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const isNotepadMode = appViewMode === 'notepad'
  const isAdvancedMode = appViewMode === 'advanced'

  const stats = useMemo(() => {
    const doneCount = todos.filter((todo) => todo.status === 'done').length
    const overdueCount = todos.filter(
      (todo) => todo.due_date && todo.status !== 'done' && new Date(todo.due_date) < new Date()
    ).length
    const urgentCount = todos.filter((todo) => todo.priority === 'urgent' && todo.status !== 'done').length

    return {
      total: todos.length,
      done: doneCount,
      pending: todos.length - doneCount,
      overdue: overdueCount,
      urgent: urgentCount,
    }
  }, [todos])

  useEffect(() => {
    const savedToken = window.localStorage.getItem(TOKEN_KEY)
    if (savedToken) {
      setAuthToken(savedToken)
    } else {
      setLoading(false)
    }
  }, [])

  async function loadMeta(token = authToken) {
    const data = await fetchJson('/api/meta', {}, token)
    setProjects(data.projects)
    setLabels(data.labels)
  }

  async function loadTodos(currentFilters = filters, token = authToken) {
    const params = new URLSearchParams()
    Object.entries(currentFilters).forEach(([key, value]) => {
      if (value === '' || value === false) {
        return
      }
      params.set(key, String(value))
    })

    const query = params.toString() ? `?${params}` : ''
    const data = await fetchJson(`/api/todos${query}`, {}, token)
    setTodos(data.todos)
  }

  async function bootstrap(token = authToken) {
    if (!token) {
      setLoading(false)
      return
    }

    setLoading(true)
    setError('')

    try {
      const me = await fetchJson('/api/auth/me', {}, token)
      setCurrentUser(me.user)
      setAppViewMode(null)
      await Promise.all([loadMeta(token), loadTodos(defaultFilters, token)])
      setFilters(defaultFilters)
    } catch (loadError) {
      setError(loadError.message)
      handleLogout()
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!authToken) {
      return
    }
    bootstrap(authToken)
  }, [authToken])

  async function refreshWithFilters(nextFilters) {
    setFilters(nextFilters)
    setError('')

    try {
      await loadTodos(nextFilters)
    } catch (loadError) {
      setError(loadError.message)
    }
  }

  async function handleAuthSubmit(event) {
    event.preventDefault()
    setError('')

    if (!authForm.email.trim() || !authForm.password.trim()) {
      setError('Email and password are required')
      return
    }

    if (authMode === 'signup' && !authForm.name.trim()) {
      setError('Name is required for signup')
      return
    }

    const endpoint = authMode === 'signup' ? '/api/auth/signup' : '/api/auth/login'
    const payload =
      authMode === 'signup'
        ? {
            name: authForm.name.trim(),
            email: authForm.email.trim(),
            password: authForm.password,
          }
        : {
            email: authForm.email.trim(),
            password: authForm.password,
          }

    try {
      const data = await fetchJson(endpoint, {
        method: 'POST',
        body: JSON.stringify(payload),
      })

      window.localStorage.setItem(TOKEN_KEY, data.token)
      setAuthForm(defaultAuthForm)
      setAuthToken(data.token)
      setCurrentUser(data.user)
      setAppViewMode(null)
    } catch (authError) {
      setError(authError.message)
    }
  }

  function handleLogout() {
    window.localStorage.removeItem(TOKEN_KEY)
    setAuthToken('')
    setCurrentUser(null)
    setAppViewMode(null)
    setTodos([])
    setProjects([])
    setLabels([])
    setFilters(defaultFilters)
    setTodoForm(defaultTodoForm)
  }

  function chooseMode(mode) {
    setAppViewMode(mode)
    setError('')
  }

  async function createTodo(event) {
    event.preventDefault()
    setError('')

    if (!todoForm.title.trim()) {
      setError('Title is required')
      return
    }

    const subtasks = todoForm.subtasksText
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean)
      .map((title) => ({ title }))

    const payload = {
      title: todoForm.title.trim(),
      description: todoForm.description.trim() || null,
      priority: todoForm.priority,
      status: todoForm.status,
      due_date: todoForm.due_date || null,
      project_id: todoForm.project_id ? Number(todoForm.project_id) : null,
      label_ids: todoForm.label_ids,
      subtasks,
    }

    try {
      await fetchJson(
        '/api/todos',
        {
          method: 'POST',
          body: JSON.stringify(payload),
        },
        authToken
      )
      setTodoForm(defaultTodoForm)
      await loadTodos(filters)
    } catch (createError) {
      setError(createError.message)
    }
  }

  async function createProject(event) {
    event.preventDefault()
    if (!projectName.trim()) {
      return
    }

    setError('')
    try {
      await fetchJson(
        '/api/projects',
        {
          method: 'POST',
          body: JSON.stringify({ name: projectName.trim(), color: projectColor }),
        },
        authToken
      )
      setProjectName('')
      await loadMeta()
    } catch (createError) {
      setError(createError.message)
    }
  }

  async function createLabel(event) {
    event.preventDefault()
    if (!labelName.trim()) {
      return
    }

    setError('')
    try {
      await fetchJson(
        '/api/labels',
        {
          method: 'POST',
          body: JSON.stringify({ name: labelName.trim(), color: labelColor }),
        },
        authToken
      )
      setLabelName('')
      await loadMeta()
    } catch (createError) {
      setError(createError.message)
    }
  }

  async function removeTodo(todoId) {
    setError('')
    try {
      await fetchJson(`/api/todos/${todoId}`, { method: 'DELETE' }, authToken)
      await loadTodos(filters)
    } catch (deleteError) {
      setError(deleteError.message)
    }
  }

  async function toggleTodo(todoId) {
    setError('')
    try {
      await fetchJson(`/api/todos/${todoId}/toggle`, { method: 'PATCH' }, authToken)
      await loadTodos(filters)
    } catch (toggleError) {
      setError(toggleError.message)
    }
  }

  async function quickUpdateTodo(todo, patch) {
    setError('')

    const payload = {
      title: todo.title,
      description: todo.description || null,
      status: patch.status || todo.status,
      priority: patch.priority || todo.priority,
      due_date: patch.due_date ?? (toLocalInputDate(todo.due_date) || null),
      project_id: patch.project_id !== undefined ? patch.project_id : todo.project_id,
      label_ids: patch.label_ids || todo.labels.map((label) => label.id),
      subtasks: todo.subtasks.map((subtask) => ({ title: subtask.title })),
    }

    try {
      await fetchJson(
        `/api/todos/${todo.id}`,
        {
          method: 'PUT',
          body: JSON.stringify(payload),
        },
        authToken
      )
      await loadTodos(filters)
    } catch (updateError) {
      setError(updateError.message)
    }
  }

  async function addSubtask(todoId) {
    const title = (newSubtaskTitles[todoId] || '').trim()
    if (!title) {
      return
    }

    setError('')
    try {
      await fetchJson(
        `/api/todos/${todoId}/subtasks`,
        {
          method: 'POST',
          body: JSON.stringify({ title }),
        },
        authToken
      )
      setNewSubtaskTitles((current) => ({ ...current, [todoId]: '' }))
      await loadTodos(filters)
    } catch (subtaskError) {
      setError(subtaskError.message)
    }
  }

  async function toggleSubtask(subtaskId) {
    setError('')
    try {
      await fetchJson(`/api/subtasks/${subtaskId}/toggle`, { method: 'PATCH' }, authToken)
      await loadTodos(filters)
    } catch (toggleError) {
      setError(toggleError.message)
    }
  }

  async function deleteSubtask(subtaskId) {
    setError('')
    try {
      await fetchJson(`/api/subtasks/${subtaskId}`, { method: 'DELETE' }, authToken)
      await loadTodos(filters)
    } catch (deleteError) {
      setError(deleteError.message)
    }
  }

  function onFilterChange(event) {
    const { name, value, type, checked } = event.target
    const nextFilters = {
      ...filters,
      [name]: type === 'checkbox' ? checked : value,
    }
    refreshWithFilters(nextFilters)
  }

  function onLabelToggle(labelId) {
    setTodoForm((current) => {
      const exists = current.label_ids.includes(labelId)
      return {
        ...current,
        label_ids: exists ? current.label_ids.filter((id) => id !== labelId) : [...current.label_ids, labelId],
      }
    })
  }

  const sortedTodos = [...todos].sort((left, right) => {
    if (filters.sortBy === 'priority') {
      return (priorityRank[right.priority] || 0) - (priorityRank[left.priority] || 0)
    }
    return 0
  })

  if (loading) {
    return <main className="app-shell">Loading todo workspace...</main>
  }

  if (!authToken || !currentUser) {
    return (
      <main className="app-shell auth-shell">
        <section className="auth-card">
          <h1>Todo Workspace</h1>
          <p className="auth-subtitle">Login or create an account to access your private workspace.</p>

          <div className="auth-tabs">
            <button type="button" className={authMode === 'login' ? 'active' : ''} onClick={() => setAuthMode('login')}>
              Login
            </button>
            <button
              type="button"
              className={authMode === 'signup' ? 'active' : ''}
              onClick={() => setAuthMode('signup')}
            >
              Signup
            </button>
          </div>

          <form className="auth-form" onSubmit={handleAuthSubmit}>
            {authMode === 'signup' && (
              <input
                placeholder="Full name"
                value={authForm.name}
                onChange={(event) => setAuthForm({ ...authForm, name: event.target.value })}
              />
            )}
            <input
              placeholder="Email"
              type="email"
              value={authForm.email}
              onChange={(event) => setAuthForm({ ...authForm, email: event.target.value })}
            />
            <input
              placeholder="Password"
              type="password"
              value={authForm.password}
              onChange={(event) => setAuthForm({ ...authForm, password: event.target.value })}
            />
            <button type="submit">{authMode === 'signup' ? 'Create Account' : 'Login'}</button>
          </form>

          {error && <p className="error-banner">{error}</p>}
        </section>
      </main>
    )
  }

  if (!appViewMode) {
    return (
      <main className="app-shell mode-shell">
        <section className="mode-card">
          <h1>Choose Your Todo Mode</h1>
          <p className="auth-subtitle">Pick how you want to work today. You can switch anytime from the header.</p>

          <div className="mode-grid">
            <button type="button" className="mode-option" onClick={() => chooseMode('notepad')}>
              <strong>Notepad Mode</strong>
              <span>Large writing area focused on long notes and comfortable reading.</span>
            </button>
            <button type="button" className="mode-option" onClick={() => chooseMode('advanced')}>
              <strong>Advanced Mode</strong>
              <span>Full task controls with labels, projects, filters, priorities, and subtasks.</span>
            </button>
          </div>

          <div className="user-row">
            <span>{currentUser.name} ({currentUser.email})</span>
            <button type="button" onClick={handleLogout}>Logout</button>
          </div>
        </section>
      </main>
    )
  }

  return (
    <main className="app-shell">
      <header className="header">
        <div className="header-top-row">
          <h1>{isNotepadMode ? 'Notepad Todo Mode' : 'Advanced Todo Manager'}</h1>
          <div className="user-row">
            <button
              type="button"
              className={isNotepadMode ? 'mode-switch active' : 'mode-switch'}
              onClick={() => chooseMode('notepad')}
            >
              Notepad Mode
            </button>
            <button
              type="button"
              className={isAdvancedMode ? 'mode-switch active' : 'mode-switch'}
              onClick={() => chooseMode('advanced')}
            >
              Advanced Mode
            </button>
            <span>{currentUser.name}</span>
            <button type="button" onClick={handleLogout}>Logout</button>
          </div>
        </div>

        <div className="stats-grid">
          <article><strong>{stats.total}</strong><span>Total</span></article>
          <article><strong>{stats.pending}</strong><span>Pending</span></article>
          <article><strong>{stats.done}</strong><span>Done</span></article>
          <article><strong>{stats.overdue}</strong><span>Overdue</span></article>
          <article><strong>{stats.urgent}</strong><span>Urgent</span></article>
        </div>
      </header>

      {error && <p className="error-banner">{error}</p>}

      {isNotepadMode && (
        <section className="notepad-layout">
          <form className="panel-card notepad-editor" onSubmit={createTodo}>
            <h2>Write New Note Todo</h2>
            <input
              placeholder="Title"
              value={todoForm.title}
              onChange={(event) => setTodoForm({ ...todoForm, title: event.target.value })}
            />
            <textarea
              className="notepad-description"
              placeholder="Write your long note/description here..."
              value={todoForm.description}
              onChange={(event) => setTodoForm({ ...todoForm, description: event.target.value })}
            />
            <button type="submit">Save Note Todo</button>
          </form>

          <section className="panel-card notepad-list">
            <div className="notepad-list-header">
              <h2>My Notes</h2>
              <input
                name="search"
                value={filters.search}
                onChange={onFilterChange}
                placeholder="Search notes"
              />
            </div>

            <div className="notepad-cards">
              {sortedTodos.map((todo) => (
                <article className="todo-card" key={todo.id}>
                  <div className="todo-header-row">
                    <h3>{todo.title}</h3>
                    <div className="todo-actions">
                      <button type="button" onClick={() => toggleTodo(todo.id)}>
                        {todo.status === 'done' ? 'Reopen' : 'Done'}
                      </button>
                      <button type="button" className="danger" onClick={() => removeTodo(todo.id)}>
                        Delete
                      </button>
                    </div>
                  </div>
                  <p className="note-body">{todo.description || 'No description'}</p>
                  <div className="meta-row">
                    <span>{todo.status.replace('_', ' ')}</span>
                    <span>{formatDate(todo.due_date)}</span>
                  </div>
                </article>
              ))}
              {sortedTodos.length === 0 && <p className="empty">No notes found.</p>}
            </div>
          </section>
        </section>
      )}

      {isAdvancedMode && (
        <section className="layout-grid">
          <aside className="left-panel">
            <form className="panel-card" onSubmit={createTodo}>
              <h2>Create Todo</h2>
              <input
                placeholder="Title"
                value={todoForm.title}
                onChange={(event) => setTodoForm({ ...todoForm, title: event.target.value })}
              />
              <textarea
                placeholder="Description"
                value={todoForm.description}
                onChange={(event) => setTodoForm({ ...todoForm, description: event.target.value })}
              />
              <div className="inline-grid">
                <select
                  value={todoForm.status}
                  onChange={(event) => setTodoForm({ ...todoForm, status: event.target.value })}
                >
                  <option value="todo">Todo</option>
                  <option value="in_progress">In Progress</option>
                  <option value="done">Done</option>
                </select>
                <select
                  value={todoForm.priority}
                  onChange={(event) => setTodoForm({ ...todoForm, priority: event.target.value })}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>

              <input
                type="datetime-local"
                value={todoForm.due_date}
                onChange={(event) => setTodoForm({ ...todoForm, due_date: event.target.value })}
              />

              <select
                value={todoForm.project_id}
                onChange={(event) => setTodoForm({ ...todoForm, project_id: event.target.value })}
              >
                <option value="">No project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>

              <div className="label-pills">
                {labels.map((label) => {
                  const selected = todoForm.label_ids.includes(label.id)
                  return (
                    <button
                      className={`pill ${selected ? 'selected' : ''}`}
                      key={label.id}
                      type="button"
                      onClick={() => onLabelToggle(label.id)}
                      style={{ borderColor: label.color }}
                    >
                      {label.name}
                    </button>
                  )
                })}
              </div>

              <textarea
                placeholder="Subtasks (one per line)"
                value={todoForm.subtasksText}
                onChange={(event) => setTodoForm({ ...todoForm, subtasksText: event.target.value })}
              />

              <button type="submit">Add Todo</button>
            </form>

            <form className="panel-card" onSubmit={createProject}>
              <h2>Add Project</h2>
              <input
                placeholder="Project name"
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
              />
              <input
                type="color"
                value={projectColor}
                onChange={(event) => setProjectColor(event.target.value)}
              />
              <button type="submit">Create Project</button>
            </form>

            <form className="panel-card" onSubmit={createLabel}>
              <h2>Add Label</h2>
              <input
                placeholder="Label name"
                value={labelName}
                onChange={(event) => setLabelName(event.target.value)}
              />
              <input
                type="color"
                value={labelColor}
                onChange={(event) => setLabelColor(event.target.value)}
              />
              <button type="submit">Create Label</button>
            </form>

            <section className="panel-card filters-card">
              <h2>Filters</h2>
              <input
                name="search"
                value={filters.search}
                onChange={onFilterChange}
                placeholder="Search title/description"
              />
              <div className="inline-grid">
                <select name="status" value={filters.status} onChange={onFilterChange}>
                  <option value="">All status</option>
                  <option value="todo">Todo</option>
                  <option value="in_progress">In Progress</option>
                  <option value="done">Done</option>
                </select>
                <select name="priority" value={filters.priority} onChange={onFilterChange}>
                  <option value="">All priority</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
              <div className="inline-grid">
                <select name="projectId" value={filters.projectId} onChange={onFilterChange}>
                  <option value="">All projects</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
                <select name="labelId" value={filters.labelId} onChange={onFilterChange}>
                  <option value="">All labels</option>
                  {labels.map((label) => (
                    <option key={label.id} value={label.id}>
                      {label.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="inline-grid">
                <select name="sortBy" value={filters.sortBy} onChange={onFilterChange}>
                  <option value="created_at">Created</option>
                  <option value="updated_at">Updated</option>
                  <option value="due_date">Due date</option>
                  <option value="priority">Priority</option>
                  <option value="title">Title</option>
                </select>
                <select name="sortOrder" value={filters.sortOrder} onChange={onFilterChange}>
                  <option value="desc">Desc</option>
                  <option value="asc">Asc</option>
                </select>
              </div>
              <label className="checkbox-row">
                <input type="checkbox" name="overdue" checked={filters.overdue} onChange={onFilterChange} />
                Show overdue only
              </label>
              <button type="button" onClick={() => refreshWithFilters(defaultFilters)}>Reset Filters</button>
            </section>
          </aside>

          <section className="todo-list-panel">
            {sortedTodos.map((todo) => (
              <article className={`todo-card ${todo.status === 'done' ? 'done' : ''}`} key={todo.id}>
                <div className="todo-header-row">
                  <h3>{todo.title}</h3>
                  <div className="todo-actions">
                    <button type="button" onClick={() => toggleTodo(todo.id)}>
                      {todo.status === 'done' ? 'Reopen' : 'Done'}
                    </button>
                    <button type="button" className="danger" onClick={() => removeTodo(todo.id)}>
                      Delete
                    </button>
                  </div>
                </div>

                <p>{todo.description || 'No description'}</p>

                <div className="meta-row">
                  <span className={`priority priority-${todo.priority}`}>{todo.priority}</span>
                  <span>{todo.status.replace('_', ' ')}</span>
                  <span>{formatDate(todo.due_date)}</span>
                  {todo.project_name && (
                    <span className="project-badge" style={{ borderColor: todo.project_color }}>
                      {todo.project_name}
                    </span>
                  )}
                </div>

                <div className="inline-grid quick-actions-row">
                  <select
                    value={todo.status}
                    onChange={(event) => quickUpdateTodo(todo, { status: event.target.value })}
                  >
                    <option value="todo">Todo</option>
                    <option value="in_progress">In Progress</option>
                    <option value="done">Done</option>
                  </select>
                  <select
                    value={todo.priority}
                    onChange={(event) => quickUpdateTodo(todo, { priority: event.target.value })}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                  <select
                    value={todo.project_id || ''}
                    onChange={(event) =>
                      quickUpdateTodo(todo, {
                        project_id: event.target.value ? Number(event.target.value) : null,
                      })
                    }
                  >
                    <option value="">No project</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="label-pills compact">
                  {todo.labels.map((label) => (
                    <span className="pill selected" key={label.id} style={{ borderColor: label.color }}>
                      {label.name}
                    </span>
                  ))}
                </div>

                <div className="subtask-block">
                  <h4>Subtasks ({todo.completion_ratio}%)</h4>
                  {todo.subtasks.map((subtask) => (
                    <div className="subtask-row" key={subtask.id}>
                      <label>
                        <input
                          type="checkbox"
                          checked={subtask.is_completed}
                          onChange={() => toggleSubtask(subtask.id)}
                        />
                        <span className={subtask.is_completed ? 'strike' : ''}>{subtask.title}</span>
                      </label>
                      <button type="button" className="danger ghost" onClick={() => deleteSubtask(subtask.id)}>
                        x
                      </button>
                    </div>
                  ))}
                  <div className="subtask-entry-row">
                    <input
                      placeholder="Add subtask"
                      value={newSubtaskTitles[todo.id] || ''}
                      onChange={(event) =>
                        setNewSubtaskTitles((current) => ({ ...current, [todo.id]: event.target.value }))
                      }
                    />
                    <button type="button" onClick={() => addSubtask(todo.id)}>Add</button>
                  </div>
                </div>
              </article>
            ))}
            {sortedTodos.length === 0 && <p className="empty">No todos found for current filters.</p>}
          </section>
        </section>
      )}
    </main>
  )
}

export default App

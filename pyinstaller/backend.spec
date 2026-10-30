name = 'AgentFlowBackend'
version = '0.1.0'

[options]
mode = 'onefile'
console = True
uac_admin = False

# Entry
# Run: uv run python -m app.run  → PyInstaller wraps this
entry_points = {
  'console_scripts': ['agentflow-api = app.run:main'],
}

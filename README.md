# general

General repo for hosting useful tools and scripts.

## Directory Structure

```
├── tamper_monkey/          # Userscripts for browser automation
├── powershell_windows/     # Windows PowerShell utilities
├── .github/workflows/      # GitHub Actions workflows
└── README.md
```

## Tamper Monkey Scripts

Browser userscripts for enhanced productivity:

- **chatgpt_button_clicker.js** - Makes Enter send ChatGPT messages, Shift+Enter creates newlines
- **tiktok_loop_fix.js** - Forces TikTok videos to loop continuously
- **jira_show_full_work_team_no_scroll.js** - Removes height constraints on Jira Team Workload gadget to show full content without scrolling
- **claude_usage_weekly_progress.js** - Adds a weekly cycle elapsed progress bar to Claude usage tracker
- **modmail_turbo_scroll.js** - Auto-scrolls through entire Reddit modmail history to quickly navigate to oldest messages

## PowerShell Windows

Windows system utilities:

- **UpdatePowerShell.ps1** - Automatically checks for and installs the latest PowerShell version on system startup. Throttles checks to once every 2 days to avoid excessive restarts. Requires admin privileges.

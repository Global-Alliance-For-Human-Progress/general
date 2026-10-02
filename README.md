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

Browser userscripts for enhanced productivity, grouped into one folder per application:

- **ampeco/** - SSO auto-login for the Ampeco admin (generic template; the site-specific copy is gitignored)
- **chatgpt/** - Enter sends, Shift+Enter creates newlines
- **claude/** - Claude usage tracker with dynamic colors
- **facebook/**, **instagram/**, **tiktok/**, **youtube/** - Auto-unmute, background play, loop and bug fixes
- **general/** - Scripts that apply to any site (universal dark mode)
- **github/** - GHE SSO auto-continue (generic template; the site-specific copy is gitignored)
- **jira/** - Removes height constraints on the Team Workload gadget
- **linkedin/** - Unfollow all
- **odoo/** - Debug mode and search focus fix
- **reddit/** - Modmail turbo scroll
- **render/** - Billing usage tracker with dynamic colors
- **rexx/** - Translates the French rexx portal into near-native English
- **turso/** - Database usage percentage badges

## PowerShell Windows

Windows system utilities:

- **UpdatePowerShell.ps1** - Automatically checks for and installs the latest PowerShell version on system startup. Throttles checks to once every 2 days to avoid excessive restarts. Requires admin privileges.

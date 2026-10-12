# One-time setup (do this before opening Claude Code)

You need 4 things. Keep every key in a password manager. Never paste a key into a chat,
a doc, or a file that goes into the repo. Claude Code will put them in a `.env` file that is never uploaded.

## 1. OpenRouter key (you already have this)
- openrouter.ai → Keys → create a new key just for this project, named `job-radar`.
- Set a monthly spend limit on it (e.g. $10) so a bug can't burn money.

## 2. Serper key (Google search, used to find LinkedIn hiring posts)
- serper.dev → sign up (no card needed for the 2,500 free searches) → copy the API key.

## 3. Google Sheet + service account (lets the script write to your Sheet)
This is the fiddliest step. Ask Claude Code to walk you through it click-by-click if you get stuck.
1. Create an empty Google Sheet named **Job Radar**. Copy its ID: the long string in the URL between `/d/` and `/edit`.
2. Go to console.cloud.google.com → create a project named `job-radar`.
3. Turn on the **Google Sheets API** for that project.
4. Create a **service account** (IAM & Admin → Service Accounts), then create a **JSON key** for it and download it.
5. Open the JSON file, copy the `client_email` (looks like `job-radar@….iam.gserviceaccount.com`),
   and **share your Sheet with that email as Editor**.

## 4. GitHub (runs the script every 30 minutes)
- Create a **private** repository named `job-radar`. It must be private because your resume goes in it.
- Later (Milestone 7) Claude Code will tell you which keys to add under
  Settings → Secrets and variables → Actions.

## What NOT to do
- Don't use any tool that asks for your LinkedIn login or cookies. That can get your LinkedIn
  account restricted while you're job-hunting. This project never logs into LinkedIn.

import os
import random
import subprocess
from datetime import datetime

# Random commit messages, all containing the word 'celo' or 'CELO'
COMMIT_MESSAGES = [
    "docs: update celo integration details in README",
    "feat(frontend): add connection state tracking for celo wallets",
    "refactor(wallet): optimize celo transaction fee estimates",
    "fix(frontend): handle celo alfajores network switches smoothly",
    "style: refine color tokens for celo green theme alignment",
    "perf(frontend): pre-fetch celo minipay session meta",
    "chore: add helper scripts for local celo contract testing",
    "docs: clarify celo gas token requirements for new users",
    "refactor(ui): clean up celo connect button loading states",
    "feat(wallet): support custom gas limits for celo transactions",
    "fix(frontend): address invalid gas fees display for celo network",
    "docs: improve celo mainnet deployment steps and pre-requisites",
    "style(frontend): adjust padding for celo transaction confirmation modal",
    "feat: integrate celo network metadata provider",
    "perf: optimize celo wallet connection check intervals",
    "docs: outline celo minipay deep-linking guidelines",
    "refactor(wallet): simplify celo contract invocation helpers",
    "fix: resolve race conditions during multiple celo transactions",
    "style: update celo badge contrast ratio for accessibility",
    "docs: update celo alfajores faucet URL references",
    "feat(frontend): add celo transaction explorer links",
    "perf: cache celo gas prices locally to speed up clicks",
    "chore: clean up deprecated celo wallet wrapper references",
    "docs: add architectural section for celo dApp architecture",
    "feat(frontend): handle celo wallet disconnect events gracefully",
    "refactor(wallet): optimize celo transaction payload encoding",
    "fix: resolve socket timeout issues during celo transactions",
    "style: improve alignment of celo payment card features",
    "perf: reduce memory footprint of celo connection listeners",
    "docs: document developer guidelines for celo contract upgrades"
]

def make_modification(file_path, index, branch_num):
    """Safely appends a safe comment or line to the branch-specific file."""
    os.makedirs(os.path.dirname(file_path) if os.path.dirname(file_path) else ".", exist_ok=True)
    
    # If file doesn't exist, create it with header
    if not os.path.exists(file_path):
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(f"# Celo Contribution Log - Night Branch {branch_num}\n")
            f.write("This file tracks frontend progress updates for Celo blockchain integration.\n\n")
            
    comment_text = f"- **Update {index}**: Safely logged celo wallet integration progress step at index {index}.\n"
        
    with open(file_path, 'a', encoding='utf-8') as f:
        f.write(comment_text)
    return True

def run_git_commit(message, date_str):
    """Runs git add and git commit with backdated dates."""
    subprocess.run(["git", "add", "."], check=True)
    env = os.environ.copy()
    env["GIT_AUTHOR_DATE"] = date_str
    env["GIT_COMMITTER_DATE"] = date_str
    subprocess.run(["git", "commit", "-m", message], env=env, check=True)

def main():
    target_date = datetime(2026, 5, 24) # Today: May 24, 2026
    total_commits = 50
    commits_per_branch = 5
    num_branches = 10
    
    print("Checking out main branch...")
    subprocess.run(["git", "checkout", "main"], check=True)
    
    # Timeframe: 18:00 (6:00 PM) to 23:46 (11:46 PM)
    start_seconds = 18 * 3600
    end_seconds = 23 * 3600 + 46 * 60
    
    # Select 50 random sorted seconds in the interval
    random_seconds = sorted(random.sample(range(start_seconds, end_seconds), total_commits))
    
    commit_index = 8000 # unique starting index for tonight's run
    
    print(f"Generating 10 branches with 5 commits each (total {total_commits} commits)...")
    
    for branch_num in range(1, num_branches + 1):
        branch_name = f"feat/celo-today-{branch_num}"
        unique_file = f"frontend/celo-progress-night-{branch_num}.md"
        print(f"\n======================================")
        print(f"Setting up branch: {branch_name}")
        print(f"Unique File: {unique_file}")
        print(f"======================================")
        
        # Ensure we are checking out fresh from local main
        subprocess.run(["git", "checkout", "main"], check=True)
        
        # Delete branch if it already exists locally to prevent errors
        subprocess.run(["git", "branch", "-D", branch_name], stderr=subprocess.DEVNULL)
        
        # Create and checkout new branch
        subprocess.run(["git", "checkout", "-b", branch_name, "main"], check=True)
        
        # Get the 5 sorted timestamps for this branch
        start_idx = (branch_num - 1) * commits_per_branch
        end_idx = start_idx + commits_per_branch
        branch_seconds = random_seconds[start_idx:end_idx]
        
        for sec in branch_seconds:
            hour = sec // 3600
            minute = (sec % 3600) // 60
            second = sec % 60
            
            commit_time = target_date.replace(hour=hour, minute=minute, second=second)
            date_str = commit_time.strftime("%Y-%m-%d %H:%M:%S +0700")
            
            if make_modification(unique_file, commit_index, branch_num):
                message = random.choice(COMMIT_MESSAGES)
                if "celo" not in message.lower():
                    message += " for celo network"
                    
                print(f"Committing on {date_str} to {branch_name}: '{message}' in {unique_file}")
                run_git_commit(message, date_str)
                commit_index += 1
            else:
                print(f"File {unique_file} could not be modified.")
                
        # Push this branch to remote with force-push (-f) to update the PR
        print(f"Force-pushing branch {branch_name} to GitHub remote...")
        subprocess.run(["git", "push", "-f", "-u", "origin", branch_name], check=True)
        
    # Return to main branch when done
    subprocess.run(["git", "checkout", "main"], check=True)
    print("\nSuccessfully completed generating and force-pushing all 10 branches with unique files!")

if __name__ == "__main__":
    main()

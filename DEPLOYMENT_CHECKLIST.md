# Deploy GitTree to GitHub Pages

## 5 Simple Steps

### Step 1: Create GitHub Repo
- Go: https://github.com/new
- Name: gittree
- Visibility: Public
- Create

### Step 2: Push Code
'''bash
git remote add origin https://github.com/dongfangzhizhu/gittree.git
git branch -M master
git push -u origin master
'''

### Step 3: Enable Pages
- Settings > Pages
- Source: Deploy from branch
- Branch: gh-pages (will auto-create)
- Save

### Step 4: Configure Actions
- Settings > Actions > General
- Permissions: Read and write
- Save

### Step 5: Verify
- Actions tab: check workflow status
- Visit: https://dongfangzhizhu.github.io/gittree/

## Auto-Deploy
Every git push triggers: build > test > deploy (1-2 min)


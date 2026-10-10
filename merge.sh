#!/usr/bin/env bash
# 手动执行：./merge.sh；合并最新上游到本地 main，然后推送到 EvanZheng11/codeg。
# 保留本地已提交的修改；冲突时停止，人工解决并提交后重新执行即可。
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"
UPSTREAM_URL="https://github.com/spacering-net/codeg.git"
FORK_URL="https://github.com/EvanZheng11/codeg.git"

if [[ "$(git branch --show-current)" != "main" ]]; then
  echo "请先切换到 main 分支，再执行 ./merge.sh。" >&2
  exit 1
fi
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "存在未提交的修改，请先提交或暂存到 stash，再执行 ./merge.sh。" >&2
  exit 1
fi
for state in MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD rebase-merge rebase-apply; do
  if [[ -e "$(git rev-parse --git-path "$state")" ]]; then
    echo "存在未完成的 Git 操作（${state}），请先完成或中止。" >&2
    exit 1
  fi
done

# 显式使用仓库地址，避免 origin 指向上游时误推送。
echo "获取 EvanZheng11/codeg 的最新 main……"
git fetch --no-tags "$FORK_URL" main
FORK_COMMIT="$(git rev-parse FETCH_HEAD)"
echo "获取 spacering-net/codeg 的最新 main……"
git fetch --no-tags "$UPSTREAM_URL" main
UPSTREAM_COMMIT="$(git rev-parse FETCH_HEAD)"

for commit in "$FORK_COMMIT" "$UPSTREAM_COMMIT"; do
  echo "合并提交 ${commit}……"
  if ! git merge --no-edit "$commit"; then
    echo "合并失败，尚未推送。请执行 git status 检查。" >&2
    echo "冲突解决后执行 git add <已解决的文件> 和 git commit，再运行 ./merge.sh。" >&2
    echo "如需取消当前合并，可执行 git merge --abort。" >&2
    exit 1
  fi
done

echo "推送到 EvanZheng11/codeg 的 main……"
if ! git push "$FORK_URL" HEAD:refs/heads/main; then
  echo "推送失败，本地合并结果已保留。请检查权限和网络后重新执行 ./merge.sh。" >&2
  exit 1
fi
echo "同步完成：上游 $UPSTREAM_COMMIT 已合并到 EvanZheng11/codeg 的 main。"

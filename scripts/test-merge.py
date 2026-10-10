#!/usr/bin/env python3
"""使用本地 Git 仓库验证 merge.sh：python3 scripts/test-merge.py。"""
from pathlib import Path
import shutil
import subprocess
import tempfile

SCRIPT = Path(__file__).resolve().parents[1] / "merge.sh"


def git(repo, *args):
    return subprocess.check_output(
        ["git", "-C", str(repo), *args], stderr=subprocess.STDOUT, text=True
    ).strip()


def commit(repo, filename, content):
    (repo / filename).write_text(content)
    git(repo, "add", filename)
    git(repo, "commit", "-m", "测试提交")


def run(repo, success=True):
    result = subprocess.run(
        ["bash", str(repo / "merge.sh")], capture_output=True, text=True,
        errors="replace",
    )
    assert (result.returncode == 0) == success, result.stdout + result.stderr
    return result.stdout + result.stderr


with tempfile.TemporaryDirectory(prefix="codeg-merge-test-") as directory:
    root = Path(directory)
    seed, upstream, fork, client = (root / name for name in (
        "seed", "upstream.git", "fork.git", "client"
    ))
    git(root, "init", "-b", "main", str(seed))
    git(seed, "config", "user.name", "合并测试")
    git(seed, "config", "user.email", "merge-test@example.invalid")
    commit(seed, "shared.txt", "基础内容\n")
    git(root, "clone", "--bare", str(seed), str(upstream))
    git(root, "clone", "--bare", str(seed), str(fork))
    git(root, "clone", str(fork), str(client))
    git(client, "config", "user.name", "合并测试")
    git(client, "config", "user.email", "merge-test@example.invalid")
    for remote, url in (
        (upstream, "https://github.com/spacering-net/codeg.git"),
        (fork, "https://github.com/EvanZheng11/codeg.git"),
    ):
        git(client, "config", f"url.{remote}.insteadOf", url)
    shutil.copyfile(SCRIPT, client / "merge.sh")
    git(client, "add", "merge.sh")
    git(client, "commit", "-m", "添加同步脚本")
    git(client, "push", str(fork), "main")
    commit(client, "local.txt", "保留本地提交\n")
    # 模拟 fork 在另一台机器上新增提交。
    git(seed, "fetch", str(fork), "main")
    git(seed, "merge", "--ff-only", "FETCH_HEAD")
    commit(seed, "fork.txt", "保留远端 fork 提交\n")
    git(seed, "push", str(fork), "main")
    commit(seed, "upstream.txt", "最新上游内容\n")
    git(seed, "push", str(upstream), "main")
    upstream_before = git(upstream, "rev-parse", "main")
    run(client)
    assert git(fork, "rev-parse", "main") == git(client, "rev-parse", "HEAD")
    assert git(upstream, "rev-parse", "main") == upstream_before
    for filename in ("local.txt", "fork.txt", "upstream.txt"):
        assert (client / filename).exists(), filename
    head = git(client, "rev-parse", "HEAD")
    run(client)
    assert git(client, "rev-parse", "HEAD") == head
    (client / "shared.txt").write_text("未提交修改\n")
    assert "未提交" in run(client, False)
    git(client, "restore", "shared.txt")
    git(client, "switch", "-c", "other")
    assert "切换到 main" in run(client, False)
    git(client, "switch", "main")
    # 两端修改同一行：必须停止并保留冲突，不能推送。
    commit(client, "shared.txt", "本地修改\n")
    commit(seed, "shared.txt", "上游修改\n")
    git(seed, "push", str(upstream), "main")
    fork_before = git(fork, "rev-parse", "main")
    assert "尚未推送" in run(client, False)
    assert git(fork, "rev-parse", "main") == fork_before
    assert git(client, "diff", "--name-only", "--diff-filter=U") == "shared.txt"
    (client / "shared.txt").write_text("人工解决冲突\n")
    git(client, "add", "shared.txt")
    git(client, "commit", "--no-edit")
    run(client)
    assert git(fork, "rev-parse", "main") == git(client, "rev-parse", "HEAD")
print("通过：合并、推送、保留本地及远端提交、重复执行、分支与修改检查、冲突停止及恢复。")

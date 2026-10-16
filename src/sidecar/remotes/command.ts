const HOME_PREFIX_LENGTH = 2;
// The remote command is fixed; only `dir` varies, and it is validated by config and single-quoted in the remote shell.
const quote = (value: unknown) => "'" + String(value).replace(/'/g, "'\\''") + "'";
export function remoteCommand(dir: string) {
  const cd = dir.startsWith("~/")
    ? 'cd "$HOME"/' + quote(dir.slice(HOME_PREFIX_LENGTH))
    : dir === "~"
      ? 'cd "$HOME"'
      : "cd " + quote(dir);
  return (
    cd +
    ' && PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH" exec bun --no-env-file dist/runtime/scripts/stream.js'
  );
}
export function sshArgs(remote: { id?: string; ssh: unknown; dir?: string }) {
  if (
    typeof remote.ssh !== "string" ||
    remote.ssh.startsWith("-") ||
    !/^[A-Za-z0-9._-]+(@[A-Za-z0-9.-]+)?$/.test(remote.ssh)
  )
    throw new Error("Invalid ssh target");
  return [
    "-T",
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=10",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=2",
    "--",
    remote.ssh,
    remoteCommand(remote.dir || "~/starnet-observer"),
  ];
}
// ssh's own diagnostics can name hosts, users and paths; the page gets one short, known category instead.
export function reasonFrom(stderr: string | null | undefined, code: number | null) {
  const value = stderr || "";
  if (/Permission denied/i.test(value)) return "SSH authentication failed";
  if (/Could not resolve hostname/i.test(value)) return "Host name did not resolve";
  if (/Connection refused/i.test(value)) return "SSH connection refused";
  if (/timed out/i.test(value)) return "SSH connection timed out";
  if (/Host key verification failed/i.test(value)) return "SSH host key not trusted";
  if (/command not found|No such file or directory/i.test(value))
    return "Remote observer not installed";
  return code === null ? "SSH stream ended" : `SSH stream exited (${String(code)})`;
}

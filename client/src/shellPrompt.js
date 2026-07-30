/** True when buffer ends on a typical shell prompt (post-MOTD / login). */
export function endsWithShellPrompt(buf) {
  const last = String(buf || '').split(/\r?\n/).pop() || '';
  if (last.length > 240) return false;
  // user@host:~$  |  root#  |  zsh %  |  simple prompts
  return (
    /(?:^|[@:].*)[#$%>]\s$/.test(last) || /^[^\r\n]*[#$%>]\s$/.test(last)
  );
}

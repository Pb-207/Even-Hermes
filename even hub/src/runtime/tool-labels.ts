export function toolLabel(name: string): string {
  const n = name.toLowerCase();
  if (n.includes('search')) return 'searching';
  if (n === 'run' || n === 'terminal' || n === 'shell' || n === 'bash' || n.includes('execute')) return 'running';
  if (n.startsWith('read')) return 'reading';
  if (n === 'fetch' || n === 'browse' || n.includes('http')) return 'fetching';
  return 'working';
}
